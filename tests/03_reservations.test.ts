import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import { addHours, subHours, subMinutes, addMinutes, format } from 'date-fns';
import { resetTestDatabase } from './utils/db-helper.js';

const toIso = (d: Date) => d.toISOString().split('.')[0] + 'Z';
const fixedNow = new Date('2030-01-15T10:00:00.000Z');
const t = (h: number) => toIso(addHours(fixedNow, h));
const tMin = (m: number) => toIso(addMinutes(fixedNow, m));

describe('Reservation Lifecycle and Rules (03_reservations.test.ts)', () => {
  let adminToken: string;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const pwd = process.env.ADMIN_PASSWORD || 'admin';
    const res = await request(app).post('/api/admin/login').send({ password: pwd });
    adminToken = res.body.token;
  });

  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    vi.useRealTimers();
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

  const createRes = async (data: any) => request(app).post('/api/reservations').send(data);

  // P2: Front-loaded factory assertion
  const createReservationOrFail = async (equipmentId: number, overrides = {}) => {
    const randomId = 'STU_' + Math.random().toString(36).substring(2, 8);
    const res = await createRes({
      equipment_id: equipmentId,
      student_id: overrides.student_id || randomId,
      student_name: 'Test Student',
      supervisor: 'Test Supervisor',
      phone: '12345678901',
      email: 'test@example.com',
      ...overrides
    });
    if (res.status !== 200) {
      console.error('createReservationOrFail failed:', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.booking_code).toBeDefined();
    return res;
  };

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
      const info = db.prepare("INSERT INTO penalty_rules (name, violation_type, trigger_config, action_config, is_active) VALUES ('T1', 'any', '{}', '{}', 1)").run();
      db.prepare("INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time) VALUES ('123', ?, 'REQUIRE_APPROVAL', '{}', ?, ?)").run(info.lastInsertRowid, t(-24), t(24 * 10));
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
    it('should handle same-tick concurrent requests safely (Promise.all)', async () => {
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

    it('should properly validate overlap combinations including exact matches, subsets, different equipment, and ignored statuses', async () => {
      const eqId1 = setupEquipment();
      const eqId2 = setupEquipment({ name: 'Eq 2' });
      setupSettings();

      // Base reservation: [24, 26]
      await createReservationOrFail(eqId1, { start_time: t(24), end_time: t(26) });

      const overlapCases = [
        { name: 'exact match', start: 24, end: 26, expectStatus: 400 },
        { name: 'internal subset', start: 24.5, end: 25.5, expectStatus: 400 },
        { name: 'partial edge left', start: 23, end: 25, expectStatus: 400 },
        { name: 'partial edge right', start: 25, end: 27, expectStatus: 400 },
        { name: 'wrap around', start: 23, end: 27, expectStatus: 400 },
        { name: 'back to back left', start: 22, end: 24, expectStatus: 200 },
        { name: 'back to back right', start: 26, end: 28, expectStatus: 200 },
      ];

      for (const c of overlapCases) {
        const res = await createRes({
          equipment_id: eqId1, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com',
          start_time: t(c.start), end_time: t(c.end)
        });
        expect(res.status).toBe(c.expectStatus);
      }

      // Different equipment allows overlap
      const resDiffEq = await createReservationOrFail(eqId2, { start_time: t(24), end_time: t(26) });
      expect(resDiffEq.status).toBe(200);

      // Canceled or rejected reservations do not block
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'cancelled', 'CODE_CANCEL')`).run(eqId1, t(30), t(32));
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'rejected', 'CODE_REJECT')`).run(eqId1, t(32), t(34));

      const resCancelOverlap = await createReservationOrFail(eqId1, { start_time: t(30), end_time: t(32) });
      expect(resCancelOverlap.status).toBe(200);
      
      const resRejectOverlap = await createReservationOrFail(eqId1, { start_time: t(32), end_time: t(34) });
      expect(resRejectOverlap.status).toBe(200);
    });
    it('should strictly manage no-show preemption based on settings and actual_start_time', async () => {
      const eqId = setupEquipment({}, { release_noshow_slots: true });
      const eqIdNoRelease = setupEquipment({}, { release_noshow_slots: false });
      setupSettings();
      
      // Scenario 1: Preemption allowed (started 40 mins ago, no actual_start_time, release enabled)
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', 'CODE1')
      `).run(eqId, tMin(-40), tMin(20));
      const r1 = await createReservationOrFail(eqId, { start_time: tMin(0), end_time: tMin(60) });
      expect(r1.status).toBe(200);

      // Scenario 2: Preemption blocked if release_noshow_slots is false
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', 'CODE2')
      `).run(eqIdNoRelease, tMin(-40), tMin(20));
      const r2 = await createRes({
        equipment_id: eqIdNoRelease, student_id: 'TEST_STU2', student_name: 'Test Student', supervisor: 'Test Supervisor', phone: '12345678901', email: 'test@example.com',
        start_time: tMin(0), end_time: tMin(60)
      });
      expect(r2.status).toBe(400);

      // Scenario 3: Preemption blocked if within 30 min grace period (e.g., 20 mins ago)
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
        VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'approved', 'CODE3')
      `).run(eqId, tMin(-20), tMin(40));
      const r3 = await createRes({
        equipment_id: eqId, student_id: 'TEST_STU3', student_name: 'Test Student', supervisor: 'Test Supervisor', phone: '12345678901', email: 'test@example.com',
        start_time: tMin(0), end_time: tMin(60)
      });
      expect(r3.status).toBe(400);

      // Scenario 4: Preemption blocked if already has actual_start_time (even if >30 mins late)
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code, actual_start_time)
        VALUES (?, 'A', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', 'CODE4', ?)
      `).run(eqId, tMin(-40), tMin(20), tMin(-35));
      const r4 = await createRes({
        equipment_id: eqId, student_id: 'TEST_STU4', student_name: 'Test Student', supervisor: 'Test Supervisor', phone: '12345678901', email: 'test@example.com',
        start_time: tMin(0), end_time: tMin(60)
      });
      expect(r4.status).toBe(400);
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

    it('should query batch by codes and ignore invalid or duplicate codes', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const r1 = await createRes({ equipment_id: eqId, student_id: '123', student_name: 'test', supervisor: '张三', phone: '123', email: 'a@b.com', start_time: t(24), end_time: t(25) });
      const r2 = await createRes({ equipment_id: eqId, student_id: '456', student_name: 'test2', supervisor: '李四', phone: '123', email: 'c@d.com', start_time: t(26), end_time: t(27) });
      
      const res = await request(app).post('/api/reservations/batch').send({ codes: [r1.body.booking_code, 'NONEXISTENT', r2.body.booking_code, r1.body.booking_code] });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2); // Only valid codes returned, duplicates removed
      
      const codes = res.body.map((r: any) => r.booking_code);
      expect(codes).toContain(r1.body.booking_code);
      expect(codes).toContain(r2.body.booking_code);
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

    it('should precisely calculate exact cost based on actual duration and price_type hour (60m vs 61m boundary)', async () => {
      const eqId = setupEquipment({}, { price_type: 'hour', price: 100, consumable_fee: 10 });
      setupSettings();
      
      // Case 1: Exactly 60 minutes
      const c1 = 'COST_60M';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-60), tMin(60), c1);
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-60), c1);
      
      const chk1 = await request(app).post('/api/reservations/checkout').send({ booking_code: c1 });
      expect(chk1.status).toBe(200);
      const r1 = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(c1);
      expect(r1.total_cost).toBe(100); // 60 mins -> exactly 1 hour

      // Case 2: Exactly 61 minutes (should round up to 2 hours)
      const c2 = 'COST_61M';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-61), tMin(60), c2);
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-61), c2);
      
      const chk2 = await request(app).post('/api/reservations/checkout').send({ booking_code: c2 });
      expect(chk2.status).toBe(200);
      const r2 = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(c2);
      expect(r2.total_cost).toBe(200); // ceil(61/60) = 2 hours -> 200

      // Case 3: Invalid consumable quantities
      const c3 = 'COST_INV';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-30), tMin(60), c3);
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-30), c3);

      const rejNeg = await request(app).post('/api/reservations/checkout').send({ booking_code: c3, consumable_quantity: -1 });
      expect(rejNeg.status).toBe(400);

      const rejChar = await request(app).post('/api/reservations/checkout').send({ booking_code: c3, consumable_quantity: 'abc' });
      expect(rejChar.status).toBe(400);
    });

    it('should generate an overdue violation if checkout time exceeds grace period', async () => {
      const eqId = setupEquipment();
      setupSettings();
      db.prepare("UPDATE settings SET value = '15' WHERE key = 'violation_overtime_grace_minutes'").run();
      
      const cCode = 'OVERDUE_CHK';
      // Reservation ended 20 minutes ago. User is checking out now.
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, 'TEST1', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-120), tMin(-20), cCode);
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-120), cCode);
      
      const res = await request(app).post('/api/reservations/checkout').send({ booking_code: cCode });
      expect(res.status).toBe(200);

      // Verify violation record created
      const violation = db.prepare("SELECT * FROM violation_records WHERE student_id = 'TEST1' AND violation_type = 'overdue'").get();
      expect(violation).toBeDefined();
      expect(violation.duration_minutes).toBe(20); // strictly 20 minutes
      expect(violation.status).toBe('active');
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

      // 5. Verify transaction rollback
      const beforeRollback = db.prepare("SELECT start_time, end_time, modified_count, status FROM reservations WHERE booking_code=?").get(code1) as any;
      db.exec(`
        CREATE TRIGGER abort_reservation_update
        BEFORE UPDATE ON reservations
        BEGIN
          SELECT RAISE(ABORT, 'forced rollback');
        END;
      `);
      
      try {
        const rollbackRes = await request(app).post('/api/reservations/update').send({
          booking_code: code1,
          start_time: t(24),
          end_time: t(25.5),
        });
        expect(rollbackRes.status).toBe(500);
        
        const afterRollback = db.prepare("SELECT start_time, end_time, modified_count, status FROM reservations WHERE booking_code=?").get(code1) as any;
        expect(afterRollback).toEqual(beforeRollback);
      } finally {
        db.exec('DROP TRIGGER IF EXISTS abort_reservation_update');
      }
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

    it('should filter admin reservations and handle strict AND multi-param boundaries', async () => {
      const eqId = setupEquipment();
      setupSettings();
      const res1 = await createRes({ equipment_id: eqId, student_id: 'S1', student_name: 'Alice', supervisor: 'Dr. Smith', phone: '123', email: 'a@b.com', start_time: t(48), end_time: t(49) });
      expect(res1.status).toBe(200);
      const res2 = await createRes({ equipment_id: eqId, student_id: 'S2', student_name: 'Bob', supervisor: 'Dr. Jones', phone: '123', email: 'a@b.com', start_time: t(50), end_time: t(51) });
      expect(res2.status).toBe(200);
      const res3 = await createRes({ equipment_id: eqId, student_id: 'S3', student_name: 'Alice', supervisor: 'Dr. Jones', phone: '123', email: 'a@b.com', start_time: t(52), end_time: t(53) });
      expect(res3.status).toBe(200);

      // 1. List Filtering (Single)
      const listAlice = await request(app).get('/api/admin/reservations?student_name=Alice').set('Authorization', 'Bearer ' + adminToken);
      expect(listAlice.status).toBe(200);
      expect(listAlice.body.length).toBe(2);
      expect(listAlice.body.some((r: any) => r.student_name === 'Bob')).toBe(false);

      // 2. List Filtering (Strict AND multiple params)
      const listAliceJones = await request(app).get('/api/admin/reservations?student_name=Alice&supervisor=Jones').set('Authorization', 'Bearer ' + adminToken);
      expect(listAliceJones.status).toBe(200);
      expect(listAliceJones.body.length).toBe(1);
      expect(listAliceJones.body.find((r:any) => r.student_name === 'Alice')).toBeDefined();
      expect(listAliceJones.body.find((r:any) => r.supervisor === 'Dr. Jones')).toBeDefined();

      // 3. Stats Empty Boundaries
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
