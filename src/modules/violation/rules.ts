import { db } from '../../db/index.js';

export function getPublicRules() {
  return db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1 ORDER BY id DESC').all();
}

export function getAdminRules() {
  return db.prepare('SELECT * FROM penalty_rules ORDER BY id DESC').all();
}

export function createRule(data: any) {
  const { name, description, violation_type, trigger_config, action_config, is_active } = data;
  const stmt = db.prepare(`
    INSERT INTO penalty_rules (name, description, violation_type, trigger_config, action_config, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const info = stmt.run(name, description, violation_type, JSON.stringify(trigger_config), JSON.stringify(action_config), is_active ? 1 : 0);
  return { id: info.lastInsertRowid };
}

export function updateRule(id: string | number, data: any) {
  const { name, description, violation_type, trigger_config, action_config, is_active } = data;
  const stmt = db.prepare(`
    UPDATE penalty_rules 
    SET name = ?, description = ?, violation_type = ?, trigger_config = ?, action_config = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(name, description, violation_type, JSON.stringify(trigger_config), JSON.stringify(action_config), is_active ? 1 : 0, id);
  return { success: true };
}

export function deleteRule(id: string | number) {
  const stmt = db.prepare('DELETE FROM penalty_rules WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

export function simulateRule(trigger: any, action: any, start_date: string, end_date: string) {
  if (!trigger || typeof trigger !== 'object') {
    throw new Error('Missing required parameters');
  }
  if (typeof start_date !== 'string' || typeof end_date !== 'string' || !start_date || !end_date) {
    throw new Error('Missing required parameters');
  }

  const violationTypes = trigger.violation_types || [trigger.violation_type];
  if (!violationTypes || violationTypes.length === 0) {
     return [];
  }
  
  const typePlaceholders = violationTypes.map(() => '?').join(',');
  
  let scopeCondition = '';
  // Append T23:59:59.999Z to end_date to include the whole day if it's a date string like '2023-10-15'
  const finalEndDate = end_date.includes('T') ? end_date : end_date + 'T23:59:59.999Z';
  const queryParams: any[] = [...violationTypes, start_date, finalEndDate];

  if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
    const placeholders = trigger.scope.map(() => '?').join(',');
    scopeCondition = `AND reservation_id IN (SELECT id FROM reservations WHERE equipment_id IN (${placeholders}))`;
    queryParams.push(...trigger.scope);
  }

  // Get all active violations in the time range matching types and scope
  const violationsQuery = `
    SELECT id, student_id, reservation_id, violation_type, duration_minutes, violation_time 
    FROM violation_records 
    WHERE status = 'active' 
      AND violation_type IN (${typePlaceholders}) 
      AND violation_time >= ? 
      AND violation_time <= ?
      ${scopeCondition}
  `;
  const allViolations = db.prepare(violationsQuery).all(...queryParams) as any[];

  // Group by student_id
  const studentViolations = new Map<string, any[]>();
  for (const v of allViolations) {
     if (!studentViolations.has(v.student_id)) {
       studentViolations.set(v.student_id, []);
     }
     studentViolations.get(v.student_id)!.push(v);
  }

  const results = [];
  
  for (const [student_id, violations] of studentViolations.entries()) {
    let metricValue = 0;
    let contributingIds: number[] = [];
    
    if (trigger.metric === 'count') {
      if (trigger.count_strategy === 'by_reservation') {
        const uniqueReservations = new Map<number, number>(); // res_id -> violation_id
        for (const v of violations) {
          if (!uniqueReservations.has(v.reservation_id) || v.id < uniqueReservations.get(v.reservation_id)!) {
            uniqueReservations.set(v.reservation_id, v.id);
          }
        }
        metricValue = uniqueReservations.size;
        contributingIds = Array.from(uniqueReservations.values());
      } else {
        metricValue = violations.length;
        contributingIds = violations.map(v => v.id);
      }
    } else if (trigger.metric === 'duration') {
      metricValue = violations.reduce((sum, v) => sum + (v.duration_minutes || 0), 0);
      contributingIds = violations.map(v => v.id);
    }
    
    if (metricValue >= trigger.threshold) {
       // Lookup student name for UI
       const latestRes = db.prepare('SELECT student_name FROM reservations WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(student_id) as any;
       
       results.push({
         student_id,
         student_name: latestRes ? latestRes.student_name : student_id,
         metric_value: metricValue,
         contributing_ids: contributingIds,
         violations: violations.filter(v => contributingIds.includes(v.id)).map(v => ({
           ...v,
           equipment_name: (db.prepare('SELECT e.name as equipment_name FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?').get(v.reservation_id) as any)?.equipment_name
         }))
       });
    }
  }

  return results;
}

const typeTranslationMap: Record<string, string> = {
  late: '迟到',
  overdue: '超时',
  'no-show': '爽约',
  'late-cancel': '临期取消',
  'late_cancel': '临期取消',
  hygiene_issue: '卫生不达标',
  improper_operation: '违规操作',
  proxy_booking: '代预约',
  other_manual: '其他违规'
};

export function formatRuleName(ruleName: string, triggerConfigStr?: string, defaultViolationType?: string) {
  try {
    let violationTypes: string[] = [];
    if (triggerConfigStr) {
      const tg = JSON.parse(triggerConfigStr);
      if (tg.violation_types && tg.violation_types.length > 0) {
        violationTypes = tg.violation_types;
      } else if (tg.violation_type) {
        violationTypes = [tg.violation_type];
      }
    }
    
    if (violationTypes.length === 0 && defaultViolationType && defaultViolationType !== 'combo') {
      violationTypes = [defaultViolationType];
    }
    
    if (violationTypes.length > 0) {
      const translated = violationTypes.map(t => typeTranslationMap[t] || t).join(' 或 ');
      return `${ruleName}（包含：${translated}）`;
    }
  } catch (e) {
    // Parsing error or empty, fallback to original
  }
  return ruleName;
}
