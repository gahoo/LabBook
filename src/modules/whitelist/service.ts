import { db } from '../../db/index.js';
import { notifyEvent } from '../notification/service.js';
import { OperationRejectError } from '../../lib/errors.js';

export function applyWhitelist(payload: any) {
  const { equipment_id, student_id, student_name, supervisor, phone, email } = payload;
  
  const stringFields = { student_id, student_name, supervisor, phone, email };
  for (const [key, val] of Object.entries(stringFields)) {
    if (typeof val !== 'string' || val.trim() === '') {
      throw new OperationRejectError(`${key} 不能为空且必须为字符串`, 400);
    }
  }
  if (equipment_id === undefined || equipment_id === null || isNaN(Number(equipment_id)) || !Number.isInteger(Number(equipment_id))) {
    throw new OperationRejectError('equipment_id 必须为有效的整数', 400);
  }
  if (student_name.length > 100 || supervisor.length > 100) {
    throw new OperationRejectError('姓名或导师名称过长（上限100字符）', 400);
  }
  if (supervisor.includes('教授') || supervisor.includes('老师')) {
    throw new OperationRejectError('导师姓名请直接填写真实姓名，请勿包含“教授”或“老师”等称谓', 400);
  }

  
  const existing = db.prepare(`SELECT status FROM whitelist_applications WHERE student_id = ? AND equipment_id = ? AND status IN ('pending', 'approved')`).get(student_id, equipment_id) as any;
  if (existing) {
    throw new OperationRejectError(`您已经申请过该仪器的白名单，且当前状态为${existing.status === 'pending' ? '待审批' : '已通过'}`, 400);
  }

  const stmt = db.prepare(`
    INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(equipment_id, student_id, student_name, supervisor, phone, email);
}

export function listApplications(status?: string) {
  let apps;
  if (status) {
    apps = db.prepare(`
      SELECT wa.*, e.name as equipment_name 
      FROM whitelist_applications wa
      JOIN equipment e ON wa.equipment_id = e.id
      WHERE wa.status = ?
      ORDER BY wa.created_at DESC
    `).all(status);
  } else {
    apps = db.prepare(`
      SELECT wa.*, e.name as equipment_name 
      FROM whitelist_applications wa
      JOIN equipment e ON wa.equipment_id = e.id
      ORDER BY wa.created_at DESC
    `).all();
  }
  return apps;
}

export function approveApplication(id: string | number) {
  const app = db.prepare('SELECT * FROM whitelist_applications WHERE id = ?').get(id) as any;
  if (!app) throw new OperationRejectError('未找到申请');
  if (app.status !== 'pending') throw new OperationRejectError('只能对待审批的申请进行操作');

  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(app.equipment_id) as any;
  if (!equipment) throw new OperationRejectError('未找到仪器');

  let whitelist = (equipment.whitelist_data || '').split(/[\n,，]/).map((s: string) => s.trim()).filter(Boolean);
  if (!whitelist.includes(app.student_name.trim())) {
    whitelist.push(app.student_name.trim());
  }
  
  db.prepare('UPDATE equipment SET whitelist_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(whitelist.join('\n'), app.equipment_id);
  db.prepare("UPDATE whitelist_applications SET status = 'approved' WHERE id = ?").run(id);

  notifyEvent(db, 'whitelist_resolved', {
    student_id: app.student_id,
    student_name: app.student_name,
    equipment_name: equipment.name,
    resolution: 'approved',
    reason: app.reason || ''
  }, app.email || undefined);
}

export function rejectApplication(id: string | number) {
  const appRecord = db.prepare('SELECT * FROM whitelist_applications WHERE id = ?').get(id) as any;
  if (!appRecord) throw new OperationRejectError('未找到申请');
  if (appRecord.status !== 'pending') throw new OperationRejectError('只能对待审批的申请进行操作');
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(appRecord.equipment_id) as any;

  db.prepare("UPDATE whitelist_applications SET status = 'rejected' WHERE id = ?").run(id);

  notifyEvent(db, 'whitelist_resolved', {
    student_id: appRecord.student_id,
    student_name: appRecord.student_name,
    equipment_name: equipment ? equipment.name : '未知仪器',
    resolution: 'rejected',
    reason: appRecord.reason || ''
  }, appRecord.email || undefined);
}
