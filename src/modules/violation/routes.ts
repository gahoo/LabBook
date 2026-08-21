import { Router } from 'express';
import { db } from '../../db/index.js';
import { adminAuth } from '../../middleware/auth.js';
import { notifyEvent } from '../notification/service.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation, getNaturalPeriodStart, getNextNaturalPeriodStart } from './service.js';
import { getPublicRules, getAdminRules, createRule, updateRule, deleteRule, simulateRule } from './rules.js';
import { validateTimeRange } from '../../lib/validators.js'; // if exists

const router = Router();

router.get('/api/public/penalty-rules', (req, res) => {
  try {
    const rules = getPublicRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch penalty rules' });
  }
});

router.get('/api/admin/penalty-rules', adminAuth, (req, res) => {
  try {
    const rules = getAdminRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch penalty rules' });
  }
});

router.post('/api/admin/penalty-rules', adminAuth, (req, res) => {
  try {
    const result = createRule(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create penalty rule' });
  }
});

router.put('/api/admin/penalty-rules/:id', adminAuth, (req, res) => {
  try {
    const result = updateRule(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update penalty rule' });
  }
});

router.delete('/api/admin/penalty-rules/:id', adminAuth, (req, res) => {
  try {
    const result = deleteRule(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete penalty rule' });
  }
});

router.get('/api/user/active-penalties', (req, res) => {
  const student_id = req.query.student_id as string;
  if (!student_id) {
    return res.status(400).json({ error: 'Missing student_id' });
  }
  try {
    const penalty = checkUserPenalty(student_id);
    res.json(penalty);
  } catch (error) {
    console.error('Error fetching active penalties:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/violations/my', (req, res) => {
  const { student_id, student_name, violation_ids } = req.body;
  if (typeof student_id !== 'string' || typeof student_name !== 'string' || !student_id.trim() || !student_name.trim()) {
    return res.status(400).json({ error: 'Missing credentials' });
  }
  
  let query = `
    SELECT v.*, r.student_id, r.student_name, r.booking_code, e.name as equipment_name 
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
  
  res.json({ violations, userPenaltyDetails });
});

router.post('/api/violations/:id/appeal', (req, res) => {
  const { id } = req.params;
  const { student_id, student_name, appeal_reason } = req.body;
  
  if (typeof student_id !== 'string' || typeof student_name !== 'string' || typeof appeal_reason !== 'string') {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!student_id.trim() || !student_name.trim() || !appeal_reason.trim()) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (appeal_reason.length > 2000) {
    return res.status(400).json({ error: '申诉理由过长（上限2000字符）' });
  }

  const violation = db.prepare(`
    SELECT v.*, r.student_id, r.student_name 
    FROM violation_records v
    JOIN reservations r ON v.reservation_id = r.id
    WHERE v.id = ?
  `).get(id) as any;
  
  if (!violation) return res.status(404).json({ error: 'Record not found' });
  if (violation.student_id !== student_id || violation.student_name !== student_name) {
    return res.status(403).json({ error: 'Unauthorized' });
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
    return res.status(400).json({ error: 'Already appealed' });
  }
  
  remarkObj.appeal_reason = appeal_reason;
  remarkObj.appeal_time = new Date().toISOString();
  
  db.prepare('UPDATE violation_records SET remark = ? WHERE id = ?').run(JSON.stringify(remarkObj), id);
  
  res.json({ success: true });
});

router.get('/api/admin/violations', adminAuth, (req, res) => {
  const { startDate, endDate, ids, appealStatus, reservation_id } = req.query;

  const hasSpecificId = reservation_id || (ids && typeof ids === 'string' && ids.trim() !== '');
  if (!hasSpecificId) {
    if (!validateTimeRange(req, res)) return;
  }

  let query = `
    SELECT v.*, r.student_name, r.supervisor, r.booking_code, r.equipment_id, e.name as equipment_name, r.start_time, r.end_time, r.actual_start_time, r.actual_end_time, r.phone, r.email, r.total_cost, r.consumable_quantity, r.notes as reservation_notes
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
  
  const records = db.prepare(query).all(...params);
  res.json(records);
});

router.post('/api/admin/penalty-rules/simulate', adminAuth, (req, res) => {
  const { trigger, action, start_date, end_date } = req.body;
  
  try {
    const results = simulateRule(trigger, action, start_date, end_date);
    res.json(results);
  } catch (error: any) {
    console.error('Simulation error:', error);
    res.status(error.message === 'Missing required parameters' ? 400 : 500)
       .json({ error: error.message === 'Missing required parameters' ? error.message : '模拟执行失败: ' + (error.message || String(error)) });
  }
});

router.post('/api/admin/violations', adminAuth, (req, res) => {
  const { student_id, booking_code, violation_type, violation_time, admin_note } = req.body;

  if (!student_id || !violation_type || !violation_time) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const allowedTypes = ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'];
  if (!allowedTypes.includes(violation_type)) {
    return res.status(400).json({ error: '不支持的违规类型' });
  }

  try {
    let reservation_id = null;
    let actual_student_name = null;
    let email = null;
    let equipment_name = '无关联设备';

    if (booking_code) {
      const reservation = db.prepare('SELECT r.id, r.student_id, r.student_name, r.email, e.name as equipment_name FROM reservations r LEFT JOIN equipment e ON r.equipment_id = e.id WHERE r.booking_code = ?').get(booking_code) as any;
      if (!reservation) {
        return res.status(400).json({ error: '预约码不存在' });
      }
      if (reservation.student_id !== student_id) {
        return res.status(400).json({ error: '预约码与学号不匹配' });
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

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Error adding standalone violation:', error);
    res.status(500).json({ error: '添加失败：服务器内部错误' });
  }
});

router.put('/api/admin/violations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { violation_type, remark } = req.body;

  if (!violation_type) {
    return res.status(400).json({ error: '缺少违规类型字段' });
  }

  const allowedTypes = ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'];
  if (!allowedTypes.includes(violation_type)) {
    return res.status(400).json({ error: '不支持的违规类型' });
  }

  const existing = db.prepare('SELECT student_id, remark, violation_type FROM violation_records WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: '违规记录不存在' });
  }
  
  if (!allowedTypes.includes(existing.violation_type)) {
    return res.status(400).json({ error: '不允许修改系统自动生成的违规记录' });
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

  try {
    db.prepare('UPDATE violation_records SET violation_type = ?, remark = ? WHERE id = ?').run(violation_type, finalRemark, id);
    
    // Re-evaluate penalties just in case
    evaluatePenaltiesOnViolation(existing.student_id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/api/admin/violations/:id/revoke', adminAuth, (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  
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

  res.json({ success: true });
});

router.post('/api/admin/violations/:id/restore', adminAuth, (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  
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
  
  // Note: We don't automatically restore user_penalties because we don't know if they should still be active
  // based on current time, or if other violations have occurred. The next violation will trigger a re-evaluation.
  
  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'restored',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }

  res.json({ success: true });
});

router.post('/api/admin/violations/:id/reject-appeal', adminAuth, (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  
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

  res.json({ success: true });
});

router.post('/api/admin/penalties/batch', adminAuth, (req, res) => {
  const { rule_id, student_ids } = req.body;
  
  if (!rule_id || !student_ids || !Array.isArray(student_ids)) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const rule = db.prepare('SELECT * FROM penalty_rules WHERE id = ?').get(rule_id) as any;
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  
  const trigger = JSON.parse(rule.trigger_config);
  const action = JSON.parse(rule.action_config);
  
  if (action.duration_type === 'dynamic') {
    return res.status(400).json({ error: 'Cannot batch insert for dynamic duration rules' });
  }

  const durationDays = action.duration_days || 0;
  const penaltyMethod = action.type;
  
  const now = new Date();
  const nowStr = now.toISOString();

  const insertTx = db.transaction((students: string[]) => {
    let count = 0;
    for (const student_id of students) {
      // Check if there is already an active penalty for this rule and student
      const existingPenalty = db.prepare(`
        SELECT id FROM user_penalties 
        WHERE student_id = ? AND rule_id = ? AND end_time > ? AND status = 'active'
      `).get(student_id, rule_id, nowStr);

      if (!existingPenalty) {
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + durationDays);

        const restrictionsData: any = {};
        if (action.params && action.params.cancel_future_reservations) {
          restrictionsData.cancel_future_reservations = true;
        }
        if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
          restrictionsData.restricted_equipment_ids = trigger.scope;
        }

        db.prepare(`
          INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(student_id, rule_id, penaltyMethod, JSON.stringify(restrictionsData), nowStr, endDate.toISOString());
        
        count++;

        // Cancel future reservations if configured
        if (action.params && action.params.cancel_future_reservations) {
          const futureReservations = db.prepare(`
            SELECT id, equipment_id FROM reservations 
            WHERE student_id = ? AND status = 'approved' AND start_time > ?
          `).all(student_id, nowStr) as any[];
          
          for (const rev of futureReservations) {
            if (trigger.scope && trigger.scope.length > 0) {
              if (!trigger.scope.includes(String(rev.equipment_id)) && !trigger.scope.includes(Number(rev.equipment_id))) {
                continue;
              }
            }
            db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(rev.id);
          }
        }
      }
    }
    return count;
  });

  try {
    const count = insertTx(student_ids);
    res.json({ success: true, count });
  } catch (err) {
    console.error('Batch insert penalties failed:', err);
    res.status(500).json({ error: 'Failed to batch insert penalties' });
  }
});

router.post('/api/admin/penalties/waive', adminAuth, (req, res) => {
  const { penalty_id, student_id, rule_id, contributing_violation_ids, is_dynamic } = req.body;
  
  if (!student_id || !rule_id || !contributing_violation_ids) {
    return res.status(400).json({ error: '缺少必要的参数' });
  }

  try {
    db.transaction(() => {
      let user_penalty_id = null;
      if (!is_dynamic && penalty_id) {
        user_penalty_id = penalty_id;
        db.prepare("UPDATE user_penalties SET status = 'waived' WHERE id = ?").run(penalty_id);
      }
      
      db.prepare(`
        INSERT INTO penalty_waivers (student_id, rule_id, violation_ids, user_penalty_id)
        VALUES (?, ?, ?, ?)
      `).run(student_id, rule_id, contributing_violation_ids, user_penalty_id);
    })();
    
    res.json({ success: true });
  } catch(e) {
    console.error('Error waiving penalty:', e);
    res.status(500).json({ error: '豁免失败' });
  }
});

router.get('/api/admin/violations/stats', adminAuth, (req, res) => {
  if (!validateTimeRange(req, res)) return;
  
  const { startDate, endDate, dimension = 'user' } = req.query as { startDate?: string, endDate?: string, dimension?: 'user' | 'supervisor' | 'equipment' };
  
  let query = `
    SELECT v.*, r.student_name, r.supervisor, r.equipment_id, e.name as equipment_name
    FROM violation_records v
    LEFT JOIN reservations r ON v.reservation_id = r.id
    LEFT JOIN equipment e ON r.equipment_id = e.id
    WHERE v.status = 'active'
  `;
  const params: any[] = [];

  let resQuery = `
    SELECT r.student_id, r.student_name, r.supervisor, r.equipment_id, e.name as equipment_name, COUNT(1) as total_reservations,
    SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as normal_cancelled_count
    FROM reservations r
    LEFT JOIN equipment e ON r.equipment_id = e.id
    WHERE 1=1
  `;
  const resParams: any[] = [];

  if (startDate) {
    query += ` AND v.violation_time >= ?`;
    params.push(`${startDate}T00:00:00.000Z`);
    resQuery += ` AND r.start_time >= ?`;
    resParams.push(`${startDate}T00:00:00.000Z`);
  }
  if (endDate) {
    query += ` AND v.violation_time <= ?`;
    params.push(`${endDate}T23:59:59.999Z`);
    resQuery += ` AND r.start_time <= ?`;
    resParams.push(`${endDate}T23:59:59.999Z`);
  }

  // Reservation basis grouping
  if (dimension === 'user') {
    resQuery += ` GROUP BY r.student_id`;
  } else if (dimension === 'supervisor') {
    resQuery += ` GROUP BY r.supervisor`;
  } else if (dimension === 'equipment') {
    resQuery += ` GROUP BY r.equipment_id`;
  }

  const violationsRaw = db.prepare(query).all(...params) as any[];
  const reservationsBasis = db.prepare(resQuery).all(...resParams) as any[];
  
  const nowStr = new Date().toISOString();
  const activePenaltiesRaw = db.prepare(`SELECT student_id, penalty_method FROM user_penalties WHERE status = 'active' AND end_time > ?`).all(nowStr) as any[];
  const penaltyMap = new Map();
  for (const p of activePenaltiesRaw) {
    penaltyMap.set(p.student_id, p.penalty_method);
  }

  const resBasisMap = new Map();
  for (const rb of reservationsBasis) {
    if (dimension === 'user') resBasisMap.set(rb.student_id || 'unknown', { total: rb.total_reservations, cancelled: rb.normal_cancelled_count });
    else if (dimension === 'supervisor') resBasisMap.set(rb.supervisor || '未知', { total: rb.total_reservations, cancelled: rb.normal_cancelled_count });
    else if (dimension === 'equipment') resBasisMap.set(String(rb.equipment_id) || 'unknown', { total: rb.total_reservations, cancelled: rb.normal_cancelled_count });
  }

  const statsMap = new Map();

  violationsRaw.forEach((v: any) => {
    let key = '';
    let name = '';
    
    if (dimension === 'user') {
      key = `${v.student_id}`;
      name = v.student_name || '未知';
    } else if (dimension === 'supervisor') {
      key = v.supervisor || '未知';
      name = v.supervisor || '未知';
    } else if (dimension === 'equipment') {
      key = String(v.equipment_id) || 'unknown';
      name = v.equipment_name || `设备 ${v.equipment_id}`;
    }

    if (!statsMap.has(key)) {
      statsMap.set(key, {
        key,
        name,
        supervisor: dimension === 'user' ? (v.supervisor || '未知') : null,
        late_count: 0,
        total_late_minutes: 0,
        overtime_count: 0,
        total_overtime_minutes: 0,
        noshow_count: 0,
        late_cancelled_count: 0,
        hygiene_issue: 0,
        improper_operation: 0,
        proxy_booking: 0,
        other_manual: 0,
        sub_items: {} // To store counts for inner aggregation (e.g., top equipment / top student)
      });
    }
    
    const p = statsMap.get(key);
    
    // Update name if better name available
    if (dimension === 'user' && p.name === '未知' && v.student_name) p.name = v.student_name;

    // Track sub-items
    if (dimension === 'user' && v.equipment_name) {
      p.sub_items[v.equipment_name] = (p.sub_items[v.equipment_name] || 0) + 1;
    } else if (dimension === 'supervisor' && v.student_name) {
      p.sub_items[v.student_name] = (p.sub_items[v.student_name] || 0) + 1;
    } else if (dimension === 'equipment' && v.student_name) {
      p.sub_items[v.student_name] = (p.sub_items[v.student_name] || 0) + 1;
    }
    
    const minutes = v.duration_minutes || 0;

    if (v.violation_type === 'late') { p.late_count++; p.total_late_minutes += minutes; }
    else if (v.violation_type === 'overdue') { p.overtime_count++; p.total_overtime_minutes += minutes; }
    else if (v.violation_type === 'no-show') p.noshow_count++;
    else if (v.violation_type === 'late_cancel') p.late_cancelled_count++;
    else if (v.violation_type === 'hygiene_issue') p.hygiene_issue++;
    else if (v.violation_type === 'improper_operation') p.improper_operation++;
    else if (v.violation_type === 'proxy_booking') p.proxy_booking++;
    else p.other_manual++;
  });

  const violations = Array.from(statsMap.values()).map(p => {
    // Determine top sub-item
    let top_sub_item = '';
    let sub_items_list: {name: string, count: number}[] = [];
    if (Object.keys(p.sub_items).length > 0) {
      sub_items_list = Object.entries(p.sub_items).sort((a: any, b: any) => b[1] - a[1]).map(entry => ({ name: entry[0], count: entry[1] as number }));
      top_sub_item = `${sub_items_list[0].name} (${sub_items_list[0].count}次)`;
    }
    delete p.sub_items; // remove helper

    const penaltyScore = p.late_count + p.overtime_count + p.noshow_count;
    const totalViolations = penaltyScore + p.late_cancelled_count + p.hygiene_issue + p.improper_operation + p.proxy_booking + p.other_manual;
    
    const basis = resBasisMap.get(p.key) || { total: 0, cancelled: 0 };
    const totalReservations = basis.total;
    const normalCancelledCount = Math.max(0, basis.cancelled - p.late_cancelled_count);
    const violationRate = totalReservations > 0 ? (totalViolations / totalReservations) : 0;

    let activePenaltyMethod = null;
    if (dimension === 'user' && penaltyMap.has(p.key)) {
      activePenaltyMethod = penaltyMap.get(p.key);
    }

    return {
      ...p,
      active_penalty: activePenaltyMethod,
      top_sub_item,
      sub_items_list,
      total_reservations: totalReservations,
      normal_cancelled_count: normalCancelledCount,
      violation_rate: violationRate,
      total_violations: totalViolations
    };
  }).sort((a, b) => b.total_violations - a.total_violations || b.violation_rate - a.violation_rate);

  res.json(violations);
});

router.get('/api/admin/settings/violation-params', adminAuth, (req, res) => {
  const keys = ['violation_late_grace_minutes', 'violation_overtime_grace_minutes', 'violation_late_cancel_minutes', 'violation_no_show_grace_minutes'];
  const settingsRows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys) as any[];
  
  const map = {
    violation_late_grace_minutes: 15,
    violation_overtime_grace_minutes: 15,
    violation_late_cancel_minutes: 120,
    violation_no_show_grace_minutes: 30
  };
  
  for (const row of settingsRows) {
    const parsed = parseInt(row.value, 10);
    if (!isNaN(parsed)) {
      (map as any)[row.key] = parsed;
    }
  }
  
  res.json(map);
});

router.get('/api/admin/penalties/active', adminAuth, (req, res) => {
  const now = new Date();
  const nowStr = now.toISOString();

  // 1. Get fixed penalties
  const fixedPenalties = db.prepare(`
    SELECT p.*, pr.name as rule_name, 
      (SELECT student_name FROM reservations r WHERE r.student_id = p.student_id ORDER BY id DESC LIMIT 1) as student_name,
      (SELECT supervisor FROM reservations r WHERE r.student_id = p.student_id ORDER BY id DESC LIMIT 1) as supervisor
    FROM user_penalties p
    LEFT JOIN penalty_rules pr ON p.rule_id = pr.id
    WHERE p.status = 'active' AND p.end_time > ?
    ORDER BY p.start_time DESC
  `).all(nowStr) as any[];

  // 2. Calculate dynamic penalties
  const dynamicPenalties: any[] = [];
  const activeRules = db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1').all() as any[];

  for (const rule of activeRules) {
    const trigger = JSON.parse(rule.trigger_config);
    const action = JSON.parse(rule.action_config);
    
    // Skip fixed duration rules as they are handled by user_penalties table
    if (action.duration_type === 'fixed' && action.duration_days) continue;

    let windowStartStr = '';
    if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
      windowStartStr = getNaturalPeriodStart(now, trigger.period_type || 'month').toISOString();
    } else {
      let windowStart = new Date(now);
      windowStart.setDate(windowStart.getDate() - (trigger.period_days || 30));
      windowStartStr = windowStart.toISOString();
    }

    const violationTypes = trigger.violation_types || [trigger.violation_type || rule.violation_type];
    const typePlaceholders = violationTypes.map(() => '?').join(',');

    let scopeCondition = '';
    let queryParams: any[] = [...violationTypes, windowStartStr];

    if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
      const placeholders = trigger.scope.map(() => '?').join(',');
      scopeCondition = `AND reservation_id IN (SELECT id FROM reservations WHERE equipment_id IN (${placeholders}))`;
      queryParams.push(...trigger.scope);
    }
    
    queryParams.push(trigger.threshold);

    let query = '';
    if (trigger.metric === 'count') {
      if (trigger.count_strategy === 'by_reservation') {
        query = `
          SELECT student_id, COUNT(DISTINCT reservation_id) as metric_value, GROUP_CONCAT(id) as contributing_ids 
          FROM violation_records 
          WHERE status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ? ${scopeCondition} 
          GROUP BY student_id 
          HAVING metric_value >= ?
        `;
      } else {
        query = `
          SELECT student_id, COUNT(id) as metric_value, GROUP_CONCAT(id) as contributing_ids 
          FROM violation_records 
          WHERE status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ? ${scopeCondition} 
          GROUP BY student_id 
          HAVING metric_value >= ?
        `;
      }
    } else if (trigger.metric === 'duration') {
      query = `
        SELECT student_id, SUM(duration_minutes) as metric_value, GROUP_CONCAT(id) as contributing_ids 
        FROM violation_records 
        WHERE status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ? ${scopeCondition} 
        GROUP BY student_id 
        HAVING metric_value >= ?
      `;
    }

    const affectedUsers = db.prepare(query).all(...queryParams) as any[];

    for (const user of affectedUsers) {
      const ids = user.contributing_ids.split(',').filter(Boolean).map(Number);
      const sortedIds = [...ids].sort((a, b) => a - b);
      const snapshot = `,${sortedIds.join(',')},`;
      
      const isWaived = db.prepare('SELECT id FROM penalty_waivers WHERE student_id = ? AND rule_id = ? AND violation_ids = ?').get(user.student_id, rule.id, snapshot);
      if (isWaived) {
        continue;
      }

      const records = db.prepare(`
        SELECT violation_time, duration_minutes 
        FROM violation_records 
        WHERE id IN (${ids.map(()=>'?').join(',')}) 
        ORDER BY violation_time ASC
      `).all(...ids) as any[];

      let unbanTime: Date | null = null;
      let currentMetric = user.metric_value;

      for (const rec of records) {
        if (trigger.metric === 'count') {
          currentMetric -= 1;
        } else {
          currentMetric -= (rec.duration_minutes || 0);
        }

        if (currentMetric < trigger.threshold) {
          if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
            unbanTime = getNextNaturalPeriodStart(now, trigger.period_type || 'month');
          } else {
            const vTime = new Date(rec.violation_time);
            vTime.setDate(vTime.getDate() + (trigger.period_days || 30));
            unbanTime = vTime;
          }
          break;
        }
      }

      const studentInfoRow = db.prepare('SELECT student_name, supervisor FROM reservations WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(user.student_id) as any;

      dynamicPenalties.push({
        id: `dynamic_${rule.id}_${user.student_id}`,
        student_id: user.student_id,
        student_name: studentInfoRow ? studentInfoRow.student_name : user.student_id,
        supervisor: studentInfoRow ? studentInfoRow.supervisor : null,
        rule_name: rule.name,
        penalty_method: action.type,
        start_time: records[records.length - 1].violation_time,
        end_time: unbanTime ? unbanTime.toISOString() : null,
        status: 'active',
        is_dynamic: true,
        contributing_violation_ids: snapshot,
        rule_id: rule.id
      });
    }
  }

  const allPenalties = [...fixedPenalties, ...dynamicPenalties].sort((a, b) => {
    return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
  });

  res.json(allPenalties);
});
export default router;
