import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import { addHours, subHours, subMinutes, addMinutes, format } from 'date-fns';

const toIso = (d) => d.toISOString().split('.')[0] + 'Z';
const now = new Date();
const t = (h) => toIso(addHours(now, h));
const tMin = (m) => toIso(addMinutes(now, m));

describe('Reservation Lifecycle and Rules (03_reservations.test.ts)', () => {
  let adminToken;

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
      rules: Array.from({length: 7}, (_, i) => ({ day: i, start: '00:00', end: '23:59' })),
      advanceDays: 7,
      maxDurationMinutes: 120,
      minDurationMinutes: 30,
      dailyMaxDurationMinutes: 240,
      allowOutOfHours: false,
      ...availParams
    };
    const info = db.prepare(`
      INSERT INTO equipment (name, availability_json, auto_approve, release_noshow_slots, is_hidden, whitelist_enabled, price_type, price, consumable_fee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides.name || 'Test Eq',
      JSON.stringify(defaultAvail),
      overrides.auto_approve !== false ? 1 : 0,
      overrides.release_noshow_slots ? 1 : 0,
      overrides.is_hidden ? 1 : 0,
      overrides.whitelist_enabled ? 1 : 0,
      overrides.price_type || 'hour',
      overrides.price || 0,
      overrides.consumable_fee || 0
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

  const createRes = async (data) => request(app).post('/api/reservations').send(data);

  describe('I. Basic Parameters & Boundaries', () => {
    it('should block missing required fields or invalid format', async () => {
      const res = await createRes({});
      expect(res.status).toBe(400);
    });

    it('should block booking if equipment is hidden', async () => {
      const eqId = setupEquipment({}, { is_hidden: true });
      setupSettings();
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('该仪器暂不开放预约');
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
    it('should strictly respect auto_approve setting override', async () => {
      setupSettings();
      const eqIdAuto = setupEquipment({}, { auto_approve: true });
      const resAuto = await createRes({
        equipment_id: eqIdAuto, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      expect(db.prepare("SELECT status FROM reservations WHERE booking_code=?").get(resAuto.body.booking_code).status).toBe('approved');

      const eqIdManual = setupEquipment({}, { auto_approve: false });
      const resManual = await createRes({
        equipment_id: eqIdManual, student_id: '124', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25)
      });
      expect(db.prepare("SELECT status FROM reservations WHERE booking_code=?").get(resManual.body.booking_code).status).toBe('pending');
    });

    it('should block duration < minDurationMinutes', async () => {
      const eqId = setupEquipment({ minDurationMinutes: 60 });
      setupSettings();
      const res = await createRes({
        equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三',
        phone: '123456', email: 'a@b.com', start_time: t(24), end_time: tMin(24 * 60 + 30)
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('预约时长不能少于');
    });

    it('should block daily accumulated duration exceeding limit', async () => {
      const eqId = setupEquipment({ dailyMaxDurationMinutes: 120 });
      setupSettings();
      await createRes({ equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      const res2 = await createRes({ equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123456', email: 'a@b.com', start_time: t(26), end_time: t(28) });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('超过单日预约总时长硬性上限');
    });

    it('should force pending status for auto_approve equipment if user has REQUIRE_APPROVAL penalty', async () => {
      const eqId = setupEquipment({}, { auto_approve: true });
      setupSettings();
      db.prepare("INSERT INTO penalty_rules (id, name, violation_type, trigger_config, action_config, is_active) VALUES (1, 'T1', 'any', '{}', '{}', 1)").run();
      db.prepare("INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time) VALUES ('123', 1, 'REQUIRE_APPROVAL', '{}', datetime('now', '-1 day'), datetime('now', '+10 days'))").run();
      const res = await createRes({ equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      expect(res.status).toBe(200);
      expect(db.prepare("SELECT status FROM reservations WHERE booking_code=?").get(res.body.booking_code).status).toBe('pending');
    });

    it('should block booking out of operating hours unless allowOutOfHours is true', async () => {
      const eqIdReject = setupEquipment({ rules: [], allowOutOfHours: false });
      setupSettings();
      const resReject = await createRes({ equipment_id: eqIdReject, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      expect(resReject.status).toBe(400);

      const eqIdAllow = setupEquipment({ rules: [], allowOutOfHours: true });
      const resAllow = await createRes({ equipment_id: eqIdAllow, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123456', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      expect(resAllow.status).toBe(200);
    });
  });

  describe('III. Concurrency & Conflict Detection', () => {
    it('should handle real concurrent requests safely (Promise.all)', async () => {
      const eqId = setupEquipment();
      setupSettings();

      // Fire 3 simultaneous requests for the exact same slot
      const reqs = await Promise.all([
        createRes({ equipment_id: eqId, student_id: 'A', student_name: 'A', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(26) }),
        createRes({ equipment_id: eqId, student_id: 'B', student_name: 'B', supervisor: '张三', phone: '123', email: 'b@b.com', start_time: t(24), end_time: t(26) }),
        createRes({ equipment_id: eqId, student_id: 'C', student_name: 'C', supervisor: '张三', phone: '123', email: 'c@b.com', start_time: t(24), end_time: t(26) })
      ]);

      const successes = reqs.filter(r => r.status === 200);
      const conflicts = reqs.filter(r => r.status === 400);

      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(2);

      const count = db.prepare("SELECT COUNT(*) as c FROM reservations").get();
      expect(count.c).toBe(1);
    });

    it('should block 3 types of overlap: full, partial edge, wrap-around, but allow back-to-back', async () => {
      const eqId = setupEquipment();
      setupSettings();
      await createRes({ equipment_id: eqId, student_id: 'A', student_name: 'A', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(26) });

      const r1 = await createRes({ equipment_id: eqId, student_id: 'B', student_name: 'B', supervisor: '张三', phone: '123', email: 'b@b.com', start_time: t(23), end_time: t(25) });
      expect(r1.status).toBe(400);

      const r2 = await createRes({ equipment_id: eqId, student_id: 'C', student_name: 'C', supervisor: '张三', phone: '123', email: 'c@b.com', start_time: t(25), end_time: t(27) });
      expect(r2.status).toBe(400);

      const r3 = await createRes({ equipment_id: eqId, student_id: 'D', student_name: 'D', supervisor: '张三', phone: '123', email: 'd@b.com', start_time: t(23), end_time: t(27) });
      expect(r3.status).toBe(400);

      // back-to-back
      const r4 = await createRes({ equipment_id: eqId, student_id: 'E', student_name: 'E', supervisor: '张三', phone: '123', email: 'e@b.com', start_time: t(26), end_time: t(28) });
      expect(r4.status).toBe(200);
      const r5 = await createRes({ equipment_id: eqId, student_id: 'F', student_name: 'F', supervisor: '张三', phone: '123', email: 'f@b.com', start_time: t(22), end_time: t(24) });
      expect(r5.status).toBe(200);
    });
    it('should allow preempting noshow slots if release_noshow_slots is true', async () => {
      const eqId = setupEquipment({}, { release_noshow_slots: true });
      setupSettings();
      
      // 40 mins ago -> 20 mins from now. The noshow boundary is 30 mins.
      // So since it started 40 mins ago and has no actual_start_time, it is considered a forfeited no-show slot by the conflict checker.
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', 'CODE123')
      `).run(eqId, tMin(-40), tMin(20));

      const res = await createRes({
        equipment_id: eqId, student_id: 'B', student_name: 'B', supervisor: '张三',
        phone: '123', email: 'b@b.com', start_time: tMin(5), end_time: tMin(35)
      });
      expect(res.status).toBe(200);
    });
  });

  describe('IV. Query & Batch', () => {
    it('should query single reservation by code and return robust data', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const create = await createRes({ equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      
      const res = await request(app).get('/api/reservations/' + create.body.booking_code);
      expect(res.status).toBe(200);
      expect(res.body.equipment_id).toBe(eqId);
      expect(res.body.status).toBeDefined();

      const notFound = await request(app).get('/api/reservations/INVALID_CODE');
      expect(notFound.status).toBe(404);
    });

    it('should query batch by codes and ignore invalid codes', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({ equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      
      const res = await request(app).post('/api/reservations/batch').send({ codes: [r1.body.booking_code, 'NONEXISTENT'] });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1); // Only valid codes returned
    });
  });

  describe('V. Check-in & Check-out Lifecycle', () => {
    it('should successfully check in a reservation and set actual_start_time', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const code = 'HAPPY_CHECKIN';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)`).run(eqId, tMin(-10), tMin(50), code);
      
      const chk = await request(app).post('/api/reservations/checkin').send({ booking_code: code });
      expect(chk.status).toBe(200);

      const r = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code) as any;
      expect(r.status).toBe('active');
      expect(r.actual_start_time).toBeDefined();
      expect(r.actual_start_time).not.toBeNull();
    });

    it('should handle invalid checkin attempts (unknown code, double checkin)', async () => {
      const eqId = setupEquipment();
      setupSettings();
      
      const errRes = await request(app).post('/api/reservations/checkin').send({ booking_code: 'FAKE' });
      expect(errRes.status).toBe(404);

      const code = 'DBL_CHECKIN';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-10), tMin(50), code);
      
      const chk = await request(app).post('/api/reservations/checkin').send({ booking_code: code });
      expect(chk.status).toBe(400); // already active
    });

    it('should precisely calculate exact cost based on actual duration and price_type hour', async () => {
      const eqId = setupEquipment({}, { price_type: 'hour', price: 120, consumable_fee: 10 });
      setupSettings();
      const code = 'COST_CHECK';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-60), tMin(60), code);
      
      // Force actual_start_time to exactly 2.5 hours ago
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-150), code);

      const chkOut = await request(app).post('/api/reservations/checkout').send({ booking_code: code, consumable_quantity: 2 });
      expect(chkOut.status).toBe(200);

      const r = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code);
      expect(r.status).toBe('completed');
      
      // 2.5 hours -> ceil(2.5) = 3 hours. 3 * 120 = 360
      // 2 consumables * 10 = 20
      // Total = 380
      expect(r.total_cost).toBe(380);
    });

    it('should accurately calculate session-based and fixed fees', async () => {
      const eqId = setupEquipment({}, { price_type: 'session', price: 50, consumable_fee: 5 });
      setupSettings();
      const code = 'SESS_CHECK';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-60), tMin(60), code);
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-150), code);

      await request(app).post('/api/reservations/checkout').send({ booking_code: code, consumable_quantity: 3 });
      const r = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code);
      // Session price 50, even if 2.5 hours. Consumables 3 * 5 = 15. Total = 65.
      expect(r.total_cost).toBe(65);
    });
  });

  describe('VI. Update, Cancel & Violations', () => {
    it('should cancel successfully and update database state', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r = await createRes({ equipment_id: eqId, student_id: 'A', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      
      const can = await request(app).post('/api/reservations/cancel').send({ booking_code: r.body.booking_code });
      expect(can.status).toBe(200);

      const row = db.prepare("SELECT status FROM reservations WHERE booking_code=?").get(r.body.booking_code);
      expect(row.status).toBe('cancelled');

      // double cancel should fail safely or gracefully
      const can2 = await request(app).post('/api/reservations/cancel').send({ booking_code: r.body.booking_code });
      expect(can2.status).toBe(400); 
    });

    it('should block cancelling active or completed reservations', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const codeActive = 'NO_CANCEL_ACTIVE';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, t(1), t(2), codeActive);
      
      const canActive = await request(app).post('/api/reservations/cancel').send({ booking_code: codeActive });
      expect(canActive.status).toBe(400);
      expect(canActive.body.error).toContain('进行中');

      const codeCompleted = 'NO_CANCEL_COMPLETED';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'completed', ?)`).run(eqId, t(1), t(2), codeCompleted);
      
      const canCompleted = await request(app).post('/api/reservations/cancel').send({ booking_code: codeCompleted });
      expect(canCompleted.status).toBe(400);
      expect(canCompleted.body.error).toMatch(/无法取消进行中或已完成的预约/);
    });

    it('should correctly trigger late cancel based on availability_json threshold', async () => {
      const eqId = setupEquipment({ lateCancellationMinutes: 30 });
      setupSettings();
      
      const codeSafe = 'SAFE_CANCEL';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)`).run(eqId, tMin(60), tMin(120), codeSafe);
      await request(app).post('/api/reservations/cancel').send({ booking_code: codeSafe });
      expect(db.prepare("SELECT * FROM violation_records WHERE student_id='123'").get()).toBeUndefined(); 

      const codeLate = 'LATE_CANCEL';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '124', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', ?)`).run(eqId, tMin(15), tMin(75), codeLate);
      await request(app).post('/api/reservations/cancel').send({ booking_code: codeLate });
      
      const rowLate = db.prepare("SELECT * FROM violation_records WHERE student_id='124'").get();
      expect(rowLate).toBeDefined();
      expect(rowLate.violation_type).toBe('late_cancel');
    });

    it('should update successfully and increment modified_count', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r = await createRes({ equipment_id: eqId, student_id: 'A', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      const code = r.body.booking_code;

      const u = await request(app).post('/api/reservations/update').send({ booking_code: code, start_time: t(24), end_time: t(25.5) });
      expect(u.status).toBe(200);

      const row = db.prepare("SELECT modified_count, end_time FROM reservations WHERE booking_code=?").get(code);
      expect(row.modified_count).toBe(1);
      expect(row.end_time).toBe(t(25.5)); // Verified DB change
      
      // Secondary update should fail
      const u2 = await request(app).post('/api/reservations/update').send({ booking_code: code, start_time: t(24), end_time: t(26) });
      expect(u2.status).toBe(400);
    });
    it('should handle update failure branches (conflict, over duration, past time, invalid status, transaction rollback)', async () => {
      const eqId = setupEquipment({}, { maxDurationMinutes: 120 });
      setupSettings();
      // Setup initial reservation
      const r1 = await createRes({ equipment_id: eqId, student_id: 'A', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      const code1 = r1.body.booking_code;

      // Setup another reservation to cause conflict
      const r2 = await createRes({ equipment_id: eqId, student_id: 'B', student_name: 'test', supervisor: '李四', phone: '123', email: 'a@b.com', start_time: t(26), end_time: t(27) });

      // 1. Conflict
      const uConf = await request(app).post('/api/reservations/update').send({ booking_code: code1, start_time: t(26), end_time: t(27) });
      expect(uConf.status).toBe(400);
      expect(uConf.body.error).toContain('其他预约');

      // 2. Over duration limit
      const uDur = await request(app).post('/api/reservations/update').send({ booking_code: code1, start_time: t(24), end_time: t(27) }); // 3 hours > 120 mins
      expect(uDur.status).toBe(400);

      // 3. Past time
      const uPast = await request(app).post('/api/reservations/update').send({ booking_code: code1, start_time: t(-1), end_time: t(1) });
      expect(uPast.status).toBe(400);

      // 4. Invalid status (e.g. active)
      const codeActive = 'UPDATE_ACTIVE';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, t(10), t(11), codeActive);
      const uActive = await request(app).post('/api/reservations/update').send({ booking_code: codeActive, start_time: t(10), end_time: t(11.5) });
      expect(uActive.status).toBe(400);
      expect(uActive.body.error).toMatch(/无法修改进行中或已完成的预约/);

      // Verify transaction rollback (modified_count remains 0)
      const row1 = db.prepare("SELECT modified_count FROM reservations WHERE booking_code=?").get(code1) as any;
      expect(row1.modified_count).toBe(0);
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
      const r1 = await createRes({ equipment_id: eqId, student_id: 'A', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      
      const row1 = db.prepare("SELECT id FROM reservations WHERE booking_code=?").get(r1.body.booking_code) as any;
      const rej = await request(app).put('/api/admin/reservations/' + row1.id).set('Authorization', 'Bearer ' + adminToken).send({ status: 'rejected' });
      expect(rej.status).toBe(200);
      
      const r2 = await createRes({ equipment_id: eqId, student_id: 'B', student_name: 'test', supervisor: '张三', phone: '123', email: 'b@b.com', start_time: t(24), end_time: t(25) });
      expect(r2.status).toBe(200);

      const row2 = db.prepare("SELECT id FROM reservations WHERE booking_code=?").get(r2.body.booking_code) as any;
      const del = await request(app).delete('/api/admin/reservations/' + row2.id).set('Authorization', 'Bearer ' + adminToken);
      expect(del.status).toBe(200);
      expect(db.prepare("SELECT * FROM reservations WHERE id=?").get(row2.id)).toBeUndefined();
    });

    it('should filter admin reservations and handle empty stats boundaries', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const res1 = await createRes({ equipment_id: eqId, student_id: 'S1', student_name: 'Alice', supervisor: 'Dr. Smith', phone: '123', email: 'a@b.com', start_time: t(48), end_time: t(49) });
      expect(res1.status).toBe(200);
      const res2 = await createRes({ equipment_id: eqId, student_id: 'S2', student_name: 'Bob', supervisor: 'Dr. Jones', phone: '123', email: 'a@b.com', start_time: t(50), end_time: t(51) });
      expect(res2.status).toBe(200);

      // 1. List Filtering
      const listAlice = await request(app).get('/api/admin/reservations?student_name=Alice').set('Authorization', 'Bearer ' + adminToken);
      expect(listAlice.status).toBe(200);
      expect(listAlice.body.length).toBeGreaterThanOrEqual(1);
      expect(listAlice.body.some((r: any) => r.student_name === 'Alice')).toBe(true);

      const listSmith = await request(app).get('/api/admin/reservations?supervisor=Smith').set('Authorization', 'Bearer ' + adminToken);
      expect(listSmith.body.some((r: any) => r.supervisor === 'Dr. Smith')).toBe(true);
      expect(listSmith.body.some((r: any) => r.supervisor === 'Dr. Jones')).toBe(false);

      // 2. Stats Empty Boundaries
      const emptyStats = await request(app).get(`/api/admin/reservations/stats?student_name=Nobody&startDate=${t(-100)}&endDate=${t(100)}`).set('Authorization', 'Bearer ' + adminToken);
      expect(emptyStats.status).toBe(200);
      expect(emptyStats.body.usageByPerson.length).toBe(0);
      expect(emptyStats.body.usageBySupervisor.length).toBe(0);
      expect(emptyStats.body.usageByTime.length).toBe(0);
      expect(emptyStats.body.usageByEquipment.length).toBe(0);
    });

    it('should fallback gracefully for 404 unknown code and invalid params', async () => {
      setupSettings();
      
      // Update invalid code
      const updateRes = await request(app).post('/api/reservations/update').send({ booking_code: 'NON_EXISTENT_CODE', start_time: t(10), end_time: t(11) });
      expect(updateRes.status).toBe(404);

      // Cancel invalid code
      const cancelRes = await request(app).post('/api/reservations/cancel').send({ booking_code: 'NON_EXISTENT_CODE' });
      expect(cancelRes.status).toBe(404);

      // Checkout invalid code
      const checkoutRes = await request(app).post('/api/reservations/checkout').send({ booking_code: 'NON_EXISTENT_CODE' });
      expect(checkoutRes.status).toBe(404);
      
      // Admin update unknown ID
      const adminUpdateRes = await request(app).put('/api/admin/reservations/999999').set('Authorization', 'Bearer ' + adminToken).send({ status: 'approved' });
      expect(adminUpdateRes.status).toBe(404);

      // Update with invalid params types
      const badParamsRes = await request(app).post('/api/reservations/update').send({ booking_code: 123, start_time: 100, end_time: [] });
      expect(badParamsRes.status).toBe(400);
    });
  });
});
