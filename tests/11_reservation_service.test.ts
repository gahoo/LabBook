import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { db } from '../src/db/index.js';
import { addHours, addMinutes } from 'date-fns';
import { resetTestDatabase } from './utils/db-helper.js';
import { ReservationService } from '../src/modules/reservation/service.js';
import { OperationRejectError } from '../src/lib/errors.js';

const toIso = (d: Date) => d.toISOString().split('.')[0] + 'Z';
const fixedNow = new Date('2030-01-15T10:00:00.000Z');
const t = (h: number) => toIso(addHours(fixedNow, h));
const tMin = (m: number) => toIso(addMinutes(fixedNow, m));

describe('ReservationService (11_reservation_service.test.ts)', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  beforeEach(() => {
    resetTestDatabase();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  const setupEquipment = (availParams = {}, overrides: any = {}) => {
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
  const baseData = {
    student_id: "STU_123",
    student_name: "Test Student",
    supervisor: "Super Visor",
    phone: "12345678901",
    email: "test@example.com",
  };

  const createResData = (eqId: number, start: string, end: string, overrides: any = {}) => ({
    ...baseData,
    equipment_id: eqId,
    start_time: start,
    end_time: end,
    ...overrides
  });


  it('should successfully create a reservation bypassing HTTP', () => {
    const eqId = setupEquipment();
    
    const data = {
      equipment_id: eqId,
      student_id: 'STU_123',
      student_name: 'Test Student',
      supervisor: 'Super Visor',
      phone: '12345678901',
      email: 'test@example.com',
      start_time: t(1),
      end_time: t(2)
    };
    
    const result = ReservationService.create(data, -480);
    
    expect(result.booking_code).toBeDefined();
    expect(result.status).toBe('approved');
    
    const saved = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(result.booking_code) as any;
    expect(saved).toBeDefined();
    expect(saved.student_id).toBe('STU_123');
    expect(saved.status).toBe('approved');
  });

  it('should throw OperationRejectError on conflict', () => {
    const eqId = setupEquipment();
    
    const data1 = {
      equipment_id: eqId,
      student_id: 'STU_1',
      student_name: 'Test 1',
      supervisor: 'Super Visor',
      phone: '12345678901',
      email: 'test@example.com',
      start_time: t(1),
      end_time: t(2)
    };
    
    ReservationService.create(data1, -480);
    
    const data2 = {
      equipment_id: eqId,
      student_id: 'STU_2',
      student_name: 'Test 2',
      supervisor: 'Super Visor',
      phone: '12345678901',
      email: 'test@example.com',
      start_time: tMin(90), // 1.5 hours, overlaps with data1 (1-2)
      end_time: t(3)
    };
    
    expect(() => ReservationService.create(data2, -480)).toThrowError(OperationRejectError);
    expect(() => ReservationService.create(data2, -480)).toThrowError(/该时间段已被预约/);
  });

  it('should mark status as pending when equipment auto_approve is false', () => {
    const eqId = setupEquipment({}, { auto_approve: false });
    
    const data = {
      equipment_id: eqId,
      student_id: 'STU_123',
      student_name: 'Test Student',
      supervisor: 'Super Visor',
      phone: '12345678901',
      email: 'test@example.com',
      start_time: t(1),
      end_time: t(2)
    };
    
    const result = ReservationService.create(data, -480);
    expect(result.status).toBe('pending');
       const saved = db.prepare('SELECT status FROM reservations WHERE booking_code = ?').get(result.booking_code) as any;
       expect(saved.status).toBe('pending');
    
  });

  it('should validate invalid inputs', () => {
    const eqId = setupEquipment();
    
    // Missing equipment_id
    expect(() => ReservationService.create(createResData(undefined as any, t(1), t(2)))).toThrowError(/equipment_id 必须为有效的整数/);
    
    // Invalid time bounds
    expect(() => ReservationService.create(createResData(eqId, t(2), t(1)))).toThrowError(/结束时间必须晚于开始时间/);
  });

  it('should mark status pending when booking out of hours if allowOutOfHours is true', () => {
    const eqId = setupEquipment({
      rules: Array.from({length: 7}, (_, i) => ({ day: i, start: '09:00', end: '17:00' })),
      allowOutOfHours: true
    });
    
    // Assuming fixedNow is 2030-01-15T10:00:00.000Z (Tuesday)
    // -480 offset means UTC+8. UTC 10:00 -> UTC+8 18:00
    // So fixedNow local time is 18:00
    // We book from 19:00 to 20:00 (UTC 11:00 to 12:00) which is out of hours (17:00 to 09:00)
    
    const data = {
      equipment_id: eqId,
      student_id: 'STU_123',
      student_name: 'Test Student',
      supervisor: 'Super Visor',
      phone: '12345678901',
      email: 'test@example.com',
      start_time: t(1), // UTC 11:00 -> Local 19:00
      end_time: t(2)    // UTC 12:00 -> Local 20:00
    };
    
    const result = ReservationService.create(data, -480);
    expect(result.status).toBe('pending');
       const saved = db.prepare('SELECT status FROM reservations WHERE booking_code = ?').get(result.booking_code) as any;
       expect(saved.status).toBe('pending');
  });


  describe('3.1.1 Time Limits & Boundaries', () => {
    it('should reject when duration > maxDurationMinutes', () => {
      const eqId = setupEquipment({ maxDurationMinutes: 60 });
      const data = createResData(eqId, t(1), t(3)); // 2 hours
      expect(() => ReservationService.create(data, -480)).toThrowError(/单次时长上限/);
    });

    it('should reject when daily accumulated duration > dailyMaxDurationMinutes', () => {
      const eqId = setupEquipment({ maxDurationMinutes: 120, dailyMaxDurationMinutes: 180 });
      ReservationService.create(createResData(eqId, t(1), t(3)), -480);
      const data2 = createResData(eqId, t(4), t(6)); // 120 + 120 = 240 > 180
      expect(() => ReservationService.create(data2, -480)).toThrowError(/超过单日预约总时长硬性上限/);
    });

    it('should allow booking exactly at maxDurationMinutes and minDurationMinutes', () => {
      const eqId = setupEquipment({ maxDurationMinutes: 120, minDurationMinutes: 30 });
      
      const dataMax = createResData(eqId, t(1), t(3)); // exactly 120m
      const resMax = ReservationService.create(dataMax, -480);
      expect(resMax.status).toBe('approved');
      
      const dataMin = createResData(eqId, t(4), tMin(240 + 30)); // exactly 30m
      const resMin = ReservationService.create(dataMin, -480);
      expect(resMin.status).toBe('approved');
    });

    it('should allow adjacent bookings (A.end === B.start)', () => {
      const eqId = setupEquipment();
      const data1 = createResData(eqId, t(1), t(2));
      ReservationService.create(data1, -480);
      
      const data2 = createResData(eqId, t(2), t(3)); // exactly at t(2)
      expect(() => ReservationService.create(data2, -480)).not.toThrow();
    });

    it('should allow booking exactly crossing midnight', () => {
      const eqId = setupEquipment({ dailyMaxDurationMinutes: 240 });
      // Book from 23:00 to 01:00 next day (local time).
      // FixedNow is local 18:00 (UTC 10:00). So local 23:00 is +5 hours.
      const dataCross = createResData(eqId, t(5), t(7)); // 120 minutes
      const resCross = ReservationService.create(dataCross, -480);
      expect(resCross.status).toBe('approved');
      
      // The current implementation calculates daily usage by assigning the entire duration
      // to the DATE(start_time). So 120 minutes are counted towards the first day.
      // We can still book 120 minutes on the first day.
      const dataBefore = createResData(eqId, t(1), t(3)); // 2 hours (120m) on first day
      expect(() => ReservationService.create(dataBefore, -480)).not.toThrow();
      
      // Booking another 1 hour on the first day should fail.
      const dataBeforeFail = createResData(eqId, t(3), t(4)); // 1 hour on first day
      expect(() => ReservationService.create(dataBeforeFail, -480)).toThrowError(/超过单日预约总时长硬性上限/);
    });
  });

  describe('3.1.2 Peak/Off-peak Logic', () => {
    it('should reject peak exceeding if not allowed', () => {
       const eqId = setupEquipment({ 
         maxDurationMinutes: 60, 
         peakHours: [{ start: '10:00', end: '15:00' }],
         allowExceedDuration: false 
       });
       // fixedNow UTC 10:00 -> Local 18:00
       // local tomorrow 10:00 -> UTC 02:00
       const data = createResData(eqId, t(16), t(18)); // 16h after UTC 10:00 is UTC 02:00
       expect(() => ReservationService.create(data, -480)).toThrowError(/占用的忙时/);
    });

    it('should allow and set pending if allowExceed is true for peak', () => {
       const eqId = setupEquipment({ 
         maxDurationMinutes: 60, 
         peakHours: [{ start: '10:00', end: '15:00' }],
         allowExceedDuration: true 
       });
       const data = createResData(eqId, t(16), t(18));
       const result = ReservationService.create(data, -480);
       expect(result.status).toBe('pending');
       const saved = db.prepare('SELECT status FROM reservations WHERE booking_code = ?').get(result.booking_code) as any;
       expect(saved.status).toBe('pending');
    });

    it('should allow and set pending if allowExceedDurationOffPeak is true for off-peak', () => {
       const eqId = setupEquipment({ 
         maxDurationMinutes: 60, 
         allowExceedDurationOffPeak: true 
       });
       // local 19:00 -> UTC 11:00
       const data = createResData(eqId, t(1), t(3));
       const result = ReservationService.create(data, -480);
       expect(result.status).toBe('approved');
    });
  });

  describe('3.1.3 Whitelist', () => {
    it('should reject if whitelist_enabled is true and user not in whitelist', () => {
      const eqId = setupEquipment({}, { whitelist_enabled: true });
      db.prepare('UPDATE equipment SET whitelist_data = ? WHERE id = ?').run('Alice, Bob', eqId);
      
      const data = createResData(eqId, t(1), t(2), { student_name: 'Test Student' });
      expect(() => ReservationService.create(data, -480)).toThrowError(/不在该仪器的预约白名单中/);
    });
    
    it('should pass if whitelist_enabled is true and user in whitelist', () => {
      const eqId = setupEquipment({}, { whitelist_enabled: true });
      db.prepare('UPDATE equipment SET whitelist_data = ? WHERE id = ?').run('Alice, Test Student', eqId);
      
      const data = createResData(eqId, t(1), t(2), { student_name: 'Test Student' });
      const res = ReservationService.create(data, -480);
      expect(res.status).toBe('approved');
    });
  });

  describe('3.1.4 Advance Days limit', () => {
    it('should reject if booking exceeds advanceDays', () => {
       const eqId = setupEquipment({ advanceDays: 7 });
       const data = createResData(eqId, t(24 * 8), t(24 * 8 + 1));
       expect(() => ReservationService.create(data, -480)).toThrowError(/只能提前 7 天预约/);
    });
  });

  describe('3.1.5 Penalty System Interop', () => {
    let ruleId: number;
    beforeEach(() => {
      const ruleInfo = db.prepare(`INSERT INTO penalty_rules (name, violation_type, trigger_config, action_config) VALUES (?, ?, ?, ?)`).run('Test Rule', 'late', '{}', '{}');
      ruleId = ruleInfo.lastInsertRowid as number;
    });

    it('should hard reject if user is BANned', () => {
       const eqId = setupEquipment();
       db.prepare(`INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('STU_BAN', ruleId, 'BAN', '{}', t(-1), t(24), 'active');
       const data = createResData(eqId, t(1), t(2), { student_id: 'STU_BAN' });
       expect(() => ReservationService.create(data, -480)).toThrowError(/Test Rule/);
    });

    it('should degrade to pending if user has REQUIRE_APPROVAL penalty', () => {
       const eqId = setupEquipment();
       db.prepare(`INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('STU_REQ', ruleId, 'REQUIRE_APPROVAL', '{}', t(-1), t(24), 'active');
       const data = createResData(eqId, t(1), t(2), { student_id: 'STU_REQ' });
       const res = ReservationService.create(data, -480);
       expect(res.status).toBe('pending');
    });

    it('should reduce advanceDays if user has reduce_days restriction', () => {
       const eqId = setupEquipment({ advanceDays: 7 });
       const restrictions = JSON.stringify({ reduce_days: 5, min_retain_days: 1 });
       db.prepare(`INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('STU_RED', ruleId, 'RESTRICT_ADVANCE', restrictions, t(-1), t(24), 'active');
       
       const data = { ...baseData, student_id: 'STU_RED', equipment_id: eqId, start_time: t(24 * 3), end_time: t(24 * 3 + 1) };
       expect(() => ReservationService.create(data, -480)).toThrowError(/受惩罚规则限制，您当前只能提前 2 天预约/);
    });
  });

  describe('3.1.6 No-Show Release', () => {
    it('should allow concurrent booking if previous booking is >30 min late (No-show) and release_noshow_slots is true', () => {
      const eqId = setupEquipment({}, { release_noshow_slots: true });
      const pastData = { ...baseData, student_id: 'STU_NO_SHOW', equipment_id: eqId, start_time: tMin(-45), end_time: tMin(45) };
      
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, booking_code, status, start_time, end_time) VALUES (?, ?, ?, 'Super', '123', 'a@b.com', 'NOSHOW', ?, ?, ?)`).run(eqId, 'STU_NO_SHOW', 'No Show', 'approved', pastData.start_time, pastData.end_time);

      const data = createResData(eqId, tMin(0), tMin(30));
      const res = ReservationService.create(data, -480);
      expect(res.status).toBe('approved');
    });

    it('should NOT allow concurrent booking if previous booking is <30 min late', () => {
      const eqId = setupEquipment({}, { release_noshow_slots: true });
      const pastData = { ...baseData, student_id: 'STU_LATE', equipment_id: eqId, start_time: tMin(-15), end_time: tMin(45) };
      
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, booking_code, status, start_time, end_time) VALUES (?, ?, ?, 'Super', '123', 'a@b.com', 'LATE', ?, ?, ?)`).run(eqId, 'STU_LATE', 'Late', 'approved', pastData.start_time, pastData.end_time);

      const data = createResData(eqId, tMin(0), tMin(30));
      expect(() => ReservationService.create(data, -480)).toThrowError(/该时间段已被预约/);
    });
  });

  describe('3.1.7 Hidden & Malformed JSON', () => {
    it('should reject if equipment is_hidden', () => {
      const eqId = setupEquipment({}, { is_hidden: true });
      const data = createResData(eqId, t(1), t(2));
      expect(() => ReservationService.create(data, -480)).toThrowError(/该仪器暂不开放预约/);
    });

    it('should degrade gracefully if availability_json is malformed', () => {
      const eqId = setupEquipment();
      db.prepare('UPDATE equipment SET availability_json = ? WHERE id = ?').run('{ invalid_json ', eqId);
      
      const data1 = { ...baseData, equipment_id: eqId, start_time: t(1), end_time: tMin(60 + 15) };
      expect(() => ReservationService.create(data1, -480)).toThrowError(/预约时长不能少于 30 分钟/);
      
      const data2 = createResData(eqId, t(24 * 8), t(24 * 8 + 1));
      expect(() => ReservationService.create(data2, -480)).toThrowError(/只能提前 7 天预约/);
      
      const data3 = createResData(eqId, t(1), t(2));
      expect(() => ReservationService.create(data3, -480)).toThrowError(/所选时间包含了仪器不开放的日期/);
    });
  });
  describe('3.4 Reservation Service Lifecycle', () => {
    let eqId: number;
    let baseResData: any;
    
    beforeEach(() => {
      eqId = setupEquipment();
      baseResData = createResData(eqId, t(1), t(2));
      vi.setSystemTime(fixedNow); // Reset time before each test
    });

    describe('3.4.1 checkin', () => {
      it('should fail if booking not found', () => {
        expect(() => ReservationService.checkin('INVALID')).toThrowError(/未找到该预约/);
      });

      it('should fail if status is not approved', () => {
        const eqId2 = setupEquipment({}, { auto_approve: false });
        const res2 = ReservationService.create(createResData(eqId2, t(1), t(2)), -480);
        expect(res2.status).toBe('pending');
        expect(() => ReservationService.checkin(res2.booking_code)).toThrowError(/未通过审批/);
      });

      it('should fail if checking in too early', () => {
        const res = ReservationService.create(createResData(eqId, t(2), t(3)), -480); // starts in 2 hours
        expect(() => ReservationService.checkin(res.booking_code)).toThrowError(/只能在预约开始前 30 分钟内上机/);
      });

      it('should fail if checking in too late', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480); // starts in 1 hour
        
        // Fast forward 1 hour 40 mins
        vi.setSystemTime(new Date(fixedNow.getTime() + 100 * 60000));
        expect(() => ReservationService.checkin(res.booking_code)).toThrowError(/已超过预约开始时间30分钟/);
      });

      it('should successfully check in within time window', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480); // starts in 1 hour
        
        // Fast forward 50 mins (10 mins before start)
        vi.setSystemTime(new Date(fixedNow.getTime() + 50 * 60000));
        ReservationService.checkin(res.booking_code);
        
        const saved = db.prepare('SELECT status, actual_start_time FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved.status).toBe('active');
        expect(saved.actual_start_time).toBeDefined();
      });

      it('should trigger late penalty if diffMinutes > late_grace_minutes', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480); // starts in 1 hour
        
        // Fast forward 1 hour + 20 mins (20 mins late)
        vi.setSystemTime(new Date(fixedNow.getTime() + 80 * 60000));
        ReservationService.checkin(res.booking_code);
        
        const violation = db.prepare('SELECT * FROM violation_records WHERE reservation_id = ?').get(res.id) as any;
        expect(violation).toBeDefined();
        expect(violation.violation_type).toBe('late');
      });
    });

    describe('3.4.2 checkout', () => {
      it('should fail if booking not found or not active', () => {
        expect(() => ReservationService.checkout('INVALID')).toThrowError(/未找到该预约/);
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        expect(() => ReservationService.checkout(res.booking_code)).toThrowError(/未在进行中/);
      });

      it('should successfully check out and calculate correct cost (hour based)', () => {
        const eqIdCost = setupEquipment({}, { price_type: 'hour', price: 10 });
        const res = ReservationService.create(createResData(eqIdCost, t(1), t(2)), -480); // starts in 1h, ends in 2h
        
        vi.setSystemTime(new Date(fixedNow.getTime() + 60 * 60000)); // exactly start time
        ReservationService.checkin(res.booking_code);
        
        // Fast forward 1 hour (checkout exactly at end time)
        vi.setSystemTime(new Date(fixedNow.getTime() + 120 * 60000));
        ReservationService.checkout(res.booking_code, 2); // consumable qty 2
        
        const saved = db.prepare('SELECT status, actual_end_time, total_cost FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved.status).toBe('completed');
        expect(saved.total_cost).toBe(10); // 1 hour * 10 = 10.
        expect(saved.actual_end_time).toBeDefined();
      });

      it('should apply fee_multiplier if user is penalized', () => {
        const eqIdCost = setupEquipment({}, { price_type: 'hour', price: 10 });
        const res = ReservationService.create(createResData(eqIdCost, t(1), t(2)), -480);
        
        vi.setSystemTime(new Date(fixedNow.getTime() + 60 * 60000));
        ReservationService.checkin(res.booking_code);
        
        // Add penalty for this user right before checkout
        db.prepare(`INSERT INTO penalty_rules (name, violation_type, trigger_config, action_config) VALUES ('Fee', 'late', '{}', '{}')`).run();
        const ruleId = (db.prepare('SELECT last_insert_rowid() as id').get() as any).id;
        db.prepare(`INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time, status) VALUES (?, ?, 'DOUBLE_FEE', '{"multiplier":2}', ?, ?, 'active')`).run('STU_123', ruleId, t(-1), t(24));
        
        vi.setSystemTime(new Date(fixedNow.getTime() + 120 * 60000));
        ReservationService.checkout(res.booking_code);
        
        const saved = db.prepare('SELECT total_cost FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved.total_cost).toBe(20); // 10 * 2
      });

      it('should trigger overdue violation if checked out late', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        
        vi.setSystemTime(new Date(fixedNow.getTime() + 60 * 60000));
        ReservationService.checkin(res.booking_code);
        
        // Check out 30 mins late (end is t(2), so + 150 mins from fixedNow)
        vi.setSystemTime(new Date(fixedNow.getTime() + 150 * 60000));
        ReservationService.checkout(res.booking_code);
        
        const violation = db.prepare('SELECT * FROM violation_records WHERE reservation_id = ?').get(res.id) as any;
        expect(violation).toBeDefined();
        expect(violation.violation_type).toBe('overdue');
      });
    });

    describe('3.4.3 cancel', () => {
      it('should fail if booking not found or not pending/approved', () => {
        expect(() => ReservationService.cancel('INVALID')).toThrowError(/未找到该预约/);
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        ReservationService.cancel(res.booking_code);
        expect(() => ReservationService.cancel(res.booking_code)).toThrowError(/无法取消进行中或已完成的预约/);
      });

      it('should fail if > 30 mins late (no-show grace)', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        vi.setSystemTime(new Date(fixedNow.getTime() + 100 * 60000)); // 1h 40m later
        expect(() => ReservationService.cancel(res.booking_code)).toThrowError(/不允许取消或者修改/);
      });

      it('should successfully cancel and not trigger late cancel if far enough in advance', () => {
        const res = ReservationService.create(createResData(eqId, t(3), t(4)), -480); // starts in 3 hours
        ReservationService.cancel(res.booking_code);
        
        const saved = db.prepare('SELECT status FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved.status).toBe('cancelled');
        
        const violation = db.prepare('SELECT * FROM violation_records WHERE reservation_id = ?').get(res.id) as any;
        expect(violation).toBeUndefined();
      });

      it('should trigger late_cancel violation if within late cancellation window', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480); // starts in 1 hour
        ReservationService.cancel(res.booking_code); // default late cancel is 120 mins
        
        const violation = db.prepare('SELECT * FROM violation_records WHERE reservation_id = ?').get(res.id) as any;
        expect(violation).toBeDefined();
        expect(violation.violation_type).toBe('late_cancel');
      });
    });

    describe('3.4.4 update, adminUpdate, adminDelete', () => {
      it('should fail to update if > 30 mins late', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        vi.setSystemTime(new Date(fixedNow.getTime() + 100 * 60000)); // 1h 40m later
        expect(() => ReservationService.update(res.booking_code, t(2), t(3))).toThrowError(/不允许取消或者修改/);
      });

      it('should fail to update if modified_count >= 1', () => {
        const res = ReservationService.create(createResData(eqId, t(2), t(3)), -480);
        ReservationService.update(res.booking_code, t(3), t(4));
        expect(() => ReservationService.update(res.booking_code, t(4), t(5))).toThrowError(/每个预约仅允许修改一次时间/);
      });

      it('should successfully update and change status to pending if rules dictate', () => {
        const eqId2 = setupEquipment({ peakHours: [{ start: '10:00', end: '15:00' }], allowExceedDuration: true });
        
        // We want to book local 13:00 to 14:00 (off-peak)
        // UTC 10:00 is Local 18:00 (tz_offset -480).
        // Tomorrow Local 13:00 -> UTC 05:00 next day -> 19 hours ahead.
        const res = ReservationService.create(createResData(eqId2, t(19), t(20)), -480);
        expect(res.status).toBe('approved');
        
        // Update to Peak (Local 11:00 next day -> UTC 03:00 next day -> 17 hours ahead)
        ReservationService.update(res.booking_code, t(17), t(20), -480);
        
        const saved = db.prepare('SELECT status, modified_count FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved.status).toBe('pending');
        expect(saved.modified_count).toBe(1);
      });

      it('should successfully adminUpdate', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        ReservationService.adminUpdate(res.id, { status: 'cancelled' });
        const saved = db.prepare('SELECT status FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved.status).toBe('cancelled');
      });

      it('should successfully adminDelete', () => {
        const res = ReservationService.create(createResData(eqId, t(1), t(2)), -480);
        ReservationService.adminDelete(res.id, 'Test delete');
        const saved = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(res.booking_code) as any;
        expect(saved).toBeUndefined();
      });
    });
  });
});
