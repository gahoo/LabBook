import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { getAdminToken } from './utils/auth-helper.js';
import { db } from '../src/db/connection.js';
import * as schedulerService from '../src/modules/scheduler/service.js';

vi.mock('../src/modules/scheduler/service.js', () => ({
  reloadBackupCron: vi.fn(),
  startUpcomingReminderCron: vi.fn(),
  startEndingReminderCron: vi.fn(),
  startNoShowScanner: vi.fn(),
  initSchedulers: vi.fn()
}));

describe('Settings and Audit Module (07_settings_and_audit.test.ts)', () => {
  let adminToken: string;

  beforeAll(() => {
    adminToken = getAdminToken();
  });

  beforeEach(() => {
    // Insert common test settings
    const insertSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    insertSetting.run('public.test_key', 'public_value');
    insertSetting.run('smtp.test_secret', 'secret_value');
    insertSetting.run('webhook.test_secret', 'secret_value');
    insertSetting.run('calendar_sync_secret', 'secret_value');
  });

  afterEach(() => {
    // Cleanup test data
    db.prepare(`DELETE FROM settings WHERE key LIKE 'test_%' OR key LIKE 'public.test_%' OR key LIKE 'smtp.test_%' OR key LIKE 'webhook.test_%' OR key LIKE 'calendar_sync_%'`).run();
    db.prepare(`DELETE FROM audit_logs WHERE action = 'TEST_ACTION' OR action = 'update_settings'`).run();
    vi.clearAllMocks();
  });

  describe('GET /api/settings (Public)', () => {
    it('should return settings but hide sensitive keys', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(200);

      const settings = res.body;
      expect(settings).toHaveProperty('public.test_key', 'public_value');

      // Sensitive keys should be omitted
      expect(settings).not.toHaveProperty('smtp.test_secret');
      expect(settings).not.toHaveProperty('webhook.test_secret');
      expect(settings).not.toHaveProperty('calendar_sync_secret');
    });
  });

  describe('GET /api/admin/settings (Admin)', () => {
    it('should return all settings including sensitive ones', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const settings = res.body;
      expect(settings).toHaveProperty('public.test_key', 'public_value');
      expect(settings).toHaveProperty('smtp.test_secret', 'secret_value');
      expect(settings).toHaveProperty('webhook.test_secret', 'secret_value');
      expect(settings).toHaveProperty('calendar_sync_secret', 'secret_value');
    });

    it('should block unauthorized access', async () => {
      const res = await request(app).get('/api/admin/settings');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/admin/settings', () => {
    it('should block unauthorized access', async () => {
      const res = await request(app).post('/api/admin/settings').send({});
      expect(res.status).toBe(401);
    });

    it('should update settings successfully and trigger cron reload', async () => {
      const res = await request(app)
        .post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          'public.test_key': 'new_public_value',
          'auto_backup_cron': '0 0 * * *'
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      // Verify the update
      const verifyRes = await request(app).get('/api/settings');
      expect(verifyRes.body['public.test_key']).toBe('new_public_value');

      // Verify cron linkage
      expect(schedulerService.reloadBackupCron).toHaveBeenCalled();
    });

    it('should trigger startUpcomingReminderCron when upcoming reminder settings change', async () => {
      await request(app)
        .post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          'booking_upcoming_advance_minutes': '30'
        });

      expect(schedulerService.startUpcomingReminderCron).toHaveBeenCalled();
    });
    
    it('should trigger startEndingReminderCron when ending reminder settings change', async () => {
      await request(app)
        .post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          'booking_ending_advance_minutes': '10'
        });

      expect(schedulerService.startEndingReminderCron).toHaveBeenCalled();
    });

    it('should return 400 when trying to disable web delivery without email/webhook fallback', async () => {
      // Setup current state to have no email/webhook fallback
      db.prepare(`INSERT INTO settings (key, value) VALUES ('smtp.enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'`).run();
      db.prepare(`INSERT INTO settings (key, value) VALUES ('webhook.enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'`).run();

      const res = await request(app)
        .post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          'booking_code_delivery.web': 'false'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('必须至少保留一种有效的预约码获取途径');
    });

    it('should automatically write an audit log when settings are updated', async () => {
      // Clear all audit logs first
      db.prepare(`DELETE FROM audit_logs`).run();

      await request(app)
        .post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          'public.test_audit_key': 'audit_value'
        });

      // Assert that an audit log was created
      const logs = db.prepare(`SELECT * FROM audit_logs WHERE action = 'update_settings'`).all() as any[];
      expect(logs.length).toBe(1);
      
      const logDetails = JSON.parse(logs[0].new_data);
      expect(logDetails).toHaveProperty('public.test_audit_key', 'audit_value');
    });
  });

  describe('GET /api/admin/audit-logs', () => {
    it('should block unauthorized access', async () => {
      const res = await request(app).get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
    });

    it('should precisely filter audit logs by date range and order by newest first', async () => {
      // Clear all audit logs first for a clean test
      db.prepare(`DELETE FROM audit_logs`).run();
      
      const insertAudit = db.prepare(`
        INSERT INTO audit_logs (reservation_id, action, new_data, created_at)
        VALUES (?, 'TEST_ACTION', ?, ?)
      `);
      
      // 1. Log before range
      insertAudit.run(1001, 'log_before', '2023-01-01 10:00:00');
      // 2. Log in range (newer)
      insertAudit.run(1002, 'log_inside_newer', '2023-06-15 10:00:00');
      // 3. Log in range (older)
      insertAudit.run(1004, 'log_inside_older', '2023-06-10 10:00:00');
      // 4. Log after range
      insertAudit.run(1003, 'log_after', '2023-12-31 10:00:00');

      // Also create a reservation to test the JOIN
      // Make sure we have equipment 1 and student test_student
      db.prepare(`INSERT OR IGNORE INTO equipment (id, name, price_type, price) VALUES (1, 'Test Eq', 'free', 0)`).run();
      db.prepare(`INSERT INTO reservations (id, student_id, student_name, phone, email, equipment_id, start_time, end_time, status, booking_code, supervisor) VALUES (1002, 'test_student', 'Test', '12345678901', 'test@test.com', 1, '2023-06-15 10:00:00', '2023-06-15 11:00:00', 'approved', 'CODE123', 'admin')`).run();

      const res = await request(app)
        .get(`/api/admin/audit-logs?start_date=2023-06-01T00:00:00.000Z&end_date=2023-06-30T23:59:59.000Z`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2); // Strictly 2 results in range
      
      const returnedLog1 = res.body[0];
      const returnedLog2 = res.body[1];
      
      // Order by newest first
      expect(returnedLog1.new_data).toBe('log_inside_newer');
      expect(returnedLog2.new_data).toBe('log_inside_older');
      
      // Verify reservation join
      expect(returnedLog1.booking_code).toBe('CODE123');
      
      // Cleanup reservation
      db.prepare(`DELETE FROM reservations WHERE id = 1002`).run();
    });

    it('should require start_date and end_date', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
        
      expect(res.status).toBe(400); // Because validateTimeRange throws 400
    });
  });
});
