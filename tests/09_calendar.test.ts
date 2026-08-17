import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
vi.unmock('express-rate-limit');
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import { getAdminToken } from './utils/auth-helper.js';
import { encryptID } from '../src/lib/crypto.js';
import crypto from 'crypto';

describe('Calendar Module (09_calendar.test.ts)', () => {
  const adminToken = getAdminToken();
  const studentId = 'CAL_STU_001';
  const bookingCode = 'CAL-123456';
  const equipmentId = 99;
  
  // Create a 64-char hex secret for testing AES-256
  const calendarSecret = crypto.randomBytes(32).toString('hex');

  beforeAll(() => {
    // Setup settings
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendar_subscription.enabled', 'true')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendar_sync_secret', ?)").run(calendarSecret);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('booking_upcoming_advance_minutes', '30')").run();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM reservations').run();
    db.prepare('DELETE FROM equipment').run();

    db.prepare(`
      INSERT INTO equipment (id, name, price_type, price)
      VALUES (?, 'Cal Equipment', 'hourly', 10)
    `).run(equipmentId);

    const now = new Date();
    const start = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    const end = new Date(start.getTime() + 1 * 60 * 60 * 1000); // 1 hour duration

    db.prepare(`
      INSERT INTO reservations (id, equipment_id, student_id, student_name, supervisor, phone, booking_code, email, start_time, end_time, status)
      VALUES (1, ?, ?, 'Cal User', 'Test Supervisor', '1234567890', ?, 'caluser@example.com', ?, ?, 'approved')
    `).run(equipmentId, studentId, bookingCode, start.toISOString(), end.toISOString());
  });

  describe('User Calendar Subscription', () => {
    it('GET /api/calendar/user/url - should return error if booking_code is missing', async () => {
      const res = await request(app).get('/api/calendar/user/url');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('booking_code is required');
    });

    it('GET /api/calendar/user/url - should return error if booking_code is invalid', async () => {
      const res = await request(app).get('/api/calendar/user/url?booking_code=INVALID');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Invalid booking code');
    });

    it('GET /api/calendar/user/url - should return webcal url when valid booking_code provided', async () => {
      const res = await request(app).get(`/api/calendar/user/url?booking_code=${bookingCode}`);
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/^webcal:\/\/.+\/api\/calendar\/user\/.+\.ics$/);
    });

    it('POST /api/calendar/user/mail - should send mail and return success', async () => {
      const res = await request(app)
        .post('/api/calendar/user/mail')
        .send({ booking_code: bookingCode });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.email).toBe('caluser@example.com');
    });

    it('POST /api/calendar/user/mail - should error if no email associated', async () => {
      // Remove email
      db.prepare("UPDATE reservations SET email = '' WHERE booking_code = ?").run(bookingCode);
      const res = await request(app)
        .post('/api/calendar/user/mail')
        .send({ booking_code: bookingCode });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No email');
    });

    it('POST /api/calendar/user/mail - should trigger rate limiter on excessive requests', async () => {
      // Restore email so it returns 200 on success
      db.prepare("UPDATE reservations SET email = 'caluser@example.com' WHERE booking_code = ?").run(bookingCode);
      
      let lastStatus = 200;
      let lastError = '';
      for (let i = 0; i < 15; i++) {
        const res = await request(app)
          .post('/api/calendar/user/mail')
          .send({ booking_code: bookingCode });
        if (res.status === 429) {
          lastStatus = 429;
          lastError = res.body?.error || '';
          break;
        }
      }
      expect(lastStatus).toBe(429);
      expect(lastError).toContain('频繁');
    });
  });

  describe('ICS File Generation', () => {
    it('GET /api/calendar/user/:token.ics - should return valid ICS content for user', async () => {
      const token = encryptID(studentId, calendarSecret);
      const res = await request(app).get(`/api/calendar/user/${token}.ics`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain('SUMMARY:[仪器预约] Cal Equipment');
      
      // VALARM Assertion: verify 30 minutes advance reminder
      expect(res.text).toContain('BEGIN:VALARM');
      expect(res.text).toContain('TRIGGER:-PT30M');
      
      // Timezone Defense: verify ICS uses strict UTC Z timezone format
      expect(res.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
      expect(res.text).toMatch(/DTEND:\d{8}T\d{6}Z/);
    });

    it('GET /api/calendar/user/:token.ics - should return 400 for invalid token', async () => {
      const res = await request(app).get(`/api/calendar/user/INVALID_TOKEN.ics`);
      expect(res.status).toBe(400);
      expect(res.text).toBe('Invalid token');
    });

    it('GET /api/calendar/equipment/:id/url - should return admin webcal url', async () => {
      const res = await request(app)
        .get(`/api/calendar/equipment/${equipmentId}/url`)
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/^webcal:\/\/.+\/api\/calendar\/equipment\/.+\.ics$/);
    });

    it('GET /api/calendar/equipment/:token.ics - should return valid ICS content for equipment', async () => {
      const token = encryptID(equipmentId, calendarSecret);
      const res = await request(app).get(`/api/calendar/equipment/${token}.ics`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      // Admin summary contains student info
      expect(res.text).toContain('SUMMARY:Cal User'); 
    });
  });
});
