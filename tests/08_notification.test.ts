import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { getAdminToken } from './utils/auth-helper.js';
import { db } from '../src/db/index.js';

describe('Notification Module (08_notification.test.ts)', () => {
  const token = getAdminToken();

  beforeAll(() => {
    db.prepare('DELETE FROM notifications').run();
  });

  afterAll(() => {
    db.prepare('DELETE FROM notifications').run();
  });

  describe('GET /api/admin/delivery-logs', () => {
    it('should fetch empty delivery logs initially', async () => {
      const res = await request(app)
        .get('/api/admin/delivery-logs')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.logs).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('should fetch inserted delivery logs', async () => {
      db.prepare(`
        INSERT INTO notifications (id, event, channel, target, payload, status, retry_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(999, 'booking_success', 'email', 'test@example.com', '{"subject": "Test"}', 'failed', 3);

      const res = await request(app)
        .get('/api/admin/delivery-logs')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].id).toBe(999);
      expect(res.body.total).toBe(1);
    });
  });

  describe('POST /api/admin/delivery-logs/:id/retry', () => {
    it('should reset retry_count and status to pending', async () => {
      const res = await request(app)
        .post('/api/admin/delivery-logs/999/retry')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      
      const log = db.prepare('SELECT * FROM notifications WHERE id = ?').get(999) as any;
      expect(log.status).toBe('pending');
      expect(log.retry_count).toBe(0);
    });
  });

  describe('POST /api/admin/notifications/test-connection', () => {
    it('should test webhook connection successfully', async () => {
      const res = await request(app)
        .post('/api/admin/notifications/test-connection')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'webhook',
          config: { url: 'http://example.com/webhook', secret: 'test-secret' }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Webhook 测试成功, 状态码: 200');
    });

    it('should test smtp connection successfully', async () => {
      const res = await request(app)
        .post('/api/admin/notifications/test-connection')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'smtp',
          config: { host: 'smtp.example.com', port: 587, secure: false, user: 'test', pass: 'test', from: 'test@example.com' }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('SMTP 连接成功');
    });
  });

  describe('POST /api/admin/notifications/test-event', () => {
    it('should push webhook event successfully', async () => {
      const res = await request(app)
        .post('/api/admin/notifications/test-event')
        .set('Authorization', `Bearer ${token}`)
        .send({
          event: 'booking_success',
          type: 'webhook',
          config: { url: 'http://example.com/webhook', secret: 'test-secret' },
          eventConfig: { template: '{"message": "Hello {student_name}"}' }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Webhook 推送成功');
    });

    it('should push email event successfully', async () => {
      const res = await request(app)
        .post('/api/admin/notifications/test-event')
        .set('Authorization', `Bearer ${token}`)
        .send({
          event: 'booking_success',
          type: 'smtp',
          config: { host: 'smtp.example.com', port: 587, secure: false, user: 'test', pass: 'test', from: 'test@example.com' },
          eventConfig: { subject: 'Test {student_name}', template: 'Hello {student_name}' },
          to_email: 'recipient@example.com'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('邮件推送测试成功');
    });
  });
});
