import { db } from '../../db/index.js';
import { isAfter, format } from 'date-fns';

export function getViolationSettings(db: any) {
  const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('violation_late_cancel_minutes', 'violation_no_show_grace_minutes', 'violation_late_grace_minutes', 'violation_overtime_grace_minutes')").all() as any[];
  const settingsMap = settingsRows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
  return {
    lateCancelMinutesGlobal: settingsMap['violation_late_cancel_minutes'] ? parseInt(settingsMap['violation_late_cancel_minutes'], 10) : 120,
    noShowGraceMinutes: settingsMap['violation_no_show_grace_minutes'] ? parseInt(settingsMap['violation_no_show_grace_minutes'], 10) : 30,
    lateGraceMinutes: settingsMap['violation_late_grace_minutes'] ? parseInt(settingsMap['violation_late_grace_minutes'], 10) : 15,
    overtimeGraceMinutes: settingsMap['violation_overtime_grace_minutes'] ? parseInt(settingsMap['violation_overtime_grace_minutes'], 10) : 30,
  };
} 

export function calculateReportStatus(res: any, prevRes: any, settings: any) {
  if (res.status === 'cancelled') {
    if (res.actual_end_time) {
      let lateCancelMinutes = settings.lateCancelMinutesGlobal;
      if (res.equipment_availability_json) {
        try {
          const eqAvail = JSON.parse(res.equipment_availability_json);
          if (eqAvail.lateCancellationMinutes !== undefined && eqAvail.lateCancellationMinutes !== '') {
            lateCancelMinutes = parseInt(eqAvail.lateCancellationMinutes, 10);
          }
        } catch(e){}
      } 
      const cancelTime = new Date(res.actual_end_time).getTime();
      const startTime = new Date(res.start_time).getTime();
      
      const lateCancelThreshold = startTime - (lateCancelMinutes * 60 * 1000);
      const noShowThreshold = startTime + (settings.noShowGraceMinutes * 60 * 1000); 
      if (cancelTime >= noShowThreshold) {
        return '爽约';
      } else if (cancelTime >= lateCancelThreshold) {
        return '临期取消';
      }
    }
    return '已取消';
  }
  
  if (!res.actual_start_time) {
    const noShowThreshold = new Date(res.start_time).getTime() + (settings.noShowGraceMinutes * 60 * 1000);
    if (new Date().getTime() <= noShowThreshold) {
      return '待上机';
    }
    return '爽约';
  }
  
  const start = new Date(res.start_time);
  const end = new Date(res.end_time);
  const actualStart = new Date(res.actual_start_time);
  const actualEnd = res.actual_end_time ? new Date(res.actual_end_time) : null; 
  let isDelayCausedByPrev = false;
  if (prevRes && prevRes.actual_end_time) {
    const prevActualEnd = new Date(prevRes.actual_end_time);
    if (isAfter(prevActualEnd, start)) {
      isDelayCausedByPrev = true;
    }
  } 
  const lateThreshold = settings.lateGraceMinutes * 60 * 1000;
  const overtimeThreshold = settings.overtimeGraceMinutes * 60 * 1000; 
  const statuses = [];
  if (actualStart.getTime() > start.getTime() + lateThreshold && !isDelayCausedByPrev) {
    statuses.push('迟到');
  }
  if (actualEnd && actualEnd.getTime() > end.getTime() + overtimeThreshold) {
    statuses.push('超时');
  }
  
  if (statuses.length > 0) {
    return statuses.join(', ');
  }
  
  return '正常';
}

export function getAdminList(queryOptions: { student_name?: string, supervisor?: string, startDate?: string, endDate?: string }) {
  const { student_name, supervisor, startDate, endDate } = queryOptions;
  
  let whereClause = "WHERE 1=1";
  const params: any[] = [];
  
  if (student_name) {
    whereClause += " AND r.student_name LIKE ?";
    params.push(`%${student_name}%`);
  }
  if (supervisor) {
    whereClause += " AND r.supervisor LIKE ?";
    params.push(`%${supervisor}%`);
  }
  if (startDate) {
    whereClause += " AND r.start_time >= ?";
    params.push(`${startDate}T00:00:00.000Z`);
  }
  if (endDate) {
    whereClause += " AND r.start_time <= ?";
    params.push(`${endDate}T23:59:59.999Z`);
  }
 
  const reservations = db.prepare(`
    SELECT r.*, strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at) AS created_at, e.name as equipment_name, e.release_noshow_slots, e.price_type, e.price, e.consumable_fee, e.availability_json as equipment_availability_json
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    ${whereClause}
    ORDER BY r.equipment_id, r.start_time ASC
  `).all(...params);
 
  const settings = getViolationSettings(db);
 
  const enrichedReservations = reservations.map((res: any, idx: number) => {
    const prevRes = idx > 0 && (reservations[idx-1] as any).equipment_id === res.equipment_id ? (reservations[idx-1] as any) : null;
    const reportStatus = calculateReportStatus(res, prevRes, settings);
    
    let finalCost = res.total_cost || 0;
    if (reportStatus.includes('爽约')) {
      finalCost = res.price;
    }
 
    let late_mins = 0;
    let overtime_mins = 0;
    if (reportStatus.includes('迟到') && res.actual_start_time) {
      late_mins = Math.floor((new Date(res.actual_start_time).getTime() - new Date(res.start_time).getTime()) / 60000);
    }
    if (reportStatus.includes('超时') && res.actual_end_time) {
      overtime_mins = Math.floor((new Date(res.actual_end_time).getTime() - new Date(res.end_time).getTime()) / 60000);
    }
 
    return { 
      ...res, 
      reportStatus,
      total_cost: finalCost,
      late_mins: late_mins > 0 ? late_mins : 0,
      overtime_mins: overtime_mins > 0 ? overtime_mins : 0
    };
  });
 
  return enrichedReservations;
}

export function getStats(queryOptions: { period?: string, student_name?: string, supervisor?: string, startDate?: string, endDate?: string }) {
  const { period, student_name, supervisor, startDate, endDate } = queryOptions;
  
  let whereClause = "WHERE status IN ('approved', 'active', 'completed', 'cancelled')";
  const params: any[] = [];
  
  if (student_name) {
    whereClause += " AND student_name LIKE ?";
    params.push(`%${student_name}%`);
  }
  if (supervisor) {
    whereClause += " AND supervisor LIKE ?";
    params.push(`%${supervisor}%`);
  }
  if (startDate) {
    whereClause += " AND start_time >= ?";
    params.push(`${startDate}T00:00:00.000Z`);
  }
  if (endDate) {
    whereClause += " AND start_time <= ?";
    params.push(`${endDate}T23:59:59.999Z`);
  }
 
  const allReservationsRaw = db.prepare(`
    SELECT r.*, e.name as equipment_name, e.release_noshow_slots, e.price_type, e.price, e.consumable_fee, e.availability_json as equipment_availability_json
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    ${whereClause}
    ORDER BY r.equipment_id, r.start_time ASC
  `).all(...params);
 
  const settings = getViolationSettings(db);
 
  const allReservations = allReservationsRaw.map((res: any, idx: number) => {
    const prevRes = idx > 0 && (allReservationsRaw[idx-1] as any).equipment_id === res.equipment_id ? (allReservationsRaw[idx-1] as any) : null;
    const reportStatus = calculateReportStatus(res, prevRes, settings);
    
    let finalCost = res.total_cost || 0;
    if (reportStatus.includes('爽约')) {
      finalCost = res.price;
    }
    return { ...res, reportStatus, total_cost: finalCost };
  }).filter((res: any) => !res.reportStatus.includes('已取消'));
 
  const statsReservations = allReservations.filter((r: any) => (r.actual_start_time && r.status === 'completed') || r.reportStatus.includes('爽约'));
 
  // Grouping by time
  const timeMap = new Map();
  const personMap = new Map();
  const supervisorMap = new Map();
  const equipmentMap = new Map();
 
  statsReservations.forEach((r: any) => {
    let machine_hours = 0;
    if (r.actual_start_time && r.actual_end_time) {
      machine_hours = (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60);
    }
    
    let booked_hours = 0;
    if (r.start_time && r.end_time) {
      booked_hours = (new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / (1000 * 60 * 60);
    }
    
    const revenue = r.total_cost || 0;
 
    // Time grouping
    const dateToUse = r.actual_start_time ? new Date(r.actual_start_time) : new Date(r.start_time);
    let pStr = format(dateToUse, 'yyyy-MM-dd');
    if (period === 'week') pStr = format(dateToUse, "yyyy-'W'II");
    if (period === 'month') pStr = format(dateToUse, 'yyyy-MM');
    if (period === 'quarter') pStr = format(dateToUse, "yyyy-'Q'Q");
    if (period === 'year') pStr = format(dateToUse, 'yyyy');
 
    if (!timeMap.has(pStr)) {
      timeMap.set(pStr, { period: pStr, total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
    }
    const t = timeMap.get(pStr);
    t.total_hours += machine_hours;
    t.machine_hours += machine_hours;
    t.booked_hours += booked_hours;
    t.total_revenue += revenue;
 
    // Person grouping
    const personKey = `${r.student_id}_${r.student_name}`;
    if (!personMap.has(personKey)) {
      personMap.set(personKey, { student_name: r.student_name, student_id: r.student_id, supervisor: r.supervisor, total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
    }
    const p = personMap.get(personKey);
    p.total_hours += machine_hours;
    p.machine_hours += machine_hours;
    p.booked_hours += booked_hours;
    p.total_revenue += revenue;
 
    // Supervisor grouping
    if (!supervisorMap.has(r.supervisor)) {
      supervisorMap.set(r.supervisor, { supervisor: r.supervisor, total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
    }
    const s = supervisorMap.get(r.supervisor);
    s.total_hours += machine_hours;
    s.machine_hours += machine_hours;
    s.booked_hours += booked_hours;
    s.total_revenue += revenue;
 
    // Equipment grouping
    if (!equipmentMap.has(r.equipment_id)) {
      equipmentMap.set(r.equipment_id, { equipment_id: r.equipment_id, equipment_name: r.equipment_name, total_hours: 0, machine_hours: 0, booked_hours: 0, total_revenue: 0 });
    }
    const e = equipmentMap.get(r.equipment_id);
    e.total_hours += machine_hours;
    e.machine_hours += machine_hours;
    e.booked_hours += booked_hours;
    e.total_revenue += revenue;
  });
 
  const usageByTime = Array.from(timeMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  const usageByPerson = Array.from(personMap.values()).sort((a, b) => b.total_hours - a.total_hours);
  const usageBySupervisor = Array.from(supervisorMap.values()).sort((a, b) => b.total_hours - a.total_hours);
  const usageByEquipment = Array.from(equipmentMap.values()).sort((a, b) => b.total_hours - a.total_hours);
 
  return { usageByTime, usageByPerson, usageBySupervisor, usageByEquipment };
}
