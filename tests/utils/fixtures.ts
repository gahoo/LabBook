import { db } from '../../src/db/index.js';

export function createTestEquipment(overrides: any = {}): number {
  const defaultEquip = {
    name: 'Fixture Equipment',
    type: 'fixture_type',
    status: 'available',
    location: 'Lab A',
    min_duration_minutes: 30,
    max_duration_minutes: 120,
    advance_reservation_days: 7,
    hourly_rate: 10,
    price_type: 'time',
    price: 10,
    ...overrides
  };
  
  const stmt = db.prepare(`
    INSERT INTO equipment (
      name, type, status, location, 
      min_duration_minutes, max_duration_minutes, advance_reservation_days,
      hourly_rate, price_type, price
    ) VALUES (
      @name, @type, @status, @location,
      @min_duration_minutes, @max_duration_minutes, @advance_reservation_days,
      @hourly_rate, @price_type, @price
    )
  `);
  
  const result = stmt.run(defaultEquip);
  return result.lastInsertRowid as number;
}

export function createTestReservation(overrides: any = {}): { id: number, booking_code: string } {
  const booking_code = overrides.booking_code || `B-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const defaultRes = {
    equipment_id: overrides.equipment_id || 1, // Assumes equipment 1 exists or created prior
    student_name: 'Test Student',
    student_id: 'STU001',
    supervisor: '',
    start_time: new Date(Date.now() + 3600000).toISOString(),
    end_time: new Date(Date.now() + 7200000).toISOString(),
    status: 'pending',
    booking_code,
    ...overrides
  };

  const stmt = db.prepare(`
    INSERT INTO reservations (
      equipment_id, student_name, student_id, supervisor,
      start_time, end_time, status, booking_code
    ) VALUES (
      @equipment_id, @student_name, @student_id, @supervisor,
      @start_time, @end_time, @status, @booking_code
    )
  `);
  
  const result = stmt.run(defaultRes);
  return { id: result.lastInsertRowid as number, booking_code };
}

export function createTestPenaltyRule(overrides: any = {}): number {
  const defaultRule = {
    name: 'Fixture Rule',
    description: 'Fixture Description',
    metric: 'cancel_late',
    condition: '>=',
    threshold: 1,
    time_window_days: 30,
    penalty_type: 'REQUIRE_APPROVAL',
    penalty_duration_days: 7,
    is_active: 1,
    ...overrides
  };

  const stmt = db.prepare(`
    INSERT INTO penalty_rules (
      name, description, metric, condition, threshold, time_window_days, penalty_type, penalty_duration_days, is_active
    ) VALUES (
      @name, @description, @metric, @condition, @threshold, @time_window_days, @penalty_type, @penalty_duration_days, @is_active
    )
  `);
  const result = stmt.run(defaultRule);
  return result.lastInsertRowid as number;
}

export function createTestViolationRecord(overrides: any = {}): number {
  const defaultViolation = {
    student_id: 'STU001',
    student_name: 'Test Student',
    violation_type: 'cancel_late',
    booking_code: overrides.booking_code || `B-V-${Date.now()}`,
    equipment_id: overrides.equipment_id || 1,
    status: 'valid',
    created_at: new Date().toISOString(),
    ...overrides
  };

  const stmt = db.prepare(`
    INSERT INTO violation_records (
      student_id, student_name, violation_type, booking_code, equipment_id, status, created_at
    ) VALUES (
      @student_id, @student_name, @violation_type, @booking_code, @equipment_id, @status, @created_at
    )
  `);
  const result = stmt.run(defaultViolation);
  return result.lastInsertRowid as number;
}
