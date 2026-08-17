import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.unmock('express-rate-limit');
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import { getAdminToken } from './utils/auth-helper.js';
import { encryptID, decryptID } from '../src/lib/crypto.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

describe('Calendar Module (09_calendar.test.ts)', () => {
  const adminToken = getAdminToken();
  const userToken = jwt.sign({ id: 'some_user', role: 'user' }, process.env.JWT_SECRET || 'default_secret');

  const studentId = 'CAL_STU_001';
  const otherStudentId = 'CAL_STU_002';
  const bookingCodeApproved = 'CAL-APP-123';
  const bookingCodeCancelled = 'CAL-CAN-123';
  const bookingCodePending = 'CAL-PEN-123';
  const bookingCodeRejected = 'CAL-REJ-123';
  const bookingCodeOther = 'CAL-OTH-123';
  let equipmentId: number;

  const calendarSecret = crypto.randomBytes(32).toString('hex');
  let originalSettings: Record<string, string> = {};

  beforeEach(() => {
    // 1. Backup and override settings
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('calendar_subscription.enabled', 'calendar_sync_secret', 'booking_upcoming_advance_minutes', 'smtp.enabled', 'email.events.calendar_subscription.enabled', 'smtp.host', 'smtp.user', 'smtp.pass', 'smtp.from_email')").all() as any[];
    rows.forEach(r => { originalSettings[r.key] = r.value; });

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendar_subscription.enabled', 'true')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendar_sync_secret', ?)").run(calendarSecret);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('booking_upcoming_advance_minutes', '30')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.enabled', 'true')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email.events.calendar_subscription.enabled', 'true')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.host', 'smtp.example.com')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.user', 'user')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.pass', 'pass')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.from_email', 'noreply@example.com')").run();

    // 2. Clean test data
    db.prepare("DELETE FROM reservations WHERE booking_code LIKE 'CAL-%'").run();
    db.prepare("DELETE FROM equipment WHERE name LIKE 'CAL_%'").run();
    db.prepare("DELETE FROM notifications WHERE event = 'calendar_subscription'").run();

    // 3. Create test equipment
    const eqInfo = db.prepare(`INSERT INTO equipment (name, price_type, price) VALUES ('CAL_Eq_1', 'hourly', 10)`).run();
    equipmentId = eqInfo.lastInsertRowid as number;

    // 4. Create multi-status reservations
    const insertRes = db.prepare(`
      INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, booking_code, email, start_time, end_time, status)
      VALUES (?, ?, 'Cal User', 'Test Supervisor', '1234567890', ?, 'caluser@example.com', ?, ?, ?)
    `);

    const now = new Date();
    const t = (hoursToAdd: number) => new Date(now.getTime() + hoursToAdd * 3600000).toISOString();

    // CAL_STU_001's reservations
    insertRes.run(equipmentId, studentId, bookingCodeApproved, t(1), t(2), 'approved');
    insertRes.run(equipmentId, studentId, bookingCodeCancelled, t(3), t(4), 'cancelled');
    insertRes.run(equipmentId, studentId, bookingCodePending, t(5), t(6), 'pending');
    insertRes.run(equipmentId, studentId, bookingCodeRejected, t(7), t(8), 'rejected');

    // OTHER STUDENT's reservation
    insertRes.run(equipmentId, otherStudentId, bookingCodeOther, t(9), t(10), 'approved');
  });

  afterEach(() => {
    // 1. Restore settings
    db.prepare("DELETE FROM settings WHERE key IN ('calendar_subscription.enabled', 'calendar_sync_secret', 'booking_upcoming_advance_minutes', 'smtp.enabled', 'email.events.calendar_subscription.enabled', 'smtp.host', 'smtp.user', 'smtp.pass', 'smtp.from_email')").run();
    for (const [key, value] of Object.entries(originalSettings)) {
       db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, value);
    }
    // 2. Cleanup data
    db.prepare("DELETE FROM reservations WHERE booking_code LIKE 'CAL-%'").run();
    db.prepare("DELETE FROM equipment WHERE name LIKE 'CAL_%'").run();
    db.prepare("DELETE FROM notifications WHERE event = 'calendar_subscription'").run();
  });

  describe('P1 Error Branches & Configurations', () => {
    it('GET /api/calendar/equipment/:id/url - should return 401 if not logged in', async () => {
       const res = await request(app).get(`/api/calendar/equipment/${equipmentId}/url`);
       expect(res.status).toBe(401);
    });

    it('GET /api/calendar/equipment/:id/url - should return 401/403 for non-admin user', async () => {
       const res = await request(app).get(`/api/calendar/equipment/${equipmentId}/url`)
        .set('Authorization', `Bearer ${userToken}`);
       expect([401, 403]).toContain(res.status);
    });

    it('should return 403 when calendar_subscription.enabled is false', async () => {
       db.prepare("UPDATE settings SET value = 'false' WHERE key = 'calendar_subscription.enabled'").run();
       const res1 = await request(app).get(`/api/calendar/user/url?booking_code=${bookingCodeApproved}`);
       expect(res1.status).toBe(403);
       const res2 = await request(app).post('/api/calendar/user/mail').send({ booking_code: bookingCodeApproved });
       expect(res2.status).toBe(403);
    });

    it('should return 400 when smtp is disabled for mail sending', async () => {
       db.prepare("UPDATE settings SET value = 'false' WHERE key = 'smtp.enabled'").run();
       const res = await request(app).post('/api/calendar/user/mail').send({ booking_code: bookingCodeApproved });
       expect(res.status).toBe(400);
       expect(res.body.error).toContain('SMTP');
    });

    it('should return 500 when calendar_sync_secret is missing', async () => {
       db.prepare("DELETE FROM settings WHERE key = 'calendar_sync_secret'").run();
       const res1 = await request(app).get(`/api/calendar/user/url?booking_code=${bookingCodeApproved}`);
       expect(res1.status).toBe(500);

       const res2 = await request(app).get(`/api/calendar/user/DUMMYTOKEN.ics`);
       expect(res2.status).toBe(500);
    });
  });

  describe('User Calendar Subscription Core', () => {
    it('GET /api/calendar/user/url - should return webcal url and wrap correct studentId', async () => {
      const res = await request(app).get(`/api/calendar/user/url?booking_code=${bookingCodeApproved}`);
      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/^webcal:\/\/.+\/api\/calendar\/user\/.+\.ics$/);

      // Extract token and verify decrypt
      const token = res.body.url.split('/').pop().replace('.ics', '');
      const decryptedId = decryptID(token, calendarSecret);
      expect(decryptedId).toBe(studentId);
    });

    it('POST /api/calendar/user/mail - should actually enqueue notification', async () => {
      const res = await request(app)
        .post('/api/calendar/user/mail')
        .send({ booking_code: bookingCodeApproved });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify queue insertion instead of false positive 200
      const notif = db.prepare("SELECT * FROM notifications WHERE event = 'calendar_subscription' AND target = ?").get('caluser@example.com') as any;
      expect(notif).toBeDefined();
      expect(notif.payload).toContain('webcal://');
    });
    
    it('GET /api/calendar/user/url - should return error if booking_code is missing or invalid', async () => {
      const res = await request(app).get('/api/calendar/user/url');
      expect(res.status).toBe(400);
      
      const res2 = await request(app).get('/api/calendar/user/url?booking_code=CAL-INVALID');
      expect(res2.status).toBe(404);
    });
  });

  describe('ICS Semantic & Boundary Assertions', () => {
    it('GET /api/calendar/user/:token.ics - should contain only valid statuses and correct VALARMs', async () => {
      const token = encryptID(studentId, calendarSecret);
      const res = await request(app).get(`/api/calendar/user/${token}.ics`);
      expect(res.status).toBe(200);

      const ics = res.text;

      // 1. Should contain approved and cancelled
      expect(ics).toContain(bookingCodeApproved);
      expect(ics).toContain('STATUS:CONFIRMED');
      expect(ics).toContain(bookingCodeCancelled);
      expect(ics).toContain('STATUS:CANCELLED');

      // 2. Should NOT contain pending or rejected
      expect(ics).not.toContain(bookingCodePending);
      expect(ics).not.toContain(bookingCodeRejected);

      // 3. Should NOT contain other user's reservations
      expect(ics).not.toContain(bookingCodeOther);

      // 4. VALARM assertions (Only 1 VALARM should exist, for the confirmed one)
      const valarmCount = (ics.match(/BEGIN:VALARM/g) || []).length;
      expect(valarmCount).toBe(1); // Cancelled event should NOT have VALARM
    });
    
    it('GET /api/calendar/equipment/:token.ics - should return valid ICS content for equipment', async () => {
      const token = encryptID(equipmentId, calendarSecret);
      const res = await request(app).get(`/api/calendar/equipment/${token}.ics`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain(bookingCodeApproved);
    });
  });
});
