import { db } from '../../db/index.js';
import { notifyEvent } from '../notification/service.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation } from './evaluator.js';

export function getMyViolations(student_id: string, student_name: string, violation_ids?: number[]) {
  if (typeof student_id !== 'string' || typeof student_name !== 'string' || !student_id.trim() || !student_name.trim()) {
    throw new Error('Missing credentials');
  }
  
  let query = `
    SELECT v.*, strftime('%Y-%m-%dT%H:%M:%fZ', v.created_at) AS created_at, r.student_id, r.student_name, r.booking_code, e.name as equipment_name 
    FROM violation_records v
    JOIN reservations r ON v.reservation_id = r.id
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.student_id = ? AND r.student_name = ?
  `;
  const params: any[] = [student_id, student_name];

  if (violation_ids && Array.isArray(violation_ids) && violation_ids.length > 0) {
    const placeholders = violation_ids.map(() => '?').join(',');
    query += ` AND v.id IN (${placeholders})`;
    params.push(...violation_ids);
  }

  query += ` ORDER BY v.violation_time DESC`;
  
  const violations = db.prepare(query).all(...params);
  
  let userPenaltyDetails = null;
  if (!violation_ids) {
    userPenaltyDetails = checkUserPenalty(student_id);
  }
  
  return { violations, userPenaltyDetails };
}

export function submitAppeal(id: string, student_id: string, student_name: string, appeal_reason: string) {
  if (typeof student_id !== 'string' || typeof student_name !== 'string' || typeof appeal_reason !== 'string') {
    throw new Error('Missing required fields');
  }
  if (!student_id.trim() || !student_name.trim() || !appeal_reason.trim()) {
    throw new Error('Missing required fields');
  }
  if (appeal_reason.length > 2000) {
    throw new Error('申诉理由过长（上限2000字符）');
  }

  const violation = db.prepare(`
    SELECT v.*, strftime('%Y-%m-%dT%H:%M:%fZ', v.created_at) AS created_at, r.student_id, r.student_name 
    FROM violation_records v
    JOIN reservations r ON v.reservation_id = r.id
    WHERE v.id = ?
  `).get(id) as any;
  
  if (!violation) throw new Error('Record not found');

  if (violation.student_id !== student_id || violation.student_name !== student_name) {
    throw new Error('Unauthorized');
  }
  
  let remarkObj: any = {};
  if (violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  if (remarkObj.appeal_reason) {
    throw new Error('Already appealed');
  }
  
  remarkObj.appeal_reason = appeal_reason;
  remarkObj.appeal_time = new Date().toISOString();
  
  db.prepare('UPDATE violation_records SET remark = ? WHERE id = ?').run(JSON.stringify(remarkObj), id);
}

export function getAdminViolations(queryParams: any) {
  const { startDate, endDate, ids, appealStatus, reservation_id } = queryParams;

  let query = `
    SELECT v.*, strftime('%Y-%m-%dT%H:%M:%fZ', v.created_at) AS created_at, r.student_name, r.supervisor, r.booking_code, r.equipment_id, e.name as equipment_name, r.start_time, r.end_time, r.actual_start_time, r.actual_end_time, r.phone, r.email, r.total_cost, r.consumable_quantity, r.notes as reservation_notes
    FROM violation_records v
    LEFT JOIN reservations r ON v.reservation_id = r.id
    LEFT JOIN equipment e ON r.equipment_id = e.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (reservation_id) {
    query += ` AND v.reservation_id = ?`;
    params.push(reservation_id);
  }

  if (ids && typeof ids === 'string') {
    const idArray = ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    if (idArray.length > 0) {
      query += ` AND v.id IN (${idArray.map(() => '?').join(',')})`;
      params.push(...idArray);
    } else {
      query += ` AND 1=0`; // Return empty if invalid ids
    }
  } else {
    if (startDate) {
      query += ` AND v.violation_time >= ?`;
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query += ` AND v.violation_time <= ?`;
      params.push(`${endDate}T23:59:59.999Z`);
    }
  }

  if (appealStatus === 'appealing') {
    query += ` AND v.status = 'active' AND json_valid(v.remark) = 1 AND json_extract(v.remark, '$.appeal_reason') IS NOT NULL AND json_extract(v.remark, '$.appeal_reply') IS NULL`;
  } else if (appealStatus === 'rejected') {
    query += ` AND v.status = 'active' AND json_valid(v.remark) = 1 AND json_extract(v.remark, '$.appeal_reply') IS NOT NULL`;
  }

  query += ` ORDER BY v.violation_time DESC`;
  
  return db.prepare(query).all(...params);
}

export function createViolation(data: any) {
  const { student_id, booking_code, violation_type, violation_time, admin_note } = data;

  if (!student_id || !violation_type || !violation_time) {
    throw new Error('缺少必填字段');
  }

  const allowedTypes = ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'];
  if (!allowedTypes.includes(violation_type)) {
    throw new Error('不支持的违规类型');
  }

  let reservation_id = null;
  let actual_student_name = null;
  let email = null;
  let equipment_name = '无关联设备';

  if (booking_code) {
    const reservation = db.prepare('SELECT r.id, r.student_id, r.student_name, r.email, e.name as equipment_name FROM reservations r LEFT JOIN equipment e ON r.equipment_id = e.id WHERE r.booking_code = ?').get(booking_code) as any;
    if (!reservation) {
      throw new Error('预约码不存在');
    }
    if (reservation.student_id !== student_id) {
      throw new Error('预约码与学号不匹配');
    }
    reservation_id = reservation.id;
    actual_student_name = reservation.student_name;
    email = reservation.email;
    if (reservation.equipment_name) {
      equipment_name = reservation.equipment_name;
    }
  }

  const remark = admin_note ? JSON.stringify({ admin_note }) : null;
  
  const result = db.prepare(
    'INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, remark) VALUES (?, ?, ?, ?, ?)'
  ).run(student_id, reservation_id, violation_type, new Date(violation_time).toISOString(), remark);
  
  evaluatePenaltiesOnViolation(student_id);

  try {
    if (!email && !booking_code) {
        const resWithEmail = db.prepare('SELECT email, student_name FROM reservations WHERE student_id = ? AND email IS NOT NULL ORDER BY id DESC LIMIT 1').get(student_id) as any;
        if (resWithEmail) {
            email = resWithEmail.email;
            actual_student_name = resWithEmail.student_name;
        }
    }

    if (email) {
        try {
            notifyEvent(db, 'violation_created', {
                userId: student_id,
                userName: actual_student_name || student_id,
                violation_type,
                equipment_name,
                violation_time: new Date(violation_time).toISOString(),
                booking_code: booking_code || '无关联预约',
                admin_note: admin_note || ''
            }, email);
        } catch (err) {
            console.error('Failed to queue notification for standalone violation:', err);
        }
    }
  } catch (e) {
      console.error('Error fetching email for notification:', e);
  }

  return { id: result.lastInsertRowid };
}

export function updateViolation(id: string, data: any) {
  const { violation_type, remark } = data;

  if (!violation_type) {
    throw new Error('缺少违规类型字段');
  }

  const allowedTypes = ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'];
  if (!allowedTypes.includes(violation_type)) {
    throw new Error('不支持的违规类型');
  }

  const existing = db.prepare('SELECT student_id, remark, violation_type FROM violation_records WHERE id = ?').get(id) as any;
  if (!existing) {
    throw new Error('违规记录不存在');
  }
  
  if (!allowedTypes.includes(existing.violation_type)) {
    throw new Error('不允许修改系统自动生成的违规记录');
  }

  let finalRemark = existing.remark;
  if (remark !== undefined) {
    let remarkObj: any = {};
    try {
      remarkObj = existing.remark ? JSON.parse(existing.remark) : {};
    } catch(e) {}

    if (remark) {
      remarkObj.admin_note = remark;
    } else {
      delete remarkObj.admin_note;
    }
    finalRemark = Object.keys(remarkObj).length > 0 ? JSON.stringify(remarkObj) : null;
  }

  db.prepare('UPDATE violation_records SET violation_type = ?, remark = ? WHERE id = ?').run(violation_type, finalRemark, id);
  
  // Re-evaluate penalties just in case
  evaluatePenaltiesOnViolation(existing.student_id);
}

export function revokeViolation(id: string, remark: string) {
  const violationRecord = db.prepare('SELECT v.*, r.student_name, r.email FROM violation_records v LEFT JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?').get(id) as any;
  const violation = db.prepare('SELECT remark FROM violation_records WHERE id = ?').get(id) as any;

  let remarkObj: any = {};
  if (violation && violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  let newRemarkObj: any = {};
  try {
    newRemarkObj = JSON.parse(remark);
  } catch (e) {
    newRemarkObj = { admin_note: remark };
  }

  remarkObj.admin_note = newRemarkObj.admin_note;

  if (remarkObj.appeal_reason) {
    remarkObj.appeal_reply = newRemarkObj.admin_note || '申诉已通过，违规记录已撤销';
  }
  
  db.prepare("UPDATE violation_records SET status = 'revoked', remark = ? WHERE id = ?").run(JSON.stringify(remarkObj), id);
  
  // Auto-revoke any active user_penalties that relied on this violation
  db.prepare(`
    UPDATE user_penalties 
    SET status = 'revoked' 
    WHERE status = 'active' AND contributing_violation_ids LIKE ?
  `).run(`%,${id},%`);

  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'revoked',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }
}

export function restoreViolation(id: string, remark: string) {
  const violationRecord = db.prepare('SELECT v.*, r.student_name, r.email FROM violation_records v LEFT JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?').get(id) as any;
  const violation = db.prepare('SELECT remark FROM violation_records WHERE id = ?').get(id) as any;

  let remarkObj: any = {};
  if (violation && violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  let newRemarkObj: any = {};
  try {
    newRemarkObj = JSON.parse(remark);
  } catch (e) {
    newRemarkObj = { admin_note: remark };
  }

  remarkObj.admin_note = newRemarkObj.admin_note;

  if (remarkObj.appeal_reason) {
    remarkObj.appeal_reply = newRemarkObj.admin_note || '申诉已驳回，违规记录恢复生效';
  }

  db.prepare("UPDATE violation_records SET status = 'active', remark = ? WHERE id = ?").run(JSON.stringify(remarkObj), id);
  
  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'restored',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }
}

export function rejectAppeal(id: string, remark: string) {
  const violationRecord = db.prepare('SELECT v.*, r.student_name, r.email FROM violation_records v LEFT JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?').get(id) as any;
  const violation = db.prepare('SELECT remark FROM violation_records WHERE id = ?').get(id) as any;

  let remarkObj: any = {};
  if (violation && violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  let newRemarkObj: any = {};
  try {
    newRemarkObj = JSON.parse(remark);
  } catch (e) {
    newRemarkObj = { admin_note: remark };
  }

  remarkObj.admin_note = newRemarkObj.admin_note;
  remarkObj.appeal_reply = newRemarkObj.admin_note || '申诉已驳回';
  
  db.prepare("UPDATE violation_records SET remark = ? WHERE id = ?").run(JSON.stringify(remarkObj), id);

  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'rejected',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }
}
