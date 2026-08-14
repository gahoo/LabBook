import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { getAdminToken } from './utils/auth-helper.js';
import { db } from '../src/db/connection.js';

describe('Settings and Audit Module (07_settings_and_audit.test.ts)', () => {
  let adminToken: string;

  beforeAll(() => {
    adminToken = getAdminToken();
    
    // Insert some sensitive and public settings for testing
    const insertSetting = db.prepare(`
      INSERT INTO settings (key, value) 
      VALUES (?, ?) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    insertSetting.run('public.test_key', 'public_value');
    insertSetting.run('smtp.test_secret', 'secret_value');
    insertSetting.run('webhook.test_secret', 'secret_value');
    insertSetting.run('calendar_sync_secret', 'secret_value');
    insertSetting.run('violation_late_grace_minutes', '15');
    
    // Insert a dummy audit log
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (reservation_id, action, new_data, created_at)
      VALUES (9999, 'TEST_ACTION', 'test details', CURRENT_TIMESTAMP)
    `);
    insertAudit.run();
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
    it('should update settings successfully', async () => {
      const res = await request(app)
        .post('/api/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          'public.test_key': 'new_public_value'
        });
        
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      
      // Verify the update
      const verifyRes = await request(app).get('/api/settings');
      expect(verifyRes.body['public.test_key']).toBe('new_public_value');
    });
  });

  describe('GET /api/admin/audit-logs', () => {
    it('should return audit logs within date range', async () => {
      // Setup dates for the query
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const res = await request(app)
        .get(`/api/admin/audit-logs?start_date=${yesterday.toISOString()}&end_date=${tomorrow.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`);
        
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      
      // We inserted a TEST_ACTION log in beforeAll
      const testLog = res.body.find((log: any) => log.action === 'TEST_ACTION');
      expect(testLog).toBeDefined();
      expect(testLog.new_data).toBe('test details');
    });

    it('should require start_date and end_date', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
        
      expect(res.status).toBe(400); // Because validateTimeRange throws 400
    });
  });
});
