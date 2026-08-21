import { db } from '../../db/index.js';

export function getViolationStats(startDate?: string, endDate?: string, dimension: "user" | "supervisor" | "equipment" = "user") {
  let query = `
    SELECT v.*, r.student_name, r.supervisor, r.equipment_id, e.name as equipment_name
    FROM violation_records v
    LEFT JOIN reservations r ON v.reservation_id = r.id
    LEFT JOIN equipment e ON r.equipment_id = e.id
    WHERE v.status = 'active'
  `;
  const params: any[] = [];

  let resQuery = `
    SELECT r.student_id, r.student_name, r.supervisor, r.equipment_id, e.name as equipment_name, COUNT(1) as total_reservations,
    SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as normal_cancelled_count
    FROM reservations r
    LEFT JOIN equipment e ON r.equipment_id = e.id
    WHERE 1=1
  `;
  const resParams: any[] = [];

  if (startDate) {
    query += ` AND v.violation_time >= ?`;
    params.push(`${startDate}T00:00:00.000Z`);
    resQuery += ` AND r.start_time >= ?`;
    resParams.push(`${startDate}T00:00:00.000Z`);
  }
  if (endDate) {
    query += ` AND v.violation_time <= ?`;
    params.push(`${endDate}T23:59:59.999Z`);
    resQuery += ` AND r.start_time <= ?`;
    resParams.push(`${endDate}T23:59:59.999Z`);
  }

  // Reservation basis grouping
  if (dimension === 'user') {
    resQuery += ` GROUP BY r.student_id`;
  } else if (dimension === 'supervisor') {
    resQuery += ` GROUP BY r.supervisor`;
  } else if (dimension === 'equipment') {
    resQuery += ` GROUP BY r.equipment_id`;
  }

  const violationsRaw = db.prepare(query).all(...params) as any[];
  const reservationsBasis = db.prepare(resQuery).all(...resParams) as any[];
  
  const nowStr = new Date().toISOString();
  const activePenaltiesRaw = db.prepare(`SELECT student_id, penalty_method FROM user_penalties WHERE status = 'active' AND end_time > ?`).all(nowStr) as any[];
  const penaltyMap = new Map();
  for (const p of activePenaltiesRaw) {
    penaltyMap.set(p.student_id, p.penalty_method);
  }

  const resBasisMap = new Map();
  for (const rb of reservationsBasis) {
    if (dimension === 'user') resBasisMap.set(rb.student_id || 'unknown', { total: rb.total_reservations, cancelled: rb.normal_cancelled_count });
    else if (dimension === 'supervisor') resBasisMap.set(rb.supervisor || '未知', { total: rb.total_reservations, cancelled: rb.normal_cancelled_count });
    else if (dimension === 'equipment') resBasisMap.set(String(rb.equipment_id) || 'unknown', { total: rb.total_reservations, cancelled: rb.normal_cancelled_count });
  }

  const statsMap = new Map();
  violationsRaw.forEach((v: any) => {
    let key = '';
    let name = '';
    
    if (dimension === 'user') {
      key = `${v.student_id}`;
      name = v.student_name || '未知';
    } else if (dimension === 'supervisor') {
      key = v.supervisor || '未知';
      name = v.supervisor || '未知';
    } else if (dimension === 'equipment') {
      key = String(v.equipment_id) || 'unknown';
      name = v.equipment_name || `设备 ${v.equipment_id}`;
    }

    if (!statsMap.has(key)) {
      statsMap.set(key, {
        key,
        name,
        supervisor: dimension === 'user' ? (v.supervisor || '未知') : null,
        late_count: 0,
        total_late_minutes: 0,
        overtime_count: 0,
        total_overtime_minutes: 0,
        noshow_count: 0,
        late_cancelled_count: 0,
        hygiene_issue: 0,
        improper_operation: 0,
        proxy_booking: 0,
        other_manual: 0,
        sub_items: {} // To store counts for inner aggregation (e.g., top equipment / top student)
      });
    }
    
    const p = statsMap.get(key);
    
    // Update name if better name available
    if (dimension === 'user' && p.name === '未知' && v.student_name) p.name = v.student_name;

    // Track sub-items
    if (dimension === 'user' && v.equipment_name) {
      p.sub_items[v.equipment_name] = (p.sub_items[v.equipment_name] || 0) + 1;
    } else if (dimension === 'supervisor' && v.student_name) {
      p.sub_items[v.student_name] = (p.sub_items[v.student_name] || 0) + 1;
    } else if (dimension === 'equipment' && v.student_name) {
      p.sub_items[v.student_name] = (p.sub_items[v.student_name] || 0) + 1;
    }
    
    const minutes = v.duration_minutes || 0;
    if (v.violation_type === 'late') { p.late_count++; p.total_late_minutes += minutes; }
    else if (v.violation_type === 'overdue') { p.overtime_count++; p.total_overtime_minutes += minutes; }
    else if (v.violation_type === 'no-show') p.noshow_count++;
    else if (v.violation_type === 'late_cancel') p.late_cancelled_count++;
    else if (v.violation_type === 'hygiene_issue') p.hygiene_issue++;
    else if (v.violation_type === 'improper_operation') p.improper_operation++;
    else if (v.violation_type === 'proxy_booking') p.proxy_booking++;
    else p.other_manual++;
  });

  const violations = Array.from(statsMap.values()).map(p => {
    // Determine top sub-item
    let top_sub_item = '';
    let sub_items_list: {name: string, count: number}[] = [];
    if (Object.keys(p.sub_items).length > 0) {
      sub_items_list = Object.entries(p.sub_items).sort((a: any, b: any) => b[1] - a[1]).map(entry => ({ name: entry[0], count: entry[1] as number }));
      top_sub_item = `${sub_items_list[0].name} (${sub_items_list[0].count}次)`;
    }

    delete p.sub_items; // remove helper

    const penaltyScore = p.late_count + p.overtime_count + p.noshow_count;
    const totalViolations = penaltyScore + p.late_cancelled_count + p.hygiene_issue + p.improper_operation + p.proxy_booking + p.other_manual;
    
    const basis = resBasisMap.get(p.key) || { total: 0, cancelled: 0 };
    const totalReservations = basis.total;
    const normalCancelledCount = Math.max(0, basis.cancelled - p.late_cancelled_count);
    const violationRate = totalReservations > 0 ? (totalViolations / totalReservations) : 0;

    let activePenaltyMethod = null;
    if (dimension === 'user' && penaltyMap.has(p.key)) {
      activePenaltyMethod = penaltyMap.get(p.key);
    }

    return {
      ...p,
      active_penalty: activePenaltyMethod,
      top_sub_item,
      sub_items_list,
      total_reservations: totalReservations,
      normal_cancelled_count: normalCancelledCount,
      violation_rate: violationRate,
      total_violations: totalViolations
    };
  }).sort((a, b) => b.total_violations - a.total_violations || b.violation_rate - a.violation_rate);

  return violations;
}

export function getViolationParams() {
  const keys = ['violation_late_grace_minutes', 'violation_overtime_grace_minutes', 'violation_late_cancel_minutes', 'violation_no_show_grace_minutes'];
  const settingsRows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys) as any[];
  const settingsMap = settingsRows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});

  return {
    late_grace_minutes: settingsMap['violation_late_grace_minutes'] ? parseInt(settingsMap['violation_late_grace_minutes'], 10) : 15,
    overtime_grace_minutes: settingsMap['violation_overtime_grace_minutes'] ? parseInt(settingsMap['violation_overtime_grace_minutes'], 10) : 15,
    late_cancel_minutes: settingsMap['violation_late_cancel_minutes'] ? parseInt(settingsMap['violation_late_cancel_minutes'], 10) : 120,
    no_show_grace_minutes: settingsMap['violation_no_show_grace_minutes'] ? parseInt(settingsMap['violation_no_show_grace_minutes'], 10) : 30
  };
}
