import { Router } from 'express';
import { adminAuth } from '../../middleware/auth.js';
import { checkUserPenalty } from './evaluator.js';
import { getPublicRules, getAdminRules, createRule, updateRule, deleteRule, simulateRule } from './rules.js';
import { batchPenalties, waivePenalty, getActivePenalties } from './penalty.js';
import { getMyViolations, submitAppeal, getAdminViolations, createViolation, updateViolation, revokeViolation, restoreViolation, rejectAppeal } from './service.js';
import { validateTimeRange } from '../../lib/validators.js';
import { getViolationStats, getViolationParams } from './stats.js';

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
  try {
    const { student_id, student_name, violation_ids } = req.body;
    const result = getMyViolations(student_id, student_name, violation_ids);
    res.json(result);
  } catch (err: any) {
    if (err.message === 'Missing credentials') {
      res.status(400).json({ error: 'Missing credentials' });
    } else {
      console.error('Error fetching my violations:', err);
      res.status(500).json({ error: 'Failed to fetch violations' });
    }
  }
});

router.post('/api/violations/:id/appeal', (req, res) => {
  try {
    const { student_id, student_name, appeal_reason } = req.body;
    submitAppeal(req.params.id, student_id, student_name, appeal_reason);
    res.json({ success: true });
  } catch (err: any) {
    if (['Missing required fields', '申诉理由过长（上限2000字符）', 'Already appealed'].includes(err.message)) {
      res.status(400).json({ error: err.message });
    } else if (err.message === 'Record not found') {
      res.status(404).json({ error: 'Record not found' });
    } else if (err.message === 'Unauthorized') {
      res.status(403).json({ error: 'Unauthorized' });
    } else {
      console.error('Error appealing violation:', err);
      res.status(500).json({ error: 'Failed to appeal' });
    }
  }
});

router.get('/api/admin/violations', adminAuth, (req, res) => {
  const { ids, reservation_id } = req.query;
  const hasSpecificId = reservation_id || (ids && typeof ids === 'string' && ids.trim() !== '');
  if (!hasSpecificId) {
    if (!validateTimeRange(req, res)) return;
  }
  
  try {
    const records = getAdminViolations(req.query);
    res.json(records);
  } catch (err) {
    console.error('Error fetching admin violations:', err);
    res.status(500).json({ error: 'Failed to fetch violations' });
  }
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
  try {
    const result = createViolation(req.body);
    res.json({ success: true, id: result.id });
  } catch (err: any) {
    if (['缺少必填字段', '不支持的违规类型', '预约码不存在', '预约码与学号不匹配'].includes(err.message)) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Error adding standalone violation:', err);
      res.status(500).json({ error: '添加失败：服务器内部错误' });
    }
  }
});

router.put('/api/admin/violations/:id', adminAuth, (req, res) => {
  try {
    updateViolation(req.params.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    if (['缺少违规类型字段', '不支持的违规类型', '不允许修改系统自动生成的违规记录'].includes(err.message)) {
      res.status(400).json({ error: err.message });
    } else if (err.message === '违规记录不存在') {
      res.status(404).json({ error: err.message });
    } else {
      console.error('Error updating violation:', err);
      res.status(500).json({ error: '服务器内部错误' });
    }
  }
});

router.post('/api/admin/violations/:id/revoke', adminAuth, (req, res) => {
  try {
    revokeViolation(req.params.id, req.body.remark);
    res.json({ success: true });
  } catch (err) {
    console.error('Error revoking violation:', err);
    res.status(500).json({ error: 'Failed to revoke violation' });
  }
});

router.post('/api/admin/violations/:id/restore', adminAuth, (req, res) => {
  try {
    restoreViolation(req.params.id, req.body.remark);
    res.json({ success: true });
  } catch (err) {
    console.error('Error restoring violation:', err);
    res.status(500).json({ error: 'Failed to restore violation' });
  }
});

router.post('/api/admin/violations/:id/reject-appeal', adminAuth, (req, res) => {
  try {
    rejectAppeal(req.params.id, req.body.remark);
    res.json({ success: true });
  } catch (err) {
    console.error('Error rejecting appeal:', err);
    res.status(500).json({ error: 'Failed to reject appeal' });
  }
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

export { router as violationRouter };
