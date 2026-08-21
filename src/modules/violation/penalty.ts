import { db } from '../../db/index.js';
import { getNaturalPeriodStart, getNextNaturalPeriodStart } from './evaluator.js';

export function batchPenalties(rule_id: number, student_ids: string[]) {
  if (!rule_id || !student_ids || !Array.isArray(student_ids)) {
    throw new Error('Missing required parameters');
  }

  const rule = db.prepare('SELECT * FROM penalty_rules WHERE id = ?').get(rule_id) as any;
  if (!rule) {
    throw new Error('Rule not found');
  }
  
  const trigger = JSON.parse(rule.trigger_config);
  const action = JSON.parse(rule.action_config);
  
  if (action.duration_type === 'dynamic') {
    throw new Error('Cannot batch insert for dynamic duration rules');
  }

  const durationDays = action.duration_days || 0;
  const penaltyMethod = action.type;
  
  const now = new Date();
  const nowStr = now.toISOString();

  const insertTx = db.transaction((students: string[]) => {
    let count = 0;
    for (const student_id of students) {
      // Check if there is already an active penalty for this rule and student
      const existingPenalty = db.prepare(`
        SELECT id FROM user_penalties 
        WHERE student_id = ? AND rule_id = ? AND end_time > ? AND status = 'active'
      `).get(student_id, rule_id, nowStr);

      if (!existingPenalty) {
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + durationDays);

        const restrictionsData: any = {};
        if (action.params && action.params.cancel_future_reservations) {
          restrictionsData.cancel_future_reservations = true;
        }
        if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
          restrictionsData.restricted_equipment_ids = trigger.scope;
        }

        db.prepare(`
          INSERT INTO user_penalties (student_id, rule_id, penalty_method, restrictions, start_time, end_time)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(student_id, rule_id, penaltyMethod, JSON.stringify(restrictionsData), nowStr, endDate.toISOString());
        
        count++;

        // Cancel future reservations if configured
        if (action.params && action.params.cancel_future_reservations) {
          const futureReservations = db.prepare(`
            SELECT id, equipment_id FROM reservations 
            WHERE student_id = ? AND status = 'approved' AND start_time > ?
          `).all(student_id, nowStr) as any[];
          
          for (const rev of futureReservations) {
            if (trigger.scope && trigger.scope.length > 0) {
              if (!trigger.scope.includes(String(rev.equipment_id)) && !trigger.scope.includes(Number(rev.equipment_id))) {
                continue;
              }
            }
            db.prepare("UPDATE reservations SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(rev.id);
          }
        }
      }
    }
    return count;
  });

  return insertTx(student_ids);
}

export function waivePenalty(data: { penalty_id?: number, student_id: string, rule_id: number, contributing_violation_ids: string, is_dynamic: boolean }) {
  const { penalty_id, student_id, rule_id, contributing_violation_ids, is_dynamic } = data;
  
  if (!student_id || !rule_id || !contributing_violation_ids) {
    throw new Error('缺少必要的参数');
  }

  db.transaction(() => {
    let user_penalty_id = null;
    if (!is_dynamic && penalty_id) {
      user_penalty_id = penalty_id;
      db.prepare("UPDATE user_penalties SET status = 'waived' WHERE id = ?").run(penalty_id);
    }
    
    db.prepare(`
      INSERT INTO penalty_waivers (student_id, rule_id, violation_ids, user_penalty_id)
      VALUES (?, ?, ?, ?)
    `).run(student_id, rule_id, contributing_violation_ids, user_penalty_id);
  })();
}

export function getActivePenalties() {
  const now = new Date();
  const nowStr = now.toISOString();

  // 1. Get fixed penalties
  const fixedPenalties = db.prepare(`
    SELECT p.*, pr.name as rule_name, 
      (SELECT student_name FROM reservations r WHERE r.student_id = p.student_id ORDER BY id DESC LIMIT 1) as student_name,
      (SELECT supervisor FROM reservations r WHERE r.student_id = p.student_id ORDER BY id DESC LIMIT 1) as supervisor
    FROM user_penalties p
    LEFT JOIN penalty_rules pr ON p.rule_id = pr.id
    WHERE p.status = 'active' AND p.end_time > ?
    ORDER BY p.start_time DESC
  `).all(nowStr) as any[];

  // 2. Calculate dynamic penalties
  const dynamicPenalties: any[] = [];
  const activeRules = db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1').all() as any[];

  for (const rule of activeRules) {
    const trigger = JSON.parse(rule.trigger_config);
    const action = JSON.parse(rule.action_config);
    
    // Skip fixed duration rules as they are handled by user_penalties table
    if (action.duration_type === 'fixed' && action.duration_days) continue;

    let windowStartStr = '';
    if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
      windowStartStr = getNaturalPeriodStart(now, trigger.period_type || 'month').toISOString();
    } else {
      let windowStart = new Date(now);
      windowStart.setDate(windowStart.getDate() - (trigger.period_days || 30));
      windowStartStr = windowStart.toISOString();
    }

    const violationTypes = trigger.violation_types || [trigger.violation_type || rule.violation_type];
    const typePlaceholders = violationTypes.map(() => '?').join(',');

    let scopeCondition = '';
    let queryParams: any[] = [...violationTypes, windowStartStr];

    if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
      const placeholders = trigger.scope.map(() => '?').join(',');
      scopeCondition = `AND reservation_id IN (SELECT id FROM reservations WHERE equipment_id IN (${placeholders}))`;
      queryParams.push(...trigger.scope);
    }
    
    queryParams.push(trigger.threshold);

    let query = '';
    if (trigger.metric === 'count') {
      if (trigger.count_strategy === 'by_reservation') {
        query = `
          SELECT student_id, COUNT(DISTINCT reservation_id) as metric_value, GROUP_CONCAT(id) as contributing_ids 
          FROM violation_records 
          WHERE status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ? ${scopeCondition} 
          GROUP BY student_id 
          HAVING metric_value >= ?
        `;
      } else {
        query = `
          SELECT student_id, COUNT(id) as metric_value, GROUP_CONCAT(id) as contributing_ids 
          FROM violation_records 
          WHERE status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ? ${scopeCondition} 
          GROUP BY student_id 
          HAVING metric_value >= ?
        `;
      }
    } else if (trigger.metric === 'duration') {
      query = `
        SELECT student_id, SUM(duration_minutes) as metric_value, GROUP_CONCAT(id) as contributing_ids 
        FROM violation_records 
        WHERE status = 'active' AND violation_type IN (${typePlaceholders}) AND violation_time >= ? ${scopeCondition} 
        GROUP BY student_id 
        HAVING metric_value >= ?
      `;
    }

    const affectedUsers = db.prepare(query).all(...queryParams) as any[];

    for (const user of affectedUsers) {
      const ids = user.contributing_ids.split(',').filter(Boolean).map(Number);
      const sortedIds = [...ids].sort((a, b) => a - b);
      const snapshot = `,${sortedIds.join(',')},`;
      
      const isWaived = db.prepare('SELECT id FROM penalty_waivers WHERE student_id = ? AND rule_id = ? AND violation_ids = ?').get(user.student_id, rule.id, snapshot);
      if (isWaived) {
        continue;
      }

      const records = db.prepare(`
        SELECT violation_time, duration_minutes 
        FROM violation_records 
        WHERE id IN (${ids.map(()=>'?').join(',')}) 
        ORDER BY violation_time ASC
      `).all(...ids) as any[];

      let unbanTime: Date | null = null;
      let currentMetric = user.metric_value;

      for (const rec of records) {
        if (trigger.metric === 'count') {
          currentMetric -= 1;
        } else {
          currentMetric -= (rec.duration_minutes || 0);
        }

        if (currentMetric < trigger.threshold) {
          if (trigger.window_type === 'natural_period' || trigger.window_type === 'current_month') {
            unbanTime = getNextNaturalPeriodStart(now, trigger.period_type || 'month');
          } else {
            const vTime = new Date(rec.violation_time);
            vTime.setDate(vTime.getDate() + (trigger.period_days || 30));
            unbanTime = vTime;
          }
          break;
        }
      }

      const studentInfoRow = db.prepare('SELECT student_name, supervisor FROM reservations WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(user.student_id) as any;

      dynamicPenalties.push({
        id: `dynamic_${rule.id}_${user.student_id}`,
        student_id: user.student_id,
        student_name: studentInfoRow ? studentInfoRow.student_name : user.student_id,
        supervisor: studentInfoRow ? studentInfoRow.supervisor : null,
        rule_name: rule.name,
        penalty_method: action.type,
        start_time: records[records.length - 1].violation_time,
        end_time: unbanTime ? unbanTime.toISOString() : null,
        status: 'active',
        is_dynamic: true,
        contributing_violation_ids: snapshot,
        rule_id: rule.id
      });
    }
  }

  const allPenalties = [...fixedPenalties, ...dynamicPenalties].sort((a, b) => {
    return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
  });

  return allPenalties;
}
