import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import { getAdminToken } from './utils/auth-helper.js';
import jwt from 'jsonwebtoken';

describe('Violation & Penalty Module (04_violation_and_penalty.test.ts)', () => {
  const token = getAdminToken();
  const testStudentId = 'STU_TEST_001';
  const jwtSecret = process.env.JWT_SECRET || 'test-secret';
  const userToken = jwt.sign({ id: 999, student_id: testStudentId, role: 'student', user_id: 999 }, jwtSecret);

  beforeEach(() => {
    db.prepare('DELETE FROM penalty_rules').run();
    db.prepare('DELETE FROM user_penalties').run();
    db.prepare('DELETE FROM violation_records').run();
    db.prepare('DELETE FROM penalty_waivers').run();
    db.prepare('DELETE FROM whitelist_applications').run();
    db.prepare('DELETE FROM audit_logs').run();
    db.prepare('DELETE FROM reservations').run();
    db.prepare('DELETE FROM equipment').run();

    db.prepare(`
      INSERT OR IGNORE INTO equipment (id, name, price_type, price) VALUES (1, 'Test Equipment', 'hourly', 10)
    `).run();

    // Ensure default rule exists (improper_operation is allowed for manual entry)
    db.prepare(`
      INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
      VALUES (1, '违规操作封禁', 'improper_operation', 
        ?, 
        ?, 1)
    `).run(
      JSON.stringify({ metric: 'count', threshold: 2, window_type: 'rolling_days', period_days: 30 }),
      JSON.stringify({ duration_type: 'fixed', duration_days: 7, type: 'ban' })
    );
  });

  describe('1. Penalty Rules CRUD', () => {
    it('should list only active rules on public endpoint', async () => {
      // Create an inactive rule
      db.prepare(`
        INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
        VALUES (2, '停用规则', 'overdue', '{}', '{}', 0)
      `).run();

      const res = await request(app).get('/api/public/penalty-rules');
      expect(res.status).toBe(200);
      expect(res.body.some((r: any) => r.id === 1)).toBe(true);
      expect(res.body.some((r: any) => r.id === 2)).toBe(false);
    });

    it('should allow admin to get all rules', async () => {
      db.prepare(`
        INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
        VALUES (2, '停用规则', 'overdue', '{}', '{}', 0)
      `).run();
      
      const res = await request(app)
        .get('/api/admin/penalty-rules')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.some((r: any) => r.id === 1)).toBe(true);
      expect(res.body.some((r: any) => r.id === 2)).toBe(true);
    });

    it('should allow admin to create a new rule', async () => {
      const res = await request(app)
        .post('/api/admin/penalty-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '新规则',
          description: '测试',
          violation_type: 'improper_operation',
          trigger_config: { metric: 'count', threshold: 1, window_type: 'rolling_days', period_days: 30 },
          action_config: { duration_type: 'fixed', duration_days: 3, type: 'ban' },
          is_active: true
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
    });

    it('should allow admin to update an existing rule', async () => {
      const res = await request(app)
        .put('/api/admin/penalty-rules/1')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '更新规则',
          description: '测试2',
          violation_type: 'improper_operation',
          trigger_config: { metric: 'count', threshold: 3, window_type: 'rolling_days', period_days: 30 },
          action_config: { duration_type: 'fixed', duration_days: 3, type: 'ban' },
          is_active: false
        });

      expect(res.status).toBe(200);
      
      const rule = db.prepare('SELECT * FROM penalty_rules WHERE id = 1').get() as any;
      expect(rule.name).toBe('更新规则');
      expect(rule.is_active).toBe(0);
    });
  });

  describe('2. Core Penalty Evaluation (checkUserPenalty & User Status)', () => {
    it('should not penalize user with 1 improper_operation violation (below threshold 2)', async () => {
      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note'
        });

      const res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);

      expect(res.status).toBe(200);
      expect(res.body.isPenalized).toBe(false);
    });

    it('should trigger BAN when user reaches 2 improper_operation violations within 30 days', async () => {
      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note 1'
        });

      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note 2'
        });

      const res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);

      expect(res.status).toBe(200);
      expect(res.body.isPenalized).toBe(true);
      expect(res.body.penaltyMethod).toBe('BAN');
      expect(res.body.reason).toContain('违规操作封禁');
    });

    it('should ignore violations older than 30 days window', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 35);
      
      db.prepare(`
        INSERT INTO violation_records (student_id, violation_type, violation_time, status)
        VALUES (?, 'improper_operation', ?, 'active')
      `).run(testStudentId, pastDate.toISOString());

      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Recent one'
        });

      const res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);

      expect(res.status).toBe(200);
      expect(res.body.isPenalized).toBe(false);
    });

    it('should trigger REQUIRE_APPROVAL when rule penalty_method is require_approval', async () => {
      db.prepare('DELETE FROM penalty_rules WHERE id = 1').run(); 

      db.prepare(`
        INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
        VALUES (2, '操作限制审批', 'improper_operation', '{"metric":"count","threshold":2,"period_days":30}', '{"type":"require_approval"}', 1)
      `).run();

      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note 1'
        });
        
      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note 2'
        });

      const res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(res.status).toBe(200);
      expect(res.body.isPenalized).toBe(true);
      expect(res.body.penaltyMethod).toBe('REQUIRE_APPROVAL');
    });

    it('should prioritize BAN over REQUIRE_APPROVAL when both rules are triggered', async () => {
      db.prepare(`
        INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
        VALUES (2, '操作审批', 'improper_operation', '{"metric":"count","threshold":1,"period_days":30}', '{"type":"require_approval"}', 1)
      `).run();

      // We use the API to trigger evaluatePenaltiesOnViolation for rule 1
      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note 1'
        });
        
      await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note 2'
        });

      const res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(res.body.isPenalized).toBe(true);
      expect(res.body.penaltyMethod).toBe('BAN');
    });

    it('should trigger penalty when duration exceeds threshold in duration-based rule', async () => {
      db.prepare(`
        INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
        VALUES (3, '严重超时限制', 'overdue', '{"metric":"duration","threshold":120,"period_days":30}', '{"type":"ban"}', 1)
      `).run();

      db.prepare(`
        INSERT INTO violation_records (student_id, violation_type, duration_minutes, violation_time, status)
        VALUES (?, 'overdue', 60, datetime('now'), 'active')
      `).run(testStudentId);

      let res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(res.body.isPenalized).toBe(false);

      db.prepare(`
        INSERT INTO violation_records (student_id, violation_type, duration_minutes, violation_time, status)
        VALUES (?, 'overdue', 70, datetime('now'), 'active')
      `).run(testStudentId);

      res = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(res.body.isPenalized).toBe(true);
      expect(res.body.penaltyMethod).toBe('BAN');
    });
  });

  describe('3. Penalty Waiver Mechanism', () => {
    it('should waive current penalty and re-penalize if a 3rd violation occurs', async () => {
      await request(app).post('/api/admin/violations').set('Authorization', `Bearer ${token}`)
        .send({ student_id: testStudentId, violation_type: 'improper_operation', violation_time: new Date().toISOString() });
      await request(app).post('/api/admin/violations').set('Authorization', `Bearer ${token}`)
        .send({ student_id: testStudentId, violation_type: 'improper_operation', violation_time: new Date().toISOString() });

      const records = db.prepare('SELECT id FROM violation_records WHERE student_id = ? ORDER BY id ASC').all(testStudentId) as any[];
      const snapshot = `,${records.map(r => r.id).join(',')},`;
      const penaltyRecord = db.prepare(`SELECT id FROM user_penalties WHERE student_id = ? AND status = 'active'`).get(testStudentId) as any;

      await request(app).post('/api/admin/penalties/waive').set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          rule_id: 1,
          penalty_id: penaltyRecord?.id,
          contributing_violation_ids: snapshot,
          is_dynamic: false
        });

      let checkRes = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(checkRes.body.isPenalized).toBe(false);

      // Add a 3rd violation
      await request(app).post('/api/admin/violations').set('Authorization', `Bearer ${token}`)
        .send({ student_id: testStudentId, violation_type: 'improper_operation', violation_time: new Date().toISOString() });

      checkRes = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(checkRes.body.isPenalized).toBe(true);
      expect(checkRes.body.penaltyMethod).toBe('BAN');
    });
  });

  describe('4. Violations & Appeals Lifecycle', () => {
    it('should record violation and allow revoke', async () => {
      const createRes = await request(app).post('/api/admin/violations').set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note'
        });
      
      expect(createRes.status).toBe(200);

      const record = db.prepare('SELECT * FROM violation_records WHERE student_id = ?').get(testStudentId) as any;
      expect(record.status).toBe('active');

      const revokeRes = await request(app).post(`/api/admin/violations/${record.id}/revoke`).set('Authorization', `Bearer ${token}`)
        .send({ remark: 'Revoked' });
      
      expect(revokeRes.status).toBe(200);
      
      const updatedRecord = db.prepare('SELECT * FROM violation_records WHERE id = ?').get(record.id) as any;
      expect(updatedRecord.status).toBe('revoked');
    });

    it('should revoke violation and automatically unban user', async () => {
      const r1 = await request(app).post('/api/admin/violations').set('Authorization', `Bearer ${token}`)
        .send({ student_id: testStudentId, violation_type: 'improper_operation', violation_time: new Date().toISOString() });
      await request(app).post('/api/admin/violations').set('Authorization', `Bearer ${token}`)
        .send({ student_id: testStudentId, violation_type: 'improper_operation', violation_time: new Date().toISOString() });
      
      let checkRes = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(checkRes.body.isPenalized).toBe(true);

      const revokeRes = await request(app)
        .post(`/api/admin/violations/${r1.body.id || 1}/revoke`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remark: '误操作撤销' });
      expect(revokeRes.status).toBe(200);
      
      checkRes = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(checkRes.body.isPenalized).toBe(false);
    });

    it('should complete appeal and rejection lifecycle', async () => {
      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (999, ?, 'Test Student', '12345678901', 'test@test.com', 'B-1234', 1, datetime('now'), datetime('now', '+1 hour'), 'completed', 'admin')
      `).run(testStudentId);

      db.prepare(`
        INSERT INTO violation_records (id, student_id, reservation_id, violation_type, violation_time, status)
        VALUES (101, ?, 999, 'improper_operation', datetime('now'), 'active')
      `).run(testStudentId);

      const appealRes = await request(app)
        .post('/api/violations/101/appeal')
        .send({ student_id: testStudentId, student_name: 'Test Student', appeal_reason: '设备本身异常导致的误报' });
      expect(appealRes.status).toBe(200);

      let record = db.prepare('SELECT * FROM violation_records WHERE id = 101').get() as any;
      expect(record.status).toBe('active'); // Status is active, but remark contains appeal
      expect(record.remark).toContain('设备本身异常');

      const rejectRes = await request(app)
        .post('/api/admin/violations/101/reject-appeal')
        .set('Authorization', `Bearer ${token}`)
        .send({ remark: JSON.stringify({ admin_note: '监控核实属于人为操作不当' }) });
      expect(rejectRes.status).toBe(200);

      record = db.prepare('SELECT * FROM violation_records WHERE id = 101').get() as any;
      expect(record.status).toBe('active'); 
      expect(record.remark).toContain('监控核实');
      expect(record.remark).toContain('设备本身异常'); // Appeal reason should still be there
    });

    it('should allow resolving appeal by revoking', async () => {
      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (1000, ?, 'Test Student', '12345678901', 'test@test.com', 'B-1000', 1, datetime('now'), datetime('now', '+1 hour'), 'completed', 'admin')
      `).run(testStudentId);

      db.prepare(`
        INSERT INTO violation_records (id, student_id, reservation_id, violation_type, violation_time, status)
        VALUES (102, ?, 1000, 'improper_operation', datetime('now'), 'active')
      `).run(testStudentId);

      await request(app)
        .post('/api/violations/102/appeal')
        .send({ student_id: testStudentId, student_name: 'Test Student', appeal_reason: '测试申诉同意' });

      const revokeRes = await request(app)
        .post('/api/admin/violations/102/revoke')
        .set('Authorization', `Bearer ${token}`)
        .send({ remark: '同意申诉' });
      expect(revokeRes.status).toBe(200);

      const record = db.prepare('SELECT * FROM violation_records WHERE id = 102').get() as any;
      expect(record.status).toBe('revoked'); 
      expect(record.remark).toContain('同意申诉');
    });
  });

  describe('10. Admin Settings - Violation Params', () => {
    it('should return violation parameters', async () => {
      // First ensure the setting exists in the db
      db.prepare(`
        INSERT INTO settings (key, value) 
        VALUES ('violation_late_grace_minutes', '42') 
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();

      const res = await request(app)
        .get('/api/admin/settings/violation-params')
        .set('Authorization', `Bearer ${token}`);
        
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('violation_late_grace_minutes', 42);
      expect(typeof res.body.violation_late_grace_minutes).toBe('number');
    });

    it('should fallback to defaults when records are missing', async () => {
      // Delete specific keys
      db.prepare(`DELETE FROM settings WHERE key IN ('violation_overtime_grace_minutes', 'violation_late_cancel_minutes', 'violation_no_show_grace_minutes')`).run();

      const res = await request(app)
        .get('/api/admin/settings/violation-params')
        .set('Authorization', `Bearer ${token}`);
        
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('violation_overtime_grace_minutes', 15);
      expect(res.body).toHaveProperty('violation_late_cancel_minutes', 120);
      expect(res.body).toHaveProperty('violation_no_show_grace_minutes', 30);
    });

    it('should block unauthorized access', async () => {
      const res = await request(app).get('/api/admin/settings/violation-params');
      expect(res.status).toBe(401);
    });
  });
});
