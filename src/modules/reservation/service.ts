
import { OperationRejectError } from '../../lib/errors.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation } from '../violation/service.js';
import { notifyEvent } from '../notification/service.js';
import { validateOperatingHours, calculatePeakAccumulatedMinutes } from '../../lib/validators.js';
import { db } from '../../db/index.js';
import { isAfter, format } from 'date-fns';

function getViolationSettings(db: any) {
  const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('violation_late_cancel_minutes', 'violation_no_show_grace_minutes', 'violation_late_grace_minutes', 'violation_overtime_grace_minutes')").all() as any[];
  const settingsMap = settingsRows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
  return {
    lateCancelMinutesGlobal: settingsMap['violation_late_cancel_minutes'] ? parseInt(settingsMap['violation_late_cancel_minutes'], 10) : 120,
    noShowGraceMinutes: settingsMap['violation_no_show_grace_minutes'] ? parseInt(settingsMap['violation_no_show_grace_minutes'], 10) : 30,
    lateGraceMinutes: settingsMap['violation_late_grace_minutes'] ? parseInt(settingsMap['violation_late_grace_minutes'], 10) : 15,
    overtimeGraceMinutes: settingsMap['violation_overtime_grace_minutes'] ? parseInt(settingsMap['violation_overtime_grace_minutes'], 10) : 30,
  };
}
 
function calculateReportStatus(res: any, prevRes: any, settings: any) {
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
 


export class ReservationService {

  static getBatch(codesArray: string[]) {
    const validCodes = [...new Set(codesArray.map(c => String(c).trim()).filter(Boolean))];
    if (validCodes.length === 0) {
      return [];
    }
   
    if (validCodes.length > 200) {
      throw new Error('Too many codes');
    }
   
    const placeholders = validCodes.map(() => '?').join(',');
    const reservations = db.prepare(`
      SELECT 
        r.id, r.equipment_id, r.student_name, r.student_id, r.supervisor, 
        r.start_time, r.end_time, r.status, r.booking_code,
        r.total_cost, r.consumable_quantity, r.modified_count, r.created_at,
        e.name as equipment_name, e.price_type, e.price, e.consumable_fee
      FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.booking_code IN (${placeholders})
    `).all(...validCodes);
   
    return reservations;
  }

  static getAdminList(queryOptions: { student_name?: string, supervisor?: string, startDate?: string, endDate?: string }) {
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
      SELECT r.*, e.name as equipment_name, e.release_noshow_slots, e.price_type, e.price, e.consumable_fee, e.availability_json as equipment_availability_json
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
   
      return { ...res, reportStatus, total_cost: finalCost, late_mins, overtime_mins };
    });
   
    // Sort back by start_time DESC for the list view
    enrichedReservations.sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
   
    return enrichedReservations;
  }

  static getStats(queryOptions: { period?: string, student_name?: string, supervisor?: string, startDate?: string, endDate?: string }) {
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
   
    const statsReservations = allReservations.filter(r => (r.actual_start_time && r.status === 'completed') || r.reportStatus.includes('爽约'));
   
    // Grouping by time
    const timeMap = new Map();
    const personMap = new Map();
    const supervisorMap = new Map();
    const equipmentMap = new Map();
   
    statsReservations.forEach(r => {
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

  static cancel(booking_code: string) {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT r.*, e.name as equipment_name FROM reservations r LEFT JOIN equipment e ON r.equipment_id = e.id WHERE r.booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'pending' && reservation.status !== 'approved') {
        throw new OperationRejectError('无法取消进行中或已完成的预约');
      }
      
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const startTime = new Date(reservation.start_time).getTime();
      const now = Date.now();
      if (now > startTime + maxLateMinutes * 60000) {
        throw new OperationRejectError(`超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改`);
      }
 
      const nowStr = new Date(now).toISOString();
      db.prepare("UPDATE reservations SET status = 'cancelled', actual_end_time = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_code = ?").run(nowStr, booking_code);
      
      let lateCancelMinutes = 120;
      let eqAvail = null;
      try {
        const equipment = db.prepare('SELECT availability_json FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
        if (equipment && equipment.availability_json) {
          eqAvail = JSON.parse(equipment.availability_json);
        }
      } catch (e) {}
      
      if (eqAvail && eqAvail.lateCancellationMinutes !== undefined && eqAvail.lateCancellationMinutes !== '') {
        lateCancelMinutes = parseInt(eqAvail.lateCancellationMinutes, 10);
      } else {
        const lateCancelRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_cancel_minutes'").get() as any;
        lateCancelMinutes = lateCancelRow ? parseInt(lateCancelRow.value, 10) : 120;
      }
      
      let isLateCancel = false;
      if (now >= startTime - lateCancelMinutes * 60 * 1000) {
        isLateCancel = true;
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'late_cancel', nowStr);
      }
      
      return { isLateCancel, student_id: reservation.student_id, reservation };
    })();
    
    if (result.isLateCancel) {
      evaluatePenaltiesOnViolation(result.student_id);
    }
    
    notifyEvent(db, 'booking_cancelled', {
      booking_id: result.reservation.id,
      booking_code: result.reservation.booking_code,
      student_id: result.reservation.student_id,
      student_name: result.reservation.student_name,
      equipment_id: result.reservation.equipment_id,
      equipment_name: result.reservation.equipment_name,
      start_time: result.reservation.start_time,
      end_time: result.reservation.end_time,
      status: 'cancelled',
      is_late_cancel: result.isLateCancel
    }, result.reservation.email);
  }

  static update(booking_code: string, start_time: string, end_time: string, tz_offset: number = 0) {
    const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
    
    if (!reservation) throw new OperationRejectError('未找到该预约', 404);
    if (reservation.status !== 'pending' && reservation.status !== 'approved') {
      throw new OperationRejectError('无法修改进行中或已完成的预约', 400);
    }
    
    const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
    const maxLateMinutes = 30;
    
    const startTime = new Date(reservation.start_time).getTime();
    if (Date.now() > startTime + maxLateMinutes * 60000) {
      throw new OperationRejectError(`超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改`, 400);
    }
 
    if (reservation.modified_count >= 1) {
      throw new OperationRejectError('每个预约仅允许修改一次时间，请取消后重新预约', 400);
    }
 
    const penaltyCheck = checkUserPenalty(reservation.student_id, reservation.equipment_id);
    if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
      const err = new OperationRejectError(penaltyCheck.reason, 403);
      (err as any).structured_penalty = penaltyCheck.structured_penalty;
      throw err;
    }
 
    const start = new Date(start_time);
    const end = new Date(end_time);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new OperationRejectError('无效的时间格式', 400);
    }
 
    if (end <= start) {
      throw new OperationRejectError('结束时间必须晚于开始时间', 400);
    }
 
    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    
    let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
    try {
      if (equipment.availability_json) {
        availability = JSON.parse(equipment.availability_json);
      }
    } catch (e) {}
 
    const minDuration = availability.minDurationMinutes || 30;
 
    if (durationMinutes < minDuration) throw new OperationRejectError(`预约时长不能少于 ${minDuration} 分钟`, 400);
 
    const now = new Date();
    const maxDate = new Date(now);
    
    const originalAdvanceDays = availability.advanceDays || 7;
    let penalizedAdvanceDays = originalAdvanceDays;
    if (penaltyCheck.isPenalized && penaltyCheck.restrictions) {
      if (penaltyCheck.restrictions.reduce_days > 0) {
        penalizedAdvanceDays -= penaltyCheck.restrictions.reduce_days;
      }
      if (penalizedAdvanceDays < penaltyCheck.restrictions.min_retain_days) {
        penalizedAdvanceDays = penaltyCheck.restrictions.min_retain_days;
      }
    }
 
    const maxOriginalDate = new Date(now);
    maxOriginalDate.setDate(maxOriginalDate.getDate() + originalAdvanceDays);
    maxOriginalDate.setHours(23, 59, 59, 999);
 
    const maxPenalizedDate = new Date(now);
    maxPenalizedDate.setDate(maxPenalizedDate.getDate() + penalizedAdvanceDays);
    maxPenalizedDate.setHours(23, 59, 59, 999);
    
    if (start > maxOriginalDate) {
      throw new OperationRejectError(`只能提前 ${originalAdvanceDays} 天预约`, 400);
    } else if (start > maxPenalizedDate) {
      const err = new OperationRejectError(`受惩罚规则限制，您当前只能提前 ${penalizedAdvanceDays} 天预约`, 403);
      (err as any).structured_penalty = (penaltyCheck as any).structured_penalty || penaltyCheck;
      throw err;
    }
    if (start < now) {
      throw new OperationRejectError('不能预约过去的时间', 400);
    }
 
    const validResult = validateOperatingHours(start, end, availability, tz_offset);
    if (!validResult.isValid) {
      throw new OperationRejectError(validResult.error, 400);
    }
    let isOutOfHours = validResult.isOutOfHours;
 
    const maxDuration = availability.maxDurationMinutes || 60;
    const dailyMaxDuration = availability.dailyMaxDurationMinutes ?? 0;
    const allowExceed = !!availability.allowExceedDuration;
    const allowExceedOffPeak = availability.allowExceedDurationOffPeak || false;
    const peakHours = availability.peakHours || [];
 
    const offsetModifier = `${-tz_offset >= 0 ? '+' : ''}${-tz_offset} minutes`;
 
    const userDailyUsedRow = db.prepare(`
      SELECT COALESCE(SUM((strftime('%s', end_time) - strftime('%s', start_time)) / 60), 0) AS total_minutes
      FROM reservations
      WHERE equipment_id = ?
        AND student_id = ?
        AND id != ?
        AND DATE(start_time, ?) = DATE(?, ?)
        AND status IN ('pending', 'approved', 'active')
    `).get(reservation.equipment_id, reservation.student_id, reservation.id, offsetModifier, start_time, offsetModifier) as any;
    const userDailyUsed = userDailyUsedRow ? userDailyUsedRow.total_minutes : 0;
 
    if (dailyMaxDuration > 0 && userDailyUsed + durationMinutes > dailyMaxDuration) {
      throw new OperationRejectError(`超过单日预约总时长硬性上限 (${dailyMaxDuration} 分钟)`, 400);
    }
 
    const peakAccumulated = calculatePeakAccumulatedMinutes(start, end, peakHours, tz_offset);
    let isPeakExceeded = false;
    
    if (peakAccumulated > maxDuration) {
      if (!allowExceed) {
        throw new OperationRejectError(`您的预约占用的忙时 (${peakAccumulated} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许忙时超额预约。`, 400);
      }
      isPeakExceeded = true;
    } else if (durationMinutes > maxDuration) {
      if (!allowExceedOffPeak) {
        throw new OperationRejectError(`您的预约时长 (${durationMinutes} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许闲时超额预约。`, 400);
      }
    }
 
    const tx = db.transaction(() => {
      // Check conflicts (excluding self)
      const conflictRaw = db.prepare(`
        SELECT id, start_time, actual_start_time FROM reservations 
        WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active') AND id != ?
        AND start_time < ? AND end_time > ?
      `).all(reservation.equipment_id, reservation.id, end_time, start_time);
 
      let hasConflict = false;
      if (conflictRaw.length > 0) {
        if (equipment.release_noshow_slots) {
          const nowTime = new Date().getTime();
          hasConflict = conflictRaw.some((res: any) => {
            if (!res.actual_start_time) {
              const resStartTime = new Date(res.start_time).getTime();
              if (nowTime > resStartTime + 30 * 60 * 1000) {
                return false; // This is a no-show, so it's not a conflict
              }
            }
            return true;
          });
        } else {
          hasConflict = true;
        }
      }
 
      if (hasConflict) {
        throw new OperationRejectError('所选时间段已有其他预约', 400);
      }
 
      let newStatus = (isOutOfHours || isPeakExceeded || !equipment.auto_approve) ? 'pending' : 'approved';
      
      if (penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL') {
        newStatus = 'pending';
      }
 
      const stmt = db.prepare(`
        UPDATE reservations 
        SET start_time = ?, end_time = ?, modified_count = modified_count + 1, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(start_time, end_time, newStatus, reservation.id);
    });
    
    tx();
  }

  static checkin(booking_code: string, consumable_quantity?: number) {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'approved') throw new OperationRejectError('预约未通过审批或已开始', 400);
 
      const now = new Date();
      const startTime = new Date(reservation.start_time);
      
      const scheduledStart = new Date(reservation.start_time);
      const earliestCheckin = new Date(scheduledStart.getTime() - 30 * 60 * 1000);
      if (now.getTime() < earliestCheckin.getTime()) {
        throw new OperationRejectError(`只能在预约开始前 30 分钟内上机。您的预约开始时间为 ${format(scheduledStart, 'HH:mm')}，请在 ${format(earliestCheckin, 'HH:mm')} 后重试。`, 400);
      }
 
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
      if (diffMinutes > maxLateMinutes) {
        throw new OperationRejectError(`已超过预约开始时间${maxLateMinutes}分钟，不允许上机`, 400);
      }
 
      const nowStr = now.toISOString();
      db.prepare("UPDATE reservations SET status = 'active', actual_start_time = ?, consumable_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_code = ?").run(nowStr, consumable_quantity || 0, booking_code);
      
      const lateGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_grace_minutes'").get() as any;
      const lateGraceMinutes = lateGraceRow ? parseInt(lateGraceRow.value, 10) : 15;
      
      let isLate = false;
      if (diffMinutes > lateGraceMinutes) {
        isLate = true;
        const durationMinutes = Math.round(diffMinutes);
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'late', nowStr, durationMinutes);
      }
      
      return { nowStr, isLate, student_id: reservation.student_id };
    })();
    
    if (result.isLate) {
      evaluatePenaltiesOnViolation(result.student_id);
    }
    
    return result;
  }

  static checkout(booking_code: string, consumable_quantity?: number) {
    if (consumable_quantity !== undefined) {
      const qty = Number(consumable_quantity);
      if (!Number.isInteger(qty) || qty < 0) {
        throw new OperationRejectError('耗材数量必须是大于等于0的整数', 400);
      }
    }

    const result = db.transaction(() => {
      const reservation = db.prepare(`
        SELECT r.*, e.price_type, e.price, e.consumable_fee 
        FROM reservations r
        JOIN equipment e ON r.equipment_id = e.id
        WHERE r.booking_code = ?
      `).get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'active') throw new OperationRejectError('预约未在进行中', 400);
 
      const now = new Date();
      const nowStr = now.toISOString();
      const actualStart = new Date(reservation.actual_start_time);
      const durationHours = (now.getTime() - actualStart.getTime()) / (1000 * 60 * 60);
      
      const finalConsumableQty = consumable_quantity !== undefined ? Number(consumable_quantity) : (reservation.consumable_quantity || 0);
      
      let total_cost = finalConsumableQty * (reservation.consumable_fee || 0);
      if (reservation.price_type === 'hour') {
        total_cost += Math.ceil(durationHours) * reservation.price;
      } else {
        total_cost += reservation.price;
      }
 
      const penaltyCheck = checkUserPenalty(reservation.student_id, reservation.equipment_id);
      if (penaltyCheck.isPenalized && penaltyCheck.restrictions?.fee_multiplier > 1) {
        total_cost *= penaltyCheck.restrictions.fee_multiplier;
      }
 
      const overtimeGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_overtime_grace_minutes'").get() as any;
      const overtimeGraceMinutes = overtimeGraceRow ? parseInt(overtimeGraceRow.value, 10) : 15;
      const overtimeThreshold = overtimeGraceMinutes * 60 * 1000;
      
      const end = new Date(reservation.end_time);
      let isOvertime = false;
      if (now.getTime() > end.getTime() + overtimeThreshold) {
        isOvertime = true;
        const durationMinutes = Math.round((now.getTime() - end.getTime()) / (1000 * 60));
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'overdue', nowStr, durationMinutes);
      }
 
      db.prepare("UPDATE reservations SET status = 'completed', actual_end_time = ?, total_cost = ?, consumable_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_code = ?").run(nowStr, total_cost, finalConsumableQty, booking_code);
      
      return { nowStr, total_cost, finalConsumableQty, isOvertime, student_id: reservation.student_id };
    })();
    
    if (result.isOvertime) {
      evaluatePenaltiesOnViolation(result.student_id);
    }
    
    return result;
  }
}
