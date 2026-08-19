import { validateTimeRange, validateOperatingHours, calculatePeakAccumulatedMinutes } from './src/lib/validators.js';
import authRoutes from "./src/modules/auth/routes.js";
import { calendarRoutes } from "./src/modules/calendar/routes.js";
import settingsRoutes from "./src/modules/settings/routes.js";
import auditRoutes from './src/modules/audit/routes.js';
import { equipmentRouter, equipmentAdminRouter } from './src/modules/equipment/routes.js';
import { recordAuditLog } from './src/modules/audit/service.js';
import violationRoutes from './src/modules/violation/routes.js';
import { whitelistRouter, whitelistAdminRouter } from './src/modules/whitelist/routes.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation, getNaturalPeriodStart } from './src/modules/violation/service.js';
import { adminAuth } from "./src/middleware/auth.js";
import { notificationRoutes } from "./src/modules/notification/routes.js";
import { authLimiter, mailLimiter, actionLimiter } from "./src/middleware/rateLimiter.js";
import express from 'express';
 
import { config } from './src/config.js';
 
import { OperationRejectError } from './src/lib/errors.js';
import { encryptID, decryptID } from './src/lib/crypto.js';
import { createServer as createViteServer } from 'vite';
import cronParser from 'cron-parser';
import * as cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { addDays, format, isBefore, parseISO, startOfDay, endOfDay, isAfter } from 'date-fns';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { 
  reloadBackupCron, 
  startUpcomingReminderCron, 
  startEndingReminderCron, 
  startNoShowScanner,
  initSchedulers 
} from './src/modules/scheduler/service.js';

 
 
 
 
import { marked } from 'marked';
import { notifyEvent, processNotificationQueue, scheduleNextRun, setBaseUrl } from './src/modules/notification/service.js';
 
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
 
const app = express();
app.set('trust proxy', config.trustProxy);
app.use(express.json());
 
 
app.use((req, res, next) => {
  setBaseUrl(req.protocol + '://' + req.get('host'));
  next();
});
 
import { db } from './src/db/index.js';
 
 
 

 
// Auto Backup Logic
const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

 
 

 

 
 
 
// Start the notification processor
processNotificationQueue(db).catch(console.error);
 
 
 
 
function getNextNaturalPeriodStart(now: Date, periodType: string): Date {
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
      if (month >= 8) return new Date(year + 1, 1, 1); // Next is Spring
      if (month >= 1) return new Date(year, 8, 1);     // Next is Fall
      return new Date(year, 1, 1);                     // Next is Spring
    case 'week':
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(year, month, diff);
      return new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(year, month + 1, 1);
  }
}
 
 
 
 
 
 
 
 
 
// API Routes
 
// --- Penalty Rules API ---
// --- Validation Helpers ---
 
 
 
 
 
 
 
 
 
 
 
import { generateICS } from './src/lib/ics';
 
// Get settings
 
 
// Admin get all reservations
 
 
app.get('/api/admin/reservations', adminAuth, (req, res) => {
  const { student_name, supervisor, startDate, endDate } = req.query;
  
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
 
  res.json(enrichedReservations);
});
 
app.get('/api/admin/reservations/stats', adminAuth, (req, res) => {
  if (!validateTimeRange(req, res)) return;
 
  const { period, student_name, supervisor, startDate, endDate } = req.query;
  
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
 
  res.json({ usageByTime, usageByPerson, usageBySupervisor, usageByEquipment });
});
 
// Admin update reservation
app.put('/api/admin/reservations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  const oldRes = db.prepare('SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?').get(id) as any;
  if (!oldRes) return res.status(404).json({ error: '未找到该预约' });
 
  // Merge old data with incoming data (PATCH style)
  const student_id = updates.student_id !== undefined ? updates.student_id : oldRes.student_id;
  const student_name = updates.student_name !== undefined ? updates.student_name : oldRes.student_name;
  const supervisor = updates.supervisor !== undefined ? updates.supervisor : oldRes.supervisor;
  const phone = updates.phone !== undefined ? updates.phone : oldRes.phone;
  const email = updates.email !== undefined ? updates.email : oldRes.email;
  const start_time = updates.start_time !== undefined ? updates.start_time : oldRes.start_time;
  const end_time = updates.end_time !== undefined ? updates.end_time : oldRes.end_time;
  
  const actual_start_time = updates.actual_start_time !== undefined ? updates.actual_start_time : oldRes.actual_start_time;
  const actual_end_time = updates.actual_end_time !== undefined ? updates.actual_end_time : oldRes.actual_end_time;
  const consumable_quantity = updates.consumable_quantity !== undefined ? updates.consumable_quantity : oldRes.consumable_quantity;
  const notes = updates.notes !== undefined ? updates.notes : oldRes.notes;
  
  let status = updates.status !== undefined ? updates.status : oldRes.status;
  
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
 
  // Cost and Violation Logic (from reports)
  let total_cost = oldRes.total_cost;
  if (actual_start_time && actual_end_time) {
    const aStart = new Date(actual_start_time);
    const aEnd = new Date(actual_end_time);
    const hours = (aEnd.getTime() - aStart.getTime()) / (1000 * 60 * 60);
    
    if (oldRes.price_type === 'hour') {
      total_cost = hours * oldRes.price;
    } else {
      total_cost = oldRes.price;
    }
    if (oldRes.consumable_fee > 0 && consumable_quantity > 0) {
      total_cost += oldRes.consumable_fee * consumable_quantity;
    }
  }
 
  let violationChanged = false;
  const revokedViolationIds: number[] = [];
  
  if (actual_start_time && oldRes.status === 'cancelled') {
    status = actual_end_time ? 'completed' : 'active';
    const noShowViolation = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'no-show' AND status = 'active'").get(id) as any;
    if (noShowViolation) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(noShowViolation.id);
      violationChanged = true;
      revokedViolationIds.push(noShowViolation.id);
    }
  } else if (actual_end_time && (oldRes.status === 'active' || oldRes.status === 'approved')) {
    status = 'completed';
  }
 
  const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('violation_late_grace_minutes', 'violation_overtime_grace_minutes')").all() as any[];
  const settingsMap = settingsRows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
  const lateGraceMinutes = settingsMap['violation_late_grace_minutes'] ? parseInt(settingsMap['violation_late_grace_minutes'], 10) : 15;
  const overtimeGraceMinutes = settingsMap['violation_overtime_grace_minutes'] ? parseInt(settingsMap['violation_overtime_grace_minutes'], 10) : 30;
 
  if (actual_start_time) {
    const scheduledStart = new Date(start_time);
    const actualStart = new Date(actual_start_time);
    const diffMinutes = (actualStart.getTime() - scheduledStart.getTime()) / (1000 * 60);
    const existingLate = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'late' AND status = 'active'").get(id) as any;
    
    if (diffMinutes > lateGraceMinutes) {
      if (!existingLate) {
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(student_id, id, 'late', actual_start_time, Math.round(diffMinutes));
        violationChanged = true;
      } else {
        db.prepare("UPDATE violation_records SET duration_minutes = ?, violation_time = ? WHERE id = ?").run(Math.round(diffMinutes), actual_start_time, existingLate.id);
      }
    } else if (existingLate) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(existingLate.id);
      violationChanged = true;
      revokedViolationIds.push(existingLate.id);
    }
  } else {
    const existingLate = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'late' AND status = 'active'").get(id) as any;
    if (existingLate) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Auto-revoked: actual_start_time cleared' WHERE id = ?").run(existingLate.id);
      violationChanged = true;
      revokedViolationIds.push(existingLate.id);
    }
  }
 
  if (actual_end_time) {
    const scheduledEnd = new Date(end_time);
    const actualEnd = new Date(actual_end_time);
    const diffMinutes = (actualEnd.getTime() - scheduledEnd.getTime()) / (1000 * 60);
    const existingOverdue = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'overdue' AND status = 'active'").get(id) as any;
    if (diffMinutes > overtimeGraceMinutes) {
      if (!existingOverdue) {
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(student_id, id, 'overdue', actual_end_time, Math.round(diffMinutes));
        violationChanged = true;
      } else {
        db.prepare("UPDATE violation_records SET duration_minutes = ?, violation_time = ? WHERE id = ?").run(Math.round(diffMinutes), actual_end_time, existingOverdue.id);
      }
    } else if (existingOverdue) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(existingOverdue.id);
      violationChanged = true;
      revokedViolationIds.push(existingOverdue.id);
    }
  } else {
    const existingOverdue = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'overdue' AND status = 'active'").get(id) as any;
    if (existingOverdue) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Auto-revoked: actual_end_time cleared' WHERE id = ?").run(existingOverdue.id);
      violationChanged = true;
      revokedViolationIds.push(existingOverdue.id);
    }
  }
 
  const stmt = db.prepare(`
    UPDATE reservations 
    SET student_id = ?, student_name = ?, supervisor = ?, phone = ?, email = ?, 
        start_time = ?, end_time = ?, actual_start_time = ?, actual_end_time = ?, 
        consumable_quantity = ?, total_cost = ?, notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(student_id, student_name, supervisor, phone, email, start_time, end_time, actual_start_time, actual_end_time, consumable_quantity, total_cost, notes, status, id);
  
  if (oldRes.status === 'pending' && status === 'approved') {
    notifyEvent(db, 'booking_approved', {
      booking_code: oldRes.booking_code,
      student_id,
      student_name,
      equipment_name: oldRes.equipment_name,
      start_time,
      end_time
    }, email || undefined);
  } else if (oldRes.status === 'pending' && (status === 'cancelled' || status === 'rejected')) {
    notifyEvent(db, 'booking_rejected', {
      booking_code: oldRes.booking_code,
      student_id,
      student_name,
      equipment_name: oldRes.equipment_name,
      start_time,
      end_time
    }, email || undefined);
  }
 
  if (revokedViolationIds.length > 0) {
    for (const rid of revokedViolationIds) {
      db.prepare(`
        UPDATE user_penalties 
        SET status = 'revoked' 
        WHERE status = 'active' AND contributing_violation_ids LIKE ?
      `).run(`%,${rid},%`);
    }
  }
  
  if (violationChanged) {
    evaluatePenaltiesOnViolation(student_id);
  }
 
  res.json({ success: true, total_cost });
});
 
// Admin delete reservation
app.delete('/api/admin/reservations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM reservations WHERE id = ?").run(id);
  res.json({ success: true });
});
 

 
// Deprecated PUT /api/admin/reports/reservations/:id removed
 
// Deprecated DELETE /api/admin/reports/reservations/:id removed
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
// Removed /api/admin/reports
 
app.use(authRoutes);
app.use(calendarRoutes);
app.use(equipmentRouter);
app.use(equipmentAdminRouter);
app.use(settingsRoutes);
app.use(auditRoutes);
app.use("/api/admin", notificationRoutes);
app.use(violationRoutes);
app.use('/api/whitelist', whitelistRouter);
app.use('/api/admin/whitelist', adminAuth, whitelistAdminRouter);

 
async function startServer() {
  initSchedulers(config.isTest);
  
  
  if (!config.isProduction && !config.isTest) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (config.isProduction) {
    app.use(express.static('dist'));
  }
 
  const PORT = 3000;
  if (!config.isTest) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}
 
if (!config.isTest) {
  startServer();
}
 
export { app, db };
