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
});
