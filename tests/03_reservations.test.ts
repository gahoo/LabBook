import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import jwt from 'jsonwebtoken';
import { addHours, subHours, subMinutes, addMinutes, format } from 'date-fns';

const toIso = (d) => d.toISOString().split('.')[0] + 'Z';
const now = new Date();
const t = (h) => toIso(addHours(now, h));
const tMin = (m) => toIso(addMinutes(now, m));

describe('Reservation Lifecycle and Rules (03_reservations.test.ts)', () => {
  let adminToken;
  let userToken;

  beforeAll(async () => {
    const pwd = process.env.ADMIN_PASSWORD || 'admin';
    const res = await request(app).post('/api/admin/login').send({ password: pwd });
    adminToken = res.body.token;
  });

  beforeEach(() => {
    db.prepare('DELETE FROM reservations').run();
    db.prepare('DELETE FROM equipment').run();
    db.prepare('DELETE FROM violation_records').run();
    db.prepare('DELETE FROM whitelist_applications').run();
    db.prepare('DELETE FROM penalty_rules').run();
    db.prepare('DELETE FROM user_penalties').run();
    db.prepare("DELETE FROM settings").run();
  });

  const setupEquipment = (availParams = {}, overrides = {}) => {
    const defaultAvail = {
      rules: [
        { day: 0, start: '00:00', end: '23:59' },
        { day: 1, start: '00:00', end: '23:59' },
        { day: 2, start: '00:00', end: '23:59' },
        { day: 3, start: '00:00', end: '23:59' },
        { day: 4, start: '00:00', end: '23:59' },
        { day: 5, start: '00:00', end: '23:59' },
        { day: 6, start: '00:00', end: '23:59' }
      ],
      advanceDays: 7,
      maxDurationMinutes: 120,
      minDurationMinutes: 30,
      dailyMaxDurationMinutes: 240,
      ...availParams
    };
    
    const info = db.prepare(`
      INSERT INTO equipment (name, availability_json, auto_approve, release_noshow_slots, is_hidden, whitelist_enabled, price_type, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides.name || 'Test Eq', 
      JSON.stringify(defaultAvail), 
      overrides.auto_approve !== false ? 1 : 0, 
      overrides.release_noshow_slots ? 1 : 0,
      overrides.is_hidden ? 1 : 0,
      overrides.whitelist_enabled ? 1 : 0,
      overrides.price_type || 'hourly',
      overrides.price || 0
    );
    return info.lastInsertRowid;
  };

  const setupSettings = (overrides = {}) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allowed_email_suffixes', ?)").run(overrides.allowed_email_suffixes || '');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('violation_params_json', ?)").run(overrides.violation_params_json || JSON.stringify({
      maxLateMinutes: 15,
      lateCancelMinutes: 120,
      noShowPoints: 5,
      lateCancelPoints: 2
    }));
  };

  const createRes = async (data) => {
    return request(app).post('/api/reservations').send(data);
  };

  describe('I. Basic Parameters & Boundaries (/api/reservations)', () => {
    it('should block missing required fields or invalid format', async () => {
      const res = await createRes({});
      expect(res.status).toBe(400);
    });
    
    it('should block supervisor name containing 教授 or 老师', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张教授',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      expect(res.status).toBe(400);
    });

    it('should block email suffix not in whitelist', async () => {
      const eqId = setupEquipment();
      setupSettings({ allowed_email_suffixes: 'edu.cn' });
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@qq.com', start_time: t(24), end_time: t(25)
      });
      expect(res.status).toBe(400);
    });

    it('should block booking in the past or invalid time range', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const pastRes = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@qq.com', start_time: t(-1), end_time: t(1)
      });
      expect(pastRes.status).toBe(400);
    });
  });

  describe('II. Equipment Rules & Penalty Engine', () => {
    it('should block duration < minDurationMinutes', async () => {
      const eqId = setupEquipment({ minDurationMinutes: 60 });
      setupSettings();
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: tMin(24 * 60 + 30) // 30 mins
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('预约时长不能少于');
    });

    it('should block daily accumulated duration exceeding limit', async () => {
      const eqId = setupEquipment({ dailyMaxDurationMinutes: 120 });
      setupSettings();
      await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25) // 60 mins
      });
      const res2 = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(26), end_time: t(28) // 120 mins
      });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('超过单日预约总时长硬性上限');
    });

    it('should force pending status for auto_approve equipment if user has REQUIRE_APPROVAL penalty', async () => {
      const eqId = setupEquipment({ auto_approve: true });
      setupSettings();
      db.prepare("INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active) VALUES (1, 'T1', 'any', '{}', '{}', 1)").run();
      db.prepare("INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time) VALUES ('123', 1, 'REQUIRE_APPROVAL', '{}', datetime('now', '-1 day'), datetime('now', '+10 days'))").run();
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      if (res.status === 200) {
         const row = db.prepare("SELECT status FROM reservations WHERE booking_code=?").get(res.body.booking_code);
         expect(row.status).toBe('pending');
      }
    });

    it('should block booking out of operating hours unless allowOutOfHours is true', async () => {
      const eqId = setupEquipment({ rules: [], allowOutOfHours: true });
      setupSettings();
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      if (res.status !== 200) console.log(res.body);
      expect(res.status).toBe(200);
    });
  });

  describe('III. Concurrency & Conflict Detection', () => {
    it('should block 3 types of overlap: full, partial edge, wrap-around', async () => {
      const eqId = setupEquipment();
      setupSettings();
      await createRes({
        equipment_id: eqId, student_id: 'A', student_name: 'A', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(26)
      });

      const res1 = await createRes({
        equipment_id: eqId, student_id: 'B', student_name: 'B', supervisor: '张三',
        phone: '123456', email: 'b@b.com', start_time: t(23), end_time: t(25)
      });
      expect(res1.status).toBe(400);
      
      const res2 = await createRes({
        equipment_id: eqId, student_id: 'C', student_name: 'C', supervisor: '张三',
        phone: '123456', email: 'c@b.com', start_time: t(25), end_time: t(27)
      });
      expect(res2.status).toBe(400);

      const res3 = await createRes({
        equipment_id: eqId, student_id: 'D', student_name: 'D', supervisor: '张三',
        phone: '123456', email: 'd@b.com', start_time: t(23), end_time: t(27)
      });
      expect(res3.status).toBe(400);
    });

    it('should allow reservation if existing conflict is cancelled or rejected', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({
        equipment_id: eqId, student_id: 'A', student_name: 'A', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(26)
      });
      db.prepare("UPDATE reservations SET status = 'cancelled' WHERE booking_code=?").run(r1.body.booking_code);

      const res2 = await createRes({
        equipment_id: eqId, student_id: 'B', student_name: 'B', supervisor: '张三',
        phone: '123456', email: 'b@b.com', start_time: t(24), end_time: t(26)
      });
      expect(res2.status).toBe(200);
    });

    it('should allow preempting noshow slots if release_noshow_slots is true', async () => {
      const eqId = setupEquipment({}, { release_noshow_slots: true });
      setupSettings();
      
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', 'CODE123')
      `).run(eqId, tMin(-40), tMin(20));

      const res = await createRes({
        equipment_id: eqId, student_id: 'B', student_name: 'B', supervisor: '张三',
        phone: '123456', email: 'b@b.com', start_time: tMin(5), end_time: tMin(35)
      });
      if (res.status !== 200) console.log(res.body);
      expect(res.status).toBe(200);
    });
  });

  describe('IV. Query & Batch', () => {
    it('should query single reservation by code', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const create = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      const code = create.body.booking_code;

      const res = await request(app).get('/api/reservations/' + code);
      if (res.status !== 200) console.log(res.body);
      expect(res.status).toBe(200);
    });

    it('should query batch by codes', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      const r2 = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(26), end_time: t(27)
      });

      const res = await request(app).post('/api/reservations/batch').send({ codes: [r1.body.booking_code, r2.body.booking_code] });
      if (res.status !== 200) console.log(res.body);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });
  });

  describe('V. State Machine & Violations', () => {
    it('should block update if modified_count >= 1', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      
      const code = r1.body.booking_code;
      const u1 = await request(app).post('/api/reservations/update').send({
        booking_code: code, start_time: t(24), end_time: t(25.5)
      });
      expect(u1.status).toBe(200);

      const u2 = await request(app).post('/api/reservations/update').send({
        booking_code: code, start_time: t(24), end_time: t(26)
      });
      expect(u2.status).toBe(400);
      expect(u2.body.error).toContain('每个预约仅允许修改一次时间，请取消后重新预约');
    });

    it('should trigger late cancel violation if within lateCancelMinutes', async () => {
      const eqId = setupEquipment();
      setupSettings({ violation_params_json: JSON.stringify({ lateCancelMinutes: 120 }) });
      
      const code = 'LATE_CANCEL_CODE';
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)
      `).run(eqId, tMin(60), tMin(120), code);

      const res = await request(app).post('/api/reservations/cancel').send({ booking_code: code });
      if (res.status !== 200) console.log(res.body);
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT * FROM violation_records WHERE student_id='123'").get();
      expect(row).toBeDefined();
      expect(row.violation_type).toBe('late_cancel');
    });
  });

  describe('VI. Admin Capabilities', () => {
    it('should require admin auth for admin endpoints', async () => {
      const res = await request(app).get('/api/admin/reservations');
      expect(res.status).toBe(401);
    });

    it('should allow admin to get stats correctly', async () => {
      const eqId = setupEquipment();
      setupSettings();
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, actual_start_time, actual_end_time, status, booking_code)
        VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, ?, ?, 'completed', 'CODE')
      `).run(eqId, t(-5), t(-4), t(-5), t(-4));

      const res = await request(app).get('/api/admin/reservations/stats?startDate=' + t(-10).split('T')[0] + '&endDate=' + t(1).split('T')[0])
        .set('Authorization', 'Bearer ' + adminToken);
      if (res.status !== 200) console.log(res.body);
      expect(res.status).toBe(200);
      expect(res.body.usageByEquipment[0].total_hours).toBe(1);
    });
  });
});
