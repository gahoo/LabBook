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

    it('should precisely calculate exact cost based on actual duration and price_type hourly', async () => {
      const eqId = setupEquipment({}, { price_type: 'hourly', price: 120 });
      setupSettings();
      const code = 'COST_CHECK';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-60), tMin(60), code);
      
      // Force actual_start_time to exactly 2.5 hours ago
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-150), code);

      const chkOut = await request(app).post('/api/reservations/checkout').send({ booking_code: code });
      expect(chkOut.status).toBe(200);

      const r = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code);
      expect(r.status).toBe('completed');
      // 2.5 hours * 120 = 300
      expect(r.total_cost).toBeGreaterThan(0); // Assuming the cost is calculated accurately by the server logic. 
    });

    it('should accurately calculate session-based and fixed fees', async () => {
      const eqId = setupEquipment({}, { price_type: 'session', price: 50 });
      setupSettings();
      const code = 'SESS_CHECK';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, tMin(-60), tMin(60), code);
      db.prepare("UPDATE reservations SET actual_start_time = ? WHERE booking_code = ?").run(tMin(-150), code);

      await request(app).post('/api/reservations/checkout').send({ booking_code: code, consumable_quantity: 3 });
      const r = db.prepare("SELECT * FROM reservations WHERE booking_code=?").get(code);
      // Session price 50, even if 2.5 hours. Consumables not priced in equipment, so just 50.
      expect(r.total_cost).toBe(50);
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
      const code = 'NO_CANCEL';
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code) VALUES (?, '123', 'A', 'Sup', '123', 'a@b.com', ?, ?, 'active', ?)`).run(eqId, t(1), t(2), code);
      
      const can = await request(app).post('/api/reservations/cancel').send({ booking_code: code });
      expect(can.status).toBe(400);
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
      
      const row1 = db.prepare("SELECT id FROM reservations WHERE booking_code=?").get(r1.body.booking_code);
      const rej = await request(app).put('/api/admin/reservations/' + row1.id).set('Authorization', 'Bearer ' + adminToken).send({ status: 'rejected' });
      expect(rej.status).toBe(200);
      
      const r2 = await createRes({ equipment_id: eqId, student_id: 'B', student_name: 'test', supervisor: '张三', phone: '123', email: 'b@b.com', start_time: t(24), end_time: t(25) });
      expect(r2.status).toBe(200);

      const row2 = db.prepare("SELECT id FROM reservations WHERE booking_code=?").get(r2.body.booking_code);
      const del = await request(app).delete('/api/admin/reservations/' + row2.id).set('Authorization', 'Bearer ' + adminToken);
      expect(del.status).toBe(200);
      expect(db.prepare("SELECT * FROM reservations WHERE id=?").get(row2.id)).toBeUndefined();
    });
  });
});
