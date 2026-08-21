import { Router } from 'express';
import { db } from '../../db/index.js';
import { adminAuth } from '../../middleware/auth.js';
import { notifyEvent } from '../notification/service.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation, getNaturalPeriodStart, getNextNaturalPeriodStart } from './evaluator.js';
import { getPublicRules, getAdminRules, createRule, updateRule, deleteRule, simulateRule } from './rules.js';
import { batchPenalties, waivePenalty, getActivePenalties } from './penalty.js';

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
  try {
    const { rule_id, student_ids } = req.body;
    const count = batchPenalties(rule_id, student_ids);
    res.json({ success: true, count });
  } catch (err: any) {
    if (err.message === 'Missing required parameters') {
      res.status(400).json({ error: 'Missing required parameters' });
    } else if (err.message === 'Rule not found') {
      res.status(404).json({ error: 'Rule not found' });
    } else if (err.message === 'Cannot batch insert for dynamic duration rules') {
      res.status(400).json({ error: 'Cannot batch insert for dynamic duration rules' });
    } else {
      console.error('Batch insert penalties failed:', err);
      res.status(500).json({ error: 'Failed to batch insert penalties' });
    }
  }
});

router.post('/api/admin/penalties/waive', adminAuth, (req, res) => {
  try {
    waivePenalty(req.body);
    res.json({ success: true });
  } catch(e: any) {
    if (e.message === '缺少必要的参数') {
      res.status(400).json({ error: '缺少必要的参数' });
    } else {
      console.error('Error waiving penalty:', e);
      res.status(500).json({ error: '豁免失败' });
    }
  }
});

import { getViolationStats, getViolationParams } from './stats.js';

router.get('/api/admin/violations/stats', adminAuth, (req, res) => {
  if (!validateTimeRange(req, res)) return;
  const { startDate, endDate, dimension = 'user' } = req.query as { startDate?: string, endDate?: string, dimension?: 'user' | 'supervisor' | 'equipment' };
  try {
    const stats = getViolationStats(startDate, endDate, dimension);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching violation stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

router.get('/api/admin/settings/violation-params', adminAuth, (req, res) => {
  try {
    const params = getViolationParams();
    res.json({
      violation_late_grace_minutes: params.late_grace_minutes,
      violation_overtime_grace_minutes: params.overtime_grace_minutes,
      violation_late_cancel_minutes: params.late_cancel_minutes,
      violation_no_show_grace_minutes: params.no_show_grace_minutes
    });
  } catch (error) {
    console.error('Error fetching violation params:', error);
    res.status(500).json({ error: 'Failed to fetch parameters' });
  }
});

router.get('/api/admin/penalties/active', adminAuth, (req, res) => {
  try {
    const allPenalties = getActivePenalties();
    res.json(allPenalties);
  } catch (error) {
    console.error('Error fetching active penalties:', error);
    res.status(500).json({ error: '获取活跃惩罚失败' });
  }
});
export default router;
