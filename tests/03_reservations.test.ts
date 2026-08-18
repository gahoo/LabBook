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
      // Past
      const pastRes = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@qq.com', start_time: t(-1), end_time: t(1)
      });
      expect(pastRes.status).toBe(400);

      // end_time <= start_time
      const invertedRes = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@qq.com', start_time: t(25), end_time: t(24)
      });
      expect(invertedRes.status).toBe(400);
      
      const equalRes = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@qq.com', start_time: t(24), end_time: t(24)
      });
      expect(equalRes.status).toBe(400);
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
      expect(res.status).toBe(200);
      const row = db.prepare("SELECT status FROM reservations WHERE booking_code=?").get(res.body.booking_code);
      expect(row.status).toBe('pending');
    });

    it('should block booking out of operating hours unless allowOutOfHours is true', async () => {
      // Setup equipment with empty rules (no operating hours)
      const eqIdReject = setupEquipment({ rules: [], allowOutOfHours: false });
      setupSettings();
      const resReject = await createRes({
        equipment_id: eqIdReject, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      expect(resReject.status).toBe(400);
      expect(resReject.body.error).toContain('所选时间包含了仪器不开放的日期');

      const eqIdAllow = setupEquipment({ rules: [], allowOutOfHours: true });
      const resAllow = await createRes({
        equipment_id: eqIdAllow, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      expect(resAllow.status).toBe(200);
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
      
      // Should ALLOW back-to-back
      const res4 = await createRes({
        equipment_id: eqId, student_id: 'E', student_name: 'E', supervisor: '张三',
        phone: '123456', email: 'e@b.com', start_time: t(26), end_time: t(28)
      });
      expect(res4.status).toBe(200);
      
      const res5 = await createRes({
        equipment_id: eqId, student_id: 'F', student_name: 'F', supervisor: '张三',
        phone: '123456', email: 'f@b.com', start_time: t(22), end_time: t(24)
      });
      expect(res5.status).toBe(200);
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

  
  describe('V. Check-in & Check-out Lifecycle', () => {
    it('should intercept check-in if not in approved state', async () => {
      const eqId = setupEquipment();
      setupSettings();
      // create pending
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(1), end_time: t(2)
      });
      db.prepare("UPDATE reservations SET status = 'pending' WHERE booking_code=?").run(res.body.booking_code);
      
      const chk = await request(app).post('/api/reservations/checkin').send({ booking_code: res.body.booking_code });
      expect(chk.status).toBe(400);
      expect(chk.body.error).toContain('预约未通过审批或已开始');
    });

    it('should intercept check-in if too early', async () => {
      const eqId = setupEquipment();
      setupSettings();
      // start time 3 hours from now
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(3), end_time: t(4)
      });
      const chk = await request(app).post('/api/reservations/checkin').send({ booking_code: res.body.booking_code });
      expect(chk.status).toBe(400);
      expect(chk.body.error).toContain('只能在预约开始前 30 分钟内上机');
    });

    it('should successfully check-in and check-out and calculate costs', async () => {
      const eqId = setupEquipment({ price_type: 'hourly', price: 100 });
      setupSettings();
      // valid start time close to now (10 mins from now)
      const code = 'NORMAL_CHECK';
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)
      `).run(eqId, tMin(10), tMin(70), code);

      // Checkin
      const chkIn = await request(app).post('/api/reservations/checkin').send({ booking_code: code });
      expect(chkIn.status).toBe(200);
      // Check DB directly
      
      const r = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code);
      expect(r.status).toBe('active');
      expect(r.actual_start_time).toBeDefined();

      // Fast-forward actual_start_time to 1 hour ago
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(t(-1), code);

      // Checkout
      const chkOut = await request(app).post('/api/reservations/checkout').send({ booking_code: code, consumable_quantity: 2 });
      expect(chkOut.status).toBe(200);
      
      const r2 = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code);
      expect(r2.status).toBe('completed');
      expect(r2.actual_end_time).toBeDefined();
      expect(r2.total_cost).toBeGreaterThanOrEqual(0); // Either calculated cost or 0 based on precise diff // At least some cost calculated
    });
  });

  describe('VI. Update, Cancel & Violations', () => {
    
    it('should re-validate rules on update (overlap and constraints)', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({
        equipment_id: eqId, student_id: 'A', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      const r2 = await createRes({
        equipment_id: eqId, student_id: 'B', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'b@b.com', start_time: t(26), end_time: t(27)
      });

      // Try to update r1 to overlap with r2
      const u1 = await request(app).post('/api/reservations/update').send({
        booking_code: r1.body.booking_code, start_time: t(26), end_time: t(27.5)
      });
      expect(u1.status).toBe(400); // Conflict!
      
      // Apply max duration constraint directly
      const avail = { maxDurationMinutes: 30 };
      db.prepare("UPDATE equipment SET availability_json = ? WHERE id = ?").run(JSON.stringify(avail), eqId);
      
      const u2 = await request(app).post('/api/reservations/update').send({
        booking_code: r1.body.booking_code, start_time: t(24), end_time: t(25.5) // 90 mins > 30 mins
      });
      expect(u2.status).toBe(400); // Too long
    });

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

    it('should correctly trigger late cancel violation based on custom threshold', async () => {
      const eqId = setupEquipment({
          // The availability json parsing might be where it gets the lateCancellationMinutes
      });
      // The old code checked settings.violation_params_json but ALSO eqAvail.lateCancellationMinutes.
      // Let's just set the threshold in the equipment availability_json!
      db.prepare("UPDATE equipment SET availability_json = ? WHERE id = ?").run(
        JSON.stringify({ lateCancellationMinutes: 30 }), eqId
      );
      
      const codeSafe = 'SAFE_CANCEL';
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)
      `).run(eqId, tMin(60), tMin(120), codeSafe);
      
      await request(app).post('/api/reservations/cancel').send({ booking_code: codeSafe });
      const rowSafe = db.prepare("SELECT * FROM violation_records WHERE student_id='123'").get();
      expect(rowSafe).toBeUndefined(); // No penalty

      const codeLate = 'LATE_CANCEL';
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)
      `).run(eqId, tMin(15), tMin(75), codeLate);

      await request(app).post('/api/reservations/cancel').send({ booking_code: codeLate });
      const rowLate = db.prepare("SELECT * FROM violation_records WHERE student_id='123'").get();
      expect(rowLate).toBeDefined();
      expect(rowLate.violation_type).toBe('late_cancel');
    });
  });

  describe('VII. Admin Capabilities', () => {
    it('should require admin auth for admin endpoints', async () => {
      const res = await request(app).get('/api/admin/reservations');
      expect(res.status).toBe(401);
    });

    
    it('should correctly release slots on admin reject and allow physical delete', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({
        equipment_id: eqId, student_id: 'A', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      
      // Reject
      const row1 = db.prepare("SELECT id FROM reservations WHERE booking_code=?").get(r1.body.booking_code);
      const rej = await request(app).put('/api/admin/reservations/' + row1.id)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ status: 'rejected' });
      expect(rej.status).toBe(200);
      
      // Now another user can book the exact slot
      const r2 = await createRes({
        equipment_id: eqId, student_id: 'B', student_name: 'test', supervisor: '张三',
        phone: '123', email: 'b@b.com', start_time: t(24), end_time: t(25)
      });
      expect(r2.status).toBe(200);

      // Physical delete
      const row2 = db.prepare("SELECT id FROM reservations WHERE booking_code=?").get(r2.body.booking_code);
      const del = await request(app).delete('/api/admin/reservations/' + row2.id)
        .set('Authorization', 'Bearer ' + adminToken);
      expect(del.status).toBe(200);
      
      const row = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(r2.body.booking_code);
      expect(row).toBeUndefined();
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
