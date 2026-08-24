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
    
    const baseData = {
      equipment_id: eqId,
      student_id: 'STU_123',
      student_name: 'Test Student',
      supervisor: 'Super Visor',
      phone: '12345678901',
      email: 'test@example.com',
      start_time: t(1),
      end_time: t(2)
    };
    
    // Missing equipment_id
    expect(() => ReservationService.create({ ...baseData, equipment_id: undefined })).toThrowError(/equipment_id 必须为有效的整数/);
    
    // Invalid time bounds
    expect(() => ReservationService.create({ ...baseData, start_time: t(2), end_time: t(1) })).toThrowError(/结束时间必须晚于开始时间/);
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
  });

  const baseData = {
    student_id: 'STU_123',
    student_name: 'Test Student',
    supervisor: 'Super Visor',
    phone: '12345678901',
    email: 'test@example.com',
  };

  describe('3.1.1 Time Limits', () => {
    it('should reject when duration > maxDurationMinutes', () => {
      const eqId = setupEquipment({ maxDurationMinutes: 60 });
      const data = { ...baseData, equipment_id: eqId, start_time: t(1), end_time: t(3) }; // 2 hours
      expect(() => ReservationService.create(data, -480)).toThrowError(/单次时长上限/);
    });

    it('should reject when daily accumulated duration > dailyMaxDurationMinutes', () => {
      const eqId = setupEquipment({ maxDurationMinutes: 120, dailyMaxDurationMinutes: 180 });
      ReservationService.create({ ...baseData, equipment_id: eqId, start_time: t(1), end_time: t(3) }, -480);
      const data2 = { ...baseData, equipment_id: eqId, start_time: t(4), end_time: t(6) }; // 120 + 120 = 240 > 180
      expect(() => ReservationService.create(data2, -480)).toThrowError(/超过单日预约总时长硬性上限/);
    });
  });

  describe('3.1.2 Peak/Off-peak Logic', () => {
    it('should reject peak exceeding if not allowed', () => {
       const eqId = setupEquipment({ 
         maxDurationMinutes: 60, 
         peakHours: [{ start: '10:00', end: '12:00' }],
         allowExceedDuration: false 
       });
       // fixedNow UTC 10:00 -> Local 18:00
       // local tomorrow 10:00 -> UTC 02:00
       const data = { ...baseData, equipment_id: eqId, start_time: t(16), end_time: t(18) }; // 16h after UTC 10:00 is UTC 02:00
       expect(() => ReservationService.create(data, -480)).toThrowError(/占用的忙时/);
    });

    it('should allow and set pending if allowExceed is true for peak', () => {
       const eqId = setupEquipment({ 
         maxDurationMinutes: 60, 
         peakHours: [{ start: '10:00', end: '12:00' }],
         allowExceedDuration: true 
       });
       const data = { ...baseData, equipment_id: eqId, start_time: t(16), end_time: t(18) };
       const result = ReservationService.create(data, -480);
       expect(result.status).toBe('pending');
    });

    it('should allow and set pending if allowExceedDurationOffPeak is true for off-peak', () => {
       const eqId = setupEquipment({ 
         maxDurationMinutes: 60, 
         allowExceedDurationOffPeak: true 
       });
       // local 19:00 -> UTC 11:00
       const data = { ...baseData, equipment_id: eqId, start_time: t(1), end_time: t(3) };
       const result = ReservationService.create(data, -480);
       expect(result.status).toBe('approved');
    });
  });

  describe('3.1.3 Whitelist', () => {
    it('should reject if whitelist_enabled is true and user not in whitelist', () => {
      const eqId = setupEquipment({}, { whitelist_enabled: true });
      db.prepare('UPDATE equipment SET whitelist_data = ? WHERE id = ?').run('Alice, Bob', eqId);
      
      const data = { ...baseData, equipment_id: eqId, student_name: 'Test Student', start_time: t(1), end_time: t(2) };
      expect(() => ReservationService.create(data, -480)).toThrowError(/不在该仪器的预约白名单中/);
    });
    
    it('should pass if whitelist_enabled is true and user in whitelist', () => {
      const eqId = setupEquipment({}, { whitelist_enabled: true });
      db.prepare('UPDATE equipment SET whitelist_data = ? WHERE id = ?').run('Alice, Test Student', eqId);
      
      const data = { ...baseData, equipment_id: eqId, student_name: 'Test Student', start_time: t(1), end_time: t(2) };
      const res = ReservationService.create(data, -480);
      expect(res.status).toBe('approved');
    });
  });

  describe('3.1.4 Advance Days limit', () => {
    it('should reject if booking exceeds advanceDays', () => {
       const eqId = setupEquipment({ advanceDays: 7 });
       const data = { ...baseData, equipment_id: eqId, start_time: t(24 * 8), end_time: t(24 * 8 + 1) };
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
       const data = { ...baseData, student_id: 'STU_BAN', equipment_id: eqId, start_time: t(1), end_time: t(2) };
       expect(() => ReservationService.create(data, -480)).toThrowError(/Test Rule/);
    });

    it('should degrade to pending if user has REQUIRE_APPROVAL penalty', () => {
       const eqId = setupEquipment();
       db.prepare(`INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('STU_REQ', ruleId, 'REQUIRE_APPROVAL', '{}', t(-1), t(24), 'active');
       const data = { ...baseData, student_id: 'STU_REQ', equipment_id: eqId, start_time: t(1), end_time: t(2) };
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

      const data = { ...baseData, equipment_id: eqId, start_time: tMin(0), end_time: tMin(30) };
      const res = ReservationService.create(data, -480);
      expect(res.status).toBe('approved');
    });

    it('should NOT allow concurrent booking if previous booking is <30 min late', () => {
      const eqId = setupEquipment({}, { release_noshow_slots: true });
      const pastData = { ...baseData, student_id: 'STU_LATE', equipment_id: eqId, start_time: tMin(-15), end_time: tMin(45) };
      
      db.prepare(`INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, booking_code, status, start_time, end_time) VALUES (?, ?, ?, 'Super', '123', 'a@b.com', 'LATE', ?, ?, ?)`).run(eqId, 'STU_LATE', 'Late', 'approved', pastData.start_time, pastData.end_time);

      const data = { ...baseData, equipment_id: eqId, start_time: tMin(0), end_time: tMin(30) };
      expect(() => ReservationService.create(data, -480)).toThrowError(/该时间段已被预约/);
    });
  });

  describe('3.1.7 Hidden & Malformed JSON', () => {
    it('should reject if equipment is_hidden', () => {
      const eqId = setupEquipment({}, { is_hidden: true });
      const data = { ...baseData, equipment_id: eqId, start_time: t(1), end_time: t(2) };
      expect(() => ReservationService.create(data, -480)).toThrowError(/该仪器暂不开放预约/);
    });

    it('should degrade gracefully if availability_json is malformed', () => {
      const eqId = setupEquipment();
      db.prepare('UPDATE equipment SET availability_json = ? WHERE id = ?').run('{ invalid_json ', eqId);
      
      const data1 = { ...baseData, equipment_id: eqId, start_time: t(1), end_time: tMin(60 + 15) };
      expect(() => ReservationService.create(data1, -480)).toThrowError(/预约时长不能少于 30 分钟/);
      
      const data2 = { ...baseData, equipment_id: eqId, start_time: t(24 * 8), end_time: t(24 * 8 + 1) };
      expect(() => ReservationService.create(data2, -480)).toThrowError(/只能提前 7 天预约/);
      
      const data3 = { ...baseData, equipment_id: eqId, start_time: t(1), end_time: t(2) };
      expect(() => ReservationService.create(data3, -480)).toThrowError(/所选时间包含了仪器不开放的日期/);
    });
  });
});
