import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { db } from '../src/db/index.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation } from '../src/modules/violation/evaluator.js';
import { resetTestDatabase } from './utils/db-helper.js';

// Use a fixed date: 2030-05-15 (May, 31 days)
const fixedNow = new Date('2030-05-15T10:00:00.000Z');

describe('Violation Evaluator (12_violation_evaluator.test.ts)', () => {
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

  const createRule = (overrides: any) => {
    const info = db.prepare(`
      INSERT INTO penalty_rules (name, violation_type, trigger_config, action_config, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      overrides.name || 'Test Rule',
      overrides.violation_type || 'late',
      JSON.stringify(overrides.trigger_config || { window_type: 'rolling', period_days: 30, metric: 'count', threshold: 3 }),
      JSON.stringify(overrides.action_config || { type: 'ban' }),
      overrides.is_active !== undefined ? overrides.is_active : 1
    );
    return info.lastInsertRowid;
  };

  const createViolation = (student_id: string, type: string, time: Date, res_id: number = 1, overrides: any = {}) => {
    const info = db.prepare(`
      INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      student_id, res_id, type, time.toISOString(), overrides.duration_minutes || 0, overrides.status || 'active'
    );
    return info.lastInsertRowid;
  };

  const insertThreeViolations = (studentId: string, type: string) => {
    createViolation(studentId, type, new Date(fixedNow.getTime() - 1000 * 60 * 60 * 48), 1);
    createViolation(studentId, type, new Date(fixedNow.getTime() - 1000 * 60 * 60 * 24), 2);
    createViolation(studentId, type, fixedNow, 3);
  };

  describe('3.2.1 Penalty Type Effects (Action Config Parsing)', () => {
    it('should correctly evaluate BAN penalty type', () => {
      createRule({ action_config: { type: 'ban' } });
      insertThreeViolations('STU_1', 'late');
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(true);
      expect(result.penaltyMethod).toBe('BAN');
    });

    it('should correctly evaluate REQUIRE_APPROVAL penalty type', () => {
      createRule({ action_config: { type: 'require_approval' } });
      insertThreeViolations('STU_2', 'late');
      const result = checkUserPenalty('STU_2');
      expect(result.isPenalized).toBe(true);
      expect(result.penaltyMethod).toBe('REQUIRE_APPROVAL');
    });

    it('should correctly evaluate reduce_advance_days penalty type', () => {
      createRule({ action_config: { type: 'reduce_advance_days', params: { reduce_days: 5, min_retain_days: 2 } } });
      insertThreeViolations('STU_3', 'late');
      const result = checkUserPenalty('STU_3');
      expect(result.isPenalized).toBe(true);
      expect(result.penaltyMethod).toBe('RESTRICTED');
      expect(result.restrictions.reduce_days).toBe(5);
      expect(result.restrictions.min_retain_days).toBe(2);
    });

    it('should correctly evaluate double_fee penalty type', () => {
      createRule({ action_config: { type: 'double_fee', params: { multiplier: 2.5 } } });
      insertThreeViolations('STU_4', 'late');
      const result = checkUserPenalty('STU_4');
      expect(result.isPenalized).toBe(true);
      expect(result.penaltyMethod).toBe('RESTRICTED');
      expect(result.restrictions.fee_multiplier).toBe(2.5);
    });

    it('should create fixed duration penalty via evaluatePenaltiesOnViolation', () => {
      createRule({ action_config: { type: 'ban', duration_type: 'fixed', duration_days: 14 } });
      insertThreeViolations('STU_5', 'late');
      
      // evaluatePenaltiesOnViolation writes to user_penalties for fixed duration rules
      evaluatePenaltiesOnViolation('STU_5');
      
      const penalties = db.prepare('SELECT * FROM user_penalties WHERE student_id = ?').all('STU_5') as any[];
      expect(penalties.length).toBe(1);
      expect(penalties[0].penalty_method).toBe('ban');
      
      const expectedEnd = new Date(fixedNow.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      expect(penalties[0].end_time).toBe(expectedEnd);
    });
  });

  describe('3.2.2 Metric & Threshold', () => {
    it('should not penalize when below threshold', () => {
      createRule({ trigger_config: { window_type: 'rolling', period_days: 30, metric: 'count', threshold: 3 } });
      createViolation('STU_1', 'late', fixedNow, 1);
      createViolation('STU_1', 'late', fixedNow, 2);
      // Only 2 violations, threshold is 3
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(false);
    });

    it('should deduplicate violations if count_strategy is by_reservation', () => {
      createRule({ trigger_config: { window_type: 'rolling', period_days: 30, metric: 'count', count_strategy: 'by_reservation', threshold: 3 } });
      
      // 3 violations on the SAME reservation
      createViolation('STU_1', 'late', fixedNow, 100);
      createViolation('STU_1', 'late', fixedNow, 100);
      createViolation('STU_1', 'late', fixedNow, 100);
      
      const result1 = checkUserPenalty('STU_1');
      expect(result1.isPenalized).toBe(false); // Counts as 1
      
      // Add 2 more on different reservations
      createViolation('STU_1', 'late', fixedNow, 101);
      createViolation('STU_1', 'late', fixedNow, 102);
      
      const result2 = checkUserPenalty('STU_1');
      expect(result2.isPenalized).toBe(true); // Total 3
    });
  });

  describe('3.2.3 Time Windows (Isolation)', () => {
    it('should isolate violations using natural_period (current_month)', () => {
      createRule({ trigger_config: { window_type: 'natural_period', period_type: 'month', metric: 'count', threshold: 3 } });
      
      // fixedNow is May 15.
      const aprilDate = new Date('2030-04-20T10:00:00Z');
      
      // 2 violations in April, 2 in May
      createViolation('STU_1', 'late', aprilDate, 1);
      createViolation('STU_1', 'late', aprilDate, 2);
      createViolation('STU_1', 'late', fixedNow, 3);
      createViolation('STU_1', 'late', fixedNow, 4);
      
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(false); // Only 2 in the current month (May)
    });

    it('should drop out violations outside rolling window', () => {
      createRule({ trigger_config: { window_type: 'rolling', period_days: 30, metric: 'count', threshold: 3 } });
      
      const oldDate = new Date(fixedNow.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      
      // 2 old violations, 1 new violation
      createViolation('STU_1', 'late', oldDate, 1);
      createViolation('STU_1', 'late', oldDate, 2);
      createViolation('STU_1', 'late', fixedNow, 3);
      
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(false); // Only 1 inside the 30-day window
    });
  });

  describe('3.2.4 Revocation, Waivers & Recovery', () => {
    it('should recover if a violation is revoked', () => {
      createRule({});
      const v1 = createViolation('STU_1', 'late', fixedNow, 1);
      const v2 = createViolation('STU_1', 'late', fixedNow, 2);
      const v3 = createViolation('STU_1', 'late', fixedNow, 3);
      
      expect(checkUserPenalty('STU_1').isPenalized).toBe(true);
      
      // Revoke v1
      db.prepare("UPDATE violation_records SET status = 'revoked' WHERE id = ?").run(v1);
      
      expect(checkUserPenalty('STU_1').isPenalized).toBe(false);
    });

    it('should ignore if the specific violation combination is waived', () => {
      const ruleId = createRule({});
      const v1 = createViolation('STU_1', 'late', fixedNow, 1);
      const v2 = createViolation('STU_1', 'late', fixedNow, 2);
      const v3 = createViolation('STU_1', 'late', fixedNow, 3);
      
      expect(checkUserPenalty('STU_1').isPenalized).toBe(true);
      
      // Insert waiver for exact combination
      const ids = [v1, v2, v3].sort((a, b) => a - b);
      const snapshot = `,${ids.join(',')},`;
      db.prepare(`INSERT INTO penalty_waivers (student_id, rule_id, violation_ids) VALUES (?, ?, ?)`).run('STU_1', ruleId, snapshot);
      
      expect(checkUserPenalty('STU_1').isPenalized).toBe(false);
    });

    it('should automatically recover from fixed penalties if end_time is in the past', () => {
      const ruleId = createRule({ action_config: { type: 'ban', duration_type: 'fixed', duration_days: 14 } });
      const pastStart = new Date(fixedNow.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(fixedNow.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(); // Ended 6 days ago
      
      db.prepare(`
        INSERT INTO user_penalties (student_id, rule_id, penalty_method, start_time, end_time, status)
        VALUES (?, ?, 'ban', ?, ?, 'active')
      `).run('STU_1', ruleId, pastStart, pastEnd);
      
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(false);
    });
  });

  describe('3.2.5 Restrictions Merge', () => {
    it('should resolve REQUIRE_APPROVAL and BAN to BAN (higher severity)', () => {
      createRule({ name: 'Rule 1', action_config: { type: 'require_approval' } });
      createRule({ name: 'Rule 2', action_config: { type: 'ban' } });
      
      insertThreeViolations('STU_1', 'late');
      
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(true);
      expect(result.penaltyMethod).toBe('BAN');
    });

    it('should merge parameterized restrictions logically (max/min)', () => {
      createRule({ name: 'Rule 1', action_config: { type: 'reduce_advance_days', params: { reduce_days: 3, min_retain_days: 5 } } });
      createRule({ name: 'Rule 2', action_config: { type: 'reduce_advance_days', params: { reduce_days: 7, min_retain_days: 2 } } });
      createRule({ name: 'Rule 3', action_config: { type: 'double_fee', params: { multiplier: 3.5 } } });
      createRule({ name: 'Rule 4', action_config: { type: 'double_fee', params: { multiplier: 2.0 } } });
      
      insertThreeViolations('STU_1', 'late');
      
      const result = checkUserPenalty('STU_1');
      expect(result.penaltyMethod).toBe('RESTRICTED');
      
      // reduce_days: Math.max(3, 7) = 7
      expect(result.restrictions.reduce_days).toBe(7);
      
      // min_retain_days: Math.min(5, 2) = 2
      expect(result.restrictions.min_retain_days).toBe(2);
      
      // fee_multiplier: Math.max(3.5, 2.0) = 3.5
      expect(result.restrictions.fee_multiplier).toBe(3.5);
    });
  });

  describe('3.2.6 Unban Time Prediction', () => {
    it('should correctly predict unban time for rolling window (count)', () => {
      createRule({ trigger_config: { window_type: 'rolling', period_days: 30, metric: 'count', threshold: 3 } });
      
      const v1Date = new Date(fixedNow.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      const v2Date = new Date(fixedNow.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const v3Date = fixedNow;
      
      createViolation('STU_1', 'late', v1Date, 1);
      createViolation('STU_1', 'late', v2Date, 2);
      createViolation('STU_1', 'late', v3Date, 3);
      
      const result = checkUserPenalty('STU_1');
      expect(result.isPenalized).toBe(true);
      
      // For rolling count, when the oldest violation drops out (v1Date + 30 days), count becomes 2 < 3.
      // v1Date + 30 days = 10 days from now.
      const expectedUnbanDate = new Date(v1Date.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const tzOffset = expectedUnbanDate.getTimezoneOffset() * 60000;
      const expectedStr = (new Date(expectedUnbanDate.getTime() - tzOffset)).toISOString().slice(0, 19).replace('T', ' ');
      
      expect(result.reason).toContain(`解封时间：${expectedStr}`);
    });
  });
});
