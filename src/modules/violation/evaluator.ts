import { db } from '../../db/index.js';
import { notifyEvent } from '../notification/service.js';
import { formatRuleName } from './rules.js';

export function getNaturalPeriodStart(now: Date, periodType: string): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  
  switch (periodType) {
    case 'month':
      return new Date(year, month, 1);
    case 'quarter':
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return new Date(year, quarterStartMonth, 1);
    case 'year':
      return new Date(year, 0, 1);
    case 'semester':
      if (month >= 8) return new Date(year, 8, 1);
      if (month >= 1) return new Date(year, 1, 1);
      return new Date(year - 1, 8, 1);
    case 'academic_year':
      if (month >= 8) return new Date(year, 8, 1);
      return new Date(year - 1, 8, 1);
    default:
      return new Date(year, month, 1);
  }
}

export function getNextNaturalPeriodStart(now: Date, periodType: string): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  
  switch (periodType) {
    case 'month':
      return new Date(year, month + 1, 1);
    case 'quarter':
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return new Date(year, quarterStartMonth + 3, 1);
    case 'year':
      return new Date(year + 1, 0, 1);
    case 'semester':
      if (month >= 8) return new Date(year + 1, 1, 1); 
      if (month >= 1) return new Date(year, 8, 1);     
      return new Date(year, 1, 1);                     
    case 'week':
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(year, month, diff);
      return new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(year, month + 1, 1);
  }
}
export function evaluatePenaltiesOnViolation(student_id: string) {
  const activeRules = db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1').all() as any[];
  const now = new Date();
  const nowStr = now.toISOString();

  for (const rule of activeRules) {
    const trigger = JSON.parse(rule.trigger_config);
    const action = JSON.parse(rule.action_config);
    
    let windowStartStr = '';
    if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
      windowStartStr = getNaturalPeriodStart(now, trigger.period_type || 'month').toISOString();
    } else {
      let windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - (trigger.period_days || 30));
      windowStartStr = windowStart.toISOString();
    }

    const violationTypes = trigger.violation_types || [trigger.violation_type || rule.violation_type];
    const typePlaceholders = violationTypes.map(() => '?').join(',');

    let scopeCondition = '';
    let queryParams: any[] = [student_id, ...violationTypes, windowStartStr];

    if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
      const placeholders = trigger.scope.map(() => '?').join(',');
      scopeCondition = `AND reservation_id IN (SELECT id FROM reservations WHERE equipment_id IN (${placeholders}))`;
      queryParams.push(...trigger.scope);
    }

    let metricValue = 0;
    let contributingIds: number[] = [];
    if (trigger.metric === 'count') {
      if (trigger.count_strategy === 'by_reservation') {
        const violations = db.prepare(`
          SELECT reservation_id, MIN(id) as id FROM violation_records 
          WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
          ${scopeCondition}
          GROUP BY reservation_id
        `).all(...queryParams) as any[];
        metricValue = violations.length;
        contributingIds = violations.map(v => v.id);
      } else {
        const violations = db.prepare(`
          SELECT id FROM violation_records 
          WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
          ${scopeCondition}
        `).all(...queryParams) as any[];
        metricValue = violations.length;
        contributingIds = violations.map(v => v.id);
      }
    } else if (trigger.metric === 'duration') {
      const violations = db.prepare(`
        SELECT id, duration_minutes FROM violation_records 
        WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
        ${scopeCondition}
      `).all(...queryParams) as any[];
      metricValue = violations.reduce((sum, v) => sum + (v.duration_minutes || 0), 0);
      contributingIds = violations.map(v => v.id);
    }

    if (metricValue >= trigger.threshold) {
      // Check if this specific combination of violations has been waived
      const sortedIds = [...contributingIds].sort((a, b) => a - b);
      const snapshot = `,${sortedIds.join(',')},`;
      const isWaived = db.prepare('SELECT id FROM penalty_waivers WHERE student_id = ? AND rule_id = ? AND violation_ids = ?').get(student_id, rule.id, snapshot);

      if (isWaived) {
        continue;
      }

      // 1. If it's a fixed duration rule, insert into user_penalties
      if (action.duration_type === 'fixed' && action.duration_days) {
        const existingPenalty = db.prepare(`
          SELECT id FROM user_penalties 
          WHERE student_id = ? AND rule_id = ? AND end_time > ? AND status = 'active'
        `).get(student_id, rule.id, nowStr);

        if (!existingPenalty) {
          const endDate = new Date(now);
          endDate.setDate(endDate.getDate() + action.duration_days);
          
          let penaltyMethod = action.type;

          const restrictionsData = { ...(action.params || {}) };
          if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
            restrictionsData.restricted_equipment_ids = trigger.scope;
          }

          const idsStr = `,${contributingIds.join(',')},`;
          const info = db.prepare(`
            INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time, contributing_violation_ids)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(student_id, rule.id, penaltyMethod, JSON.stringify(restrictionsData), nowStr, endDate.toISOString(), idsStr);

          const userEmailRow = db.prepare('SELECT email FROM reservations WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(student_id) as any;
          const email = userEmailRow?.email;

          notifyEvent(db, 'penalty_triggered', {
            penalty_id: info.lastInsertRowid,
            student_id,
            rule_name: rule.name,
            reason: '违反规则：' + rule.name,
            penalty_method: penaltyMethod,
            start_time: nowStr,
            end_time: endDate.toISOString()
          }, email);
        }
      }

      // 2. Cancellation logic (for both fixed and dynamic rules)
      if (action.type === 'ban' && action.params?.cancel_future_reservations) {
        if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
          const placeholders = trigger.scope.map(() => '?').join(',');
          db.prepare(`UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND status IN ('pending', 'approved') AND start_time > ? AND equipment_id IN (${placeholders})`).run(student_id, nowStr, ...trigger.scope);
        } else {
          db.prepare(`UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND status IN ('pending', 'approved') AND start_time > ?`).run(student_id, nowStr);
        }
      }
    }
  }
}
export function checkUserPenalty(student_id: string, target_equipment_id?: number) {
  const activeRules = db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1').all() as any[];
  const nowStr = new Date().toISOString();
  
  let isPenalized = false;
  let penaltyMethod = 'NONE';
  let reason = '';
  let restrictions = {
    reduce_days: 0,
    min_retain_days: 999,
    fee_multiplier: 1.0
  };
  
  const triggeredRules: string[] = [];
  const triggeredViolationIds: number[] = [];
  const triggeredRulesDetails: { rule_id: number, rule_name: string, contributing_ids: number[], violation_types: string[], penalty_method: string, duration_days: number, params: any }[] = [];
  let maxUnbanTime: Date | null = null;

  // 1. Check fixed duration penalties
  const fixedPenalties = db.prepare(`
    SELECT p.*, r.name as rule_name, r.trigger_config, r.violation_type, r.action_config FROM user_penalties p
    JOIN penalty_rules r ON p.rule_id = r.id
    WHERE p.student_id = ? AND p.end_time > ? AND p.status = 'active'
  `).all(student_id, nowStr) as any[];

  for (const p of fixedPenalties) {
    const params = JSON.parse(p.restrictions || '{}');
    
    if (target_equipment_id && params.restricted_equipment_ids && Array.isArray(params.restricted_equipment_ids) && params.restricted_equipment_ids.length > 0) {
      if (!params.restricted_equipment_ids.some((id: any) => String(id) === String(target_equipment_id))) {
        continue;
      }
    }

    isPenalized = true;
    const formattedRuleName = formatRuleName(p.rule_name, p.trigger_config, p.violation_type);
    if (!triggeredRules.includes(formattedRuleName)) triggeredRules.push(formattedRuleName);
    
    let cIds: number[] = [];
    if (p.contributing_violation_ids) {
      cIds = p.contributing_violation_ids.split(',').filter(Boolean).map(Number);
      cIds.forEach((id: number) => {
        if (!triggeredViolationIds.includes(id)) triggeredViolationIds.push(id);
      });
    }
    
    let rawViolationTypes: string[] = [];
    try {
      if (p.trigger_config) {
        const tg = JSON.parse(p.trigger_config);
        rawViolationTypes = tg.violation_types || [tg.violation_type || p.violation_type];
      } else {
        rawViolationTypes = [p.violation_type];
      }
    } catch(e) {}
    
    let durationDays = 0;
    try {
      if (p.action_config) {
        const ac = JSON.parse(p.action_config);
        durationDays = ac.duration_days || 0;
      }
    } catch(e) {}

    triggeredRulesDetails.push({ 
      rule_id: p.rule_id, 
      rule_name: formattedRuleName, 
      contributing_ids: cIds,
      violation_types: rawViolationTypes,
      penalty_method: p.penalty_method,
      duration_days: durationDays,
      params: params
    });
    
    let methodLevel = p.penalty_method;
    if (p.penalty_method === 'ban' || p.penalty_method === 'BAN') methodLevel = 'BAN';
    else if (p.penalty_method === 'require_approval' || p.penalty_method === 'REQUIRE_APPROVAL') methodLevel = 'REQUIRE_APPROVAL';
    else methodLevel = 'RESTRICTED';

    if (methodLevel === 'BAN') {
      penaltyMethod = 'BAN';
    } else if (methodLevel === 'REQUIRE_APPROVAL' && penaltyMethod !== 'BAN') {
      penaltyMethod = 'REQUIRE_APPROVAL';
    } else if (methodLevel === 'RESTRICTED' && penaltyMethod === 'NONE') {
      penaltyMethod = 'RESTRICTED';
    }

    if (params.reduce_days) restrictions.reduce_days = Math.max(restrictions.reduce_days, params.reduce_days);
    if (params.min_retain_days !== undefined) restrictions.min_retain_days = Math.min(restrictions.min_retain_days, params.min_retain_days);
    if (params.multiplier) restrictions.fee_multiplier = Math.max(restrictions.fee_multiplier, params.multiplier);

    const endTime = new Date(p.end_time);
    if (!maxUnbanTime || endTime > maxUnbanTime) {
      maxUnbanTime = endTime;
    }
  }

  // 2. Check dynamic penalties
  for (const rule of activeRules) {
    const trigger = JSON.parse(rule.trigger_config);
    const action = JSON.parse(rule.action_config);
    
    if (action.duration_type === 'fixed' && action.duration_days) continue; // Skip rules that are handled by fixed penalties
    
    if (target_equipment_id && trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
      if (!trigger.scope.some((id: any) => String(id) === String(target_equipment_id))) {
        continue;
      }
    }

    let windowStartStr = '';
    if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
      const now = new Date();
      windowStartStr = getNaturalPeriodStart(now, trigger.period_type || 'month').toISOString();
    } else {
      let windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - (trigger.period_days || 30));
      windowStartStr = windowStart.toISOString();
    }

    const violationTypes = trigger.violation_types || [trigger.violation_type || rule.violation_type];
    const typePlaceholders = violationTypes.map(() => '?').join(',');

    let scopeCondition = '';
    let queryParams: any[] = [student_id, ...violationTypes, windowStartStr];

    if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
      const placeholders = trigger.scope.map(() => '?').join(',');
      scopeCondition = `AND reservation_id IN (SELECT id FROM reservations WHERE equipment_id IN (${placeholders}))`;
      queryParams.push(...trigger.scope);
    }

    let metricValue = 0;
    let currentViolationIds: number[] = [];
    
    if (trigger.metric === 'count') {
      if (trigger.count_strategy === 'by_reservation') {
        const records = db.prepare(`
          SELECT reservation_id, MIN(id) as id FROM violation_records 
          WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
          ${scopeCondition}
          GROUP BY reservation_id
        `).all(...queryParams) as any[];
        metricValue = records.length;
        currentViolationIds = records.map(r => r.id);
      } else {
        const records = db.prepare(`
          SELECT id FROM violation_records 
          WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
          ${scopeCondition}
        `).all(...queryParams) as any[];
        metricValue = records.length;
        currentViolationIds = records.map(r => r.id);
      }
    } else if (trigger.metric === 'duration') {
      const records = db.prepare(`
        SELECT id, duration_minutes FROM violation_records 
        WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
        ${scopeCondition}
      `).all(...queryParams) as any[];
      metricValue = records.reduce((sum, r) => sum + (r.duration_minutes || 0), 0);
      currentViolationIds = records.map(r => r.id);
    }

    if (metricValue >= trigger.threshold) {
      // Check if this specific combination of violations has been waived
      const sortedIds = [...currentViolationIds].sort((a, b) => a - b);
      const snapshot = `,${sortedIds.join(',')},`;
      const isWaived = db.prepare('SELECT id FROM penalty_waivers WHERE student_id = ? AND rule_id = ? AND violation_ids = ?').get(student_id, rule.id, snapshot);

      if (isWaived) {
        continue;
      }

      isPenalized = true;
      const formattedRuleName = formatRuleName(rule.name, rule.trigger_config, rule.violation_type);
      if (!triggeredRules.includes(formattedRuleName)) triggeredRules.push(formattedRuleName);
      currentViolationIds.forEach(id => {
        if (!triggeredViolationIds.includes(id)) triggeredViolationIds.push(id);
      });
      triggeredRulesDetails.push({ 
        rule_id: rule.id, 
        rule_name: formattedRuleName, 
        contributing_ids: currentViolationIds,
        violation_types: violationTypes,
        penalty_method: action.type,
        duration_days: action.duration_days || 0,
        params: action.params || {}
      });
      
      let ruleUnbanTime: Date | null = null;
      if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
        const now = new Date();
        const periodType = trigger.period_type || 'month';
        let nextPeriodStart = new Date(now);
        if (periodType === 'month') {
          nextPeriodStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else if (periodType === 'week') {
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1) + 7;
          nextPeriodStart = new Date(now.setDate(diff));
          nextPeriodStart.setHours(0, 0, 0, 0);
        } else if (periodType === 'year') {
          nextPeriodStart = new Date(now.getFullYear() + 1, 0, 1);
        } else if (periodType === 'semester' || periodType === 'academic_year') {
          nextPeriodStart = new Date(now.getFullYear(), now.getMonth() + 6, 1);
        }
        ruleUnbanTime = nextPeriodStart;
      } else {
        let violations = [];
        if (trigger.count_strategy === 'by_reservation') {
          violations = db.prepare(`
            SELECT MIN(violation_time) as violation_time, SUM(duration_minutes) as duration_minutes FROM violation_records 
            WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
            ${scopeCondition}
            GROUP BY reservation_id
            ORDER BY violation_time ASC
          `).all(...queryParams) as any[];
        } else {
          violations = db.prepare(`
            SELECT violation_time, duration_minutes FROM violation_records 
            WHERE student_id = ? AND status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ?
            ${scopeCondition}
            ORDER BY violation_time ASC
          `).all(...queryParams) as any[];
        }

        if (trigger.metric === 'count') {
          const dropIndex = metricValue - trigger.threshold;
          if (dropIndex >= 0 && dropIndex < violations.length) {
            const dropViolationTime = new Date(violations[dropIndex].violation_time);
            dropViolationTime.setDate(dropViolationTime.getDate() + (trigger.period_days || 30));
            ruleUnbanTime = dropViolationTime;
          }
        } else if (trigger.metric === 'duration') {
          let currentSum = metricValue;
          for (let i = 0; i < violations.length; i++) {
            currentSum -= (violations[i].duration_minutes || 0);
            if (currentSum < trigger.threshold) {
              const dropViolationTime = new Date(violations[i].violation_time);
              dropViolationTime.setDate(dropViolationTime.getDate() + (trigger.period_days || 30));
              ruleUnbanTime = dropViolationTime;
              break;
            }
          }
        }
      }

      if (ruleUnbanTime && (!maxUnbanTime || ruleUnbanTime > maxUnbanTime)) {
        maxUnbanTime = ruleUnbanTime;
      }

      if (action.type === 'ban') {
        penaltyMethod = 'BAN';
      } else if (action.type === 'require_approval' && penaltyMethod !== 'BAN') {
        penaltyMethod = 'REQUIRE_APPROVAL';
      } else if (action.type === 'reduce_advance_days') {
        if (penaltyMethod === 'NONE') penaltyMethod = 'RESTRICTED';
        restrictions.reduce_days = Math.max(restrictions.reduce_days, action.params.reduce_days || 0);
        restrictions.min_retain_days = Math.min(restrictions.min_retain_days, action.params.min_retain_days ?? 999);
      } else if (action.type === 'double_fee') {
        if (penaltyMethod === 'NONE') penaltyMethod = 'RESTRICTED';
        restrictions.fee_multiplier = Math.max(restrictions.fee_multiplier, action.params.multiplier || 1.0);
      }
    }
  }

  if (isPenalized) {
    let unbanStr = '';
    if (maxUnbanTime) {
      const tzOffset = maxUnbanTime.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(maxUnbanTime.getTime() - tzOffset)).toISOString().slice(0, 19).replace('T', ' ');
      unbanStr = `解封时间：${localISOTime}`;
    } else {
      unbanStr = `解封时间：未知`;
    }

    if (penaltyMethod === 'BAN') {
      reason = `因触发【${triggeredRules.join('、')}】规则，目前已被限制使用该仪器。${unbanStr}`;
    } else if (penaltyMethod === 'REQUIRE_APPROVAL') {
      reason = `因触发【${triggeredRules.join('、')}】规则，您的预约需要管理员审批。${unbanStr}`;
    } else {
      reason = `因触发【${triggeredRules.join('、')}】规则，您的预约权限受到限制。${unbanStr}`;
    }
  }

  let violationRecords: any[] = [];
  let structuredPenalty: any = null;

  if (isPenalized) {
    if (triggeredViolationIds.length > 0) {
      const placeholders = triggeredViolationIds.map(() => '?').join(',');
      violationRecords = db.prepare(`
        SELECT v.id, v.student_id, v.reservation_id, v.violation_type, v.violation_time, v.duration_minutes, v.status, v.remark, e.name as equipment_name, r.booking_code 
        FROM violation_records v
        LEFT JOIN reservations r ON v.reservation_id = r.id
        LEFT JOIN equipment e ON r.equipment_id = e.id
        WHERE v.id IN (${placeholders})
        ORDER BY v.violation_time DESC
      `).all(...triggeredViolationIds) as any[];
    }
    
    let studentName = student_id;

    structuredPenalty = {
      student_id,
      student_name: studentName,
      unban_time: maxUnbanTime ? maxUnbanTime.toISOString() : null,
      penalty_method: penaltyMethod,
      triggered_rules: triggeredRulesDetails,
      violation_records: violationRecords || [],
      restrictions: restrictions
    };
  }

  return { 
    isPenalized, 
    penaltyMethod, 
    reason, 
    restrictions, 
    violation_ids: triggeredViolationIds, 
    triggered_rules_details: triggeredRulesDetails,
    structured_penalty: structuredPenalty
  };
}

