import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import { getAdminToken } from './utils/auth-helper.js';

describe('Violation & Penalty Module (04_violation_and_penalty.test.ts)', () => {
  const token = getAdminToken();
  const testStudentId = 'STU_TEST_001';

  beforeEach(() => {
    db.prepare('DELETE FROM penalty_rules').run();
    db.prepare('DELETE FROM user_penalties').run();
    db.prepare('DELETE FROM violation_records').run();
    db.prepare('DELETE FROM penalty_waivers').run();

    // Ensure default rule exists (improper_operation is allowed for manual entry)
    db.prepare(`
      INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active)
      VALUES (1, '违规操作封禁', 'improper_operation', 
        ?, 
        ?, 1)
    `).run(
      JSON.stringify({ metric: 'count', threshold: 2, window_type: 'rolling_days', period_days: 30 }),
      JSON.stringify({ duration_type: 'fixed', duration_days: 7, type: 'BAN' })
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
          action_config: { duration_type: 'fixed', duration_days: 3, type: 'BAN' },
          is_active: true
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
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
      
      // Directly insert an old violation bypassing API check so we don't trigger current penalty evaluation
      // Actually, POST API works too but evaluatePenaltiesOnViolation will skip it since it's 35 days ago.
      db.prepare(`
        INSERT INTO violation_records (student_id, violation_type, violation_time, status)
        VALUES (?, 'improper_operation', ?, 'active')
      `).run(testStudentId, pastDate.toISOString());

      // Add a recent one
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
  });

  describe('3. Penalty Waiver Mechanism', () => {
    it('should waive current penalty and unban user until next violation', async () => {
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

      // Get violation IDs
      const records = db.prepare('SELECT id FROM violation_records WHERE student_id = ? ORDER BY id ASC').all(testStudentId) as any[];
      const ids = records.map(r => r.id);
      const snapshot = `,${ids.join(',')},`;

      const penaltyRecord = db.prepare(`SELECT id FROM user_penalties WHERE student_id = ? AND status = 'active'`).get(testStudentId) as any;

      const waiveRes = await request(app)
        .post('/api/admin/penalties/waive')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          rule_id: 1,
          penalty_id: penaltyRecord?.id,
          contributing_violation_ids: snapshot,
          is_dynamic: false
        });

      expect(waiveRes.status).toBe(200);

      const checkRes = await request(app).get(`/api/user/active-penalties?student_id=${testStudentId}`);
      expect(checkRes.body.isPenalized).toBe(false);
    });
  });

  describe('4. Violations & Appeals Lifecycle', () => {
    it('should record violation and allow revoke', async () => {
      const createRes = await request(app)
        .post('/api/admin/violations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          student_id: testStudentId,
          violation_type: 'improper_operation',
          violation_time: new Date().toISOString(),
          admin_note: 'Test note'
        });
      
      expect(createRes.status).toBe(200);

      const record = db.prepare('SELECT * FROM violation_records WHERE student_id = ?').get(testStudentId) as any;
      expect(record.status).toBe('active');

      const revokeRes = await request(app)
        .post(`/api/admin/violations/${record.id}/revoke`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remark: 'Revoked' });
      
      expect(revokeRes.status).toBe(200);
      
      const updatedRecord = db.prepare('SELECT * FROM violation_records WHERE id = ?').get(record.id) as any;
      expect(updatedRecord.status).toBe('revoked');
    });
  });
});
