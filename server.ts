import { validateTimeRange } from './src/lib/validators.js';
import settingsRoutes from "./src/modules/settings/routes.js";
import auditRoutes from './src/modules/audit/routes.js';
import { recordAuditLog } from './src/modules/audit/service.js';
import violationRoutes from './src/modules/violation/routes.js';
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
 
// --- Calendar API Routes ---
 
app.get('/api/calendar/user/url', (req, res) => {
  try {
    const enabled = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_subscription.enabled'").get() as any)?.value === 'true';
    if (!enabled) {
      return res.status(403).json({ error: 'Calendar subscription is disabled' });
    }
    
    const { booking_code, protocol = 'webcal' } = req.query;
    if (!booking_code) return res.status(400).json({ error: 'booking_code is required to verify identity' });
 
    const reservation = db.prepare('SELECT student_id FROM reservations WHERE booking_code = ?').get(booking_code) as any;
    if (!reservation) return res.status(404).json({ error: 'Invalid booking code' });
 
    const secret = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any)?.value;
    if (!secret) return res.status(500).json({ error: 'Secret not configured' });
 
    const token = encryptID(reservation.student_id, secret);
    const host = req.get('host');
    const url = `${protocol}://${host}/api/calendar/user/${token}.ics`;
    
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate calendar URL' });
  }
});
 
app.post('/api/calendar/user/mail', mailLimiter, (req, res) => {
  try {
    const enabled = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_subscription.enabled'").get() as any)?.value === 'true';
    if (!enabled) {
      return res.status(403).json({ error: 'Calendar subscription is disabled' });
    }
 
    const { booking_code } = req.body;
    if (!booking_code) return res.status(400).json({ error: 'booking_code is required' });
 
    const reservation = db.prepare('SELECT student_id, email FROM reservations WHERE booking_code = ?').get(booking_code) as any;
    if (!reservation) return res.status(404).json({ error: 'Invalid booking code' });
    
    const secret = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any)?.value;
    const token = encryptID(reservation.student_id, secret);
    const host = req.get('host');
    const url = `webcal://${host}/api/calendar/user/${token}.ics`;
    
    if (!reservation.email) return res.status(400).json({ error: 'No email associated with this booking' });
 
    notifyEvent(db, 'calendar_subscription', {
      student_id: reservation.student_id,
      calendar_url: url
    }, reservation.email);
 
    res.json({ success: true, email: reservation.email });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send calendar email' });
  }
});
 
app.get('/api/calendar/user/:token.ics', (req, res) => {
  try {
    const secret = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any)?.value;
    const studentId = decryptID(req.params.token, secret);
    
    if (!studentId) return res.status(400).send('Invalid token');
    
    const reservations = db.prepare(`
      SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee 
      FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.student_id = ? AND r.status IN ('approved', 'cancelled')
      ORDER BY r.start_time ASC
    `).all(studentId) as any[];
 
    const advanceRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_upcoming_advance_minutes'").get() as any;
    const advanceMins = parseInt(advanceRow?.value || '30', 10);
 
    const icsContent = generateICS(reservations, 'user', advanceMins);
    
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my_reservations.ics"');
    res.send(icsContent);
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});
 
app.get('/api/calendar/equipment/:token.ics', (req, res) => {
  try {
    const secret = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any)?.value;
    const equipmentId = decryptID(req.params.token, secret);
    
    if (!equipmentId) return res.status(400).send('Invalid token');
 
    const reservations = db.prepare(`
      SELECT r.*, e.name as equipment_name 
      FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.equipment_id = ? AND r.status IN ('approved', 'cancelled')
      ORDER BY r.start_time ASC
    `).all(equipmentId) as any[];
 
    const advanceRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_upcoming_advance_minutes'").get() as any;
    const advanceMins = parseInt(advanceRow?.value || '30', 10);
 
    const icsContent = generateICS(reservations, 'admin', advanceMins);
    
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="equip_${equipmentId}_reservations.ics"`);
    res.send(icsContent);
  } catch(error) {
    res.status(500).send('Internal Server Error');
  }
});
 
app.get('/api/calendar/equipment/:id/url', adminAuth, (req, res) => {
  try {
    const secret = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any)?.value;
    if (!secret) return res.status(500).json({ error: 'Secret not configured' });
 
    const token = encryptID(req.params.id, secret);
    const host = req.get('host');
    const url = `webcal://${host}/api/calendar/equipment/${token}.ics`;
    
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate calendar URL' });
  }
});
 
 
// 1. Get all equipment
app.get('/api/equipment', (req, res) => {
  let isAdmin = false;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      if (decoded && decoded.role === 'admin') {
        isAdmin = true;
      }
    } catch (e) {}
  }
  let equipment = db.prepare('SELECT * FROM equipment').all() as any[];
  
  if (!isAdmin) {
    equipment = equipment
      .filter((eq) => !eq.is_hidden)
      .map((eq) => {
        const { whitelist_data, ...rest } = eq;
        return rest;
      });
  }
  
  res.json(equipment);
});
 
// Admin Login
app.post('/api/admin/login', authLimiter, (req, res) => {
  const { password } = req.body;
  if (password === config.adminPassword) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_expires_in_hours'").get() as any;
    const expiresHours = row && !isNaN(parseInt(row.value, 10)) ? parseInt(row.value, 10) : 168;
    const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: `${expiresHours}h` });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: '密码错误' });
  }
});
 
// 2. Add equipment (Admin)
app.post('/api/admin/equipment', adminAuth, (req, res) => {
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots } = req.body;
  
  const stmt = db.prepare(`
    INSERT INTO equipment (name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const info = stmt.run(name, description, image_url, location, availability_json, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0, whitelist_enabled ? 1 : 0, whitelist_data || '', is_hidden ? 1 : 0, release_noshow_slots ? 1 : 0);
  
  res.json({ id: info.lastInsertRowid });
});
 
// Update equipment (Admin)
app.put('/api/admin/equipment/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots } = req.body;
  
  const stmt = db.prepare(`
    UPDATE equipment 
    SET name = ?, description = ?, image_url = ?, location = ?, availability_json = ?, auto_approve = ?, price_type = ?, price = ?, consumable_fee = ?, whitelist_enabled = ?, whitelist_data = ?, is_hidden = ?, release_noshow_slots = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(name, description, image_url, location, availability_json, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0, whitelist_enabled ? 1 : 0, whitelist_data || '', is_hidden ? 1 : 0, release_noshow_slots ? 1 : 0, id);
  
  res.json({ success: true });
});
 
// Batch update equipment (Admin)
app.put('/api/admin/equipment-batch', adminAuth, (req, res) => {
  const { ids, updates } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No equipment IDs provided' });
  }
 
  try {
    const updateEquipment = db.transaction((idsToUpdate: number[], updateData: any) => {
      for (const id of idsToUpdate) {
        const currentEq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as any;
        if (!currentEq) continue;
 
        let avail: any = {};
        try {
          avail = JSON.parse(currentEq.availability_json || '{}');
        } catch (e) {}
 
        let availChanged = false;
        if (updateData.advanceDays !== undefined) {
          avail.advanceDays = updateData.advanceDays;
          availChanged = true;
        }
        if (updateData.allowOutOfHours !== undefined) {
          avail.allowOutOfHours = updateData.allowOutOfHours;
          availChanged = true;
        }
        if (updateData.minDurationMinutes !== undefined) {
          avail.minDurationMinutes = updateData.minDurationMinutes;
          availChanged = true;
        }
        if (updateData.maxDurationMinutes !== undefined) {
          avail.maxDurationMinutes = updateData.maxDurationMinutes;
          availChanged = true;
        }
        if (updateData.lateCancellationMinutes !== undefined) {
          if (updateData.lateCancellationMinutes === null) {
            delete avail.lateCancellationMinutes;
          } else {
            avail.lateCancellationMinutes = updateData.lateCancellationMinutes;
          }
          availChanged = true;
        }
        if (updateData.rules !== undefined) {
          avail.rules = updateData.rules;
          availChanged = true;
        }
 
        const updateFields = [];
        const updateValues = [];
 
        if (availChanged) {
          updateFields.push('availability_json = ?');
          updateValues.push(JSON.stringify(avail));
        }
 
        if (updateData.is_hidden !== undefined) {
          updateFields.push('is_hidden = ?');
          updateValues.push(updateData.is_hidden ? 1 : 0);
        }
 
        if (updateData.release_noshow_slots !== undefined) {
          updateFields.push('release_noshow_slots = ?');
          updateValues.push(updateData.release_noshow_slots ? 1 : 0);
        }
 
        if (updateData.whitelist_enabled !== undefined) {
          updateFields.push('whitelist_enabled = ?');
          updateValues.push(updateData.whitelist_enabled ? 1 : 0);
        }
 
        if (updateData.whitelist_data !== undefined) {
          updateFields.push('whitelist_data = ?');
          updateValues.push(updateData.whitelist_data);
        }
 
        if (updateData.auto_approve !== undefined) {
          updateFields.push('auto_approve = ?');
          updateValues.push(updateData.auto_approve ? 1 : 0);
        }
 
        if (updateFields.length > 0) {
          updateValues.push(id);
          const stmt = db.prepare(`
            UPDATE equipment 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          stmt.run(...updateValues);
        }
      }
    });
 
    updateEquipment(ids, updates);
    res.json({ success: true });
  } catch (error) {
    console.error('Batch update error:', error);
    res.status(500).json({ error: 'Failed to batch update equipment' });
  }
});
 
app.get('/api/equipment/availability/today', (req, res) => {
  const date = (req.query.date as string) || format(new Date(), 'yyyy-MM-dd');
  const targetDate = parseISO(date);
  const dayOfWeek = targetDate.getDay();
 
  const equipmentList = db.prepare('SELECT * FROM equipment').all() as any[];
  
  const results = equipmentList.map(eq => {
    let availability;
    try {
      availability = JSON.parse(eq.availability_json || '{"rules":[], "advanceDays": 7, "maxDurationMinutes": 60, "minDurationMinutes": 30}');
    } catch (e) {
      availability = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
    }
 
    const dayRules = availability.rules?.filter((r: any) => r.day === dayOfWeek) || [];
    
    const availableSlots = dayRules.map((rule: any) => {
      return {
        start: `${date}T${rule.start}:00`,
        end: `${date}T${rule.end}:00`
      };
    });
 
    const windowStart = new Date(`${date}T00:00:00`);
    windowStart.setDate(windowStart.getDate() - 1);
    const windowEnd = new Date(`${date}T00:00:00`);
    windowEnd.setDate(windowEnd.getDate() + 2);
 
    const reservationsRaw = db.prepare(`
      SELECT start_time, end_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? 
      AND status IN ('pending', 'approved', 'active')
      AND start_time < ? AND end_time > ?
    `).all(eq.id, windowEnd.toISOString(), windowStart.toISOString()) as any[];
 
    let reservations = reservationsRaw;
    if (eq.release_noshow_slots) {
      const now = new Date().getTime();
      reservations = reservationsRaw.filter((res: any) => {
        if (!res.actual_start_time) {
          const startTime = new Date(res.start_time).getTime();
          if (now > startTime + 30 * 60 * 1000) {
            return false; // Filter out no-shows
          }
        }
        return true;
      });
    }
 
    return {
      equipment_id: eq.id,
      equipment_name: eq.name,
      availableSlots,
      reservations: reservations.map(r => ({ start_time: r.start_time, end_time: r.end_time })),
      maxDurationMinutes: availability.maxDurationMinutes || 60,
      minDurationMinutes: availability.minDurationMinutes || 30
    };
  });
 
  res.json(results);
});
 
// 3. Get availability for an equipment on a specific date
app.get('/api/equipment/:id/availability', (req, res) => {
  const { id } = req.params;
  const { date, start_date, end_date } = req.query as any;
  
  const isRange = !!(start_date && end_date);
 
  if (!date && !isRange) {
    return res.status(400).json({ error: '需要提供 date 或 start_date & end_date' });
  }
 
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as any;
  if (!equipment) {
    return res.status(404).json({ error: '未找到该仪器' });
  }
 
  let availability;
  try {
    availability = JSON.parse(equipment.availability_json || '{"rules":[], "advanceDays": 7, "maxDurationMinutes": 60, "minDurationMinutes": 30}');
  } catch (e) {
    availability = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  }
 
  const today = startOfDay(new Date());
  const maxDate = addDays(today, availability.advanceDays || 7);
  const now = new Date().getTime();
  
  const datesToProcess = [];
  if (isRange) {
    const s = parseISO(start_date);
    const e = parseISO(end_date);
    let curr = s;
    while (curr <= e && datesToProcess.length < 100) {
      datesToProcess.push(format(curr, 'yyyy-MM-dd'));
      curr = addDays(curr, 1);
    }
  } else {
    datesToProcess.push(date);
  }
 
  const minDateStr = datesToProcess[0];
  const maxDateStr = datesToProcess[datesToProcess.length - 1];
 
  const windowStart = new Date(`${minDateStr}T00:00:00`);
  windowStart.setDate(windowStart.getDate() - 1);
  const windowEnd = new Date(`${maxDateStr}T00:00:00`);
  windowEnd.setDate(windowEnd.getDate() + 2);
 
  const reservationsRaw = db.prepare(`
    SELECT id, start_time, end_time, actual_start_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND start_time < ? AND end_time > ?
  `).all(id, windowEnd.toISOString(), windowStart.toISOString()) as any[];
 
  let rangeReservations = reservationsRaw;
  if (equipment.release_noshow_slots) {
    rangeReservations = reservationsRaw.filter((res: any) => {
      if (!res.actual_start_time) {
        const startTime = new Date(res.start_time).getTime();
        if (now > startTime + 30 * 60 * 1000) {
          return false;
        }
      }
      return true;
    });
  }
 
  const results = datesToProcess.map(dStr => {
    const targetDate = parseISO(dStr);
    const dayOfWeek = targetDate.getDay();
 
    if (isAfter(targetDate, maxDate)) {
      return { 
        date: dStr,
        availableSlots: [], 
        reservations: [], 
        maxDurationMinutes: availability.maxDurationMinutes, 
        minDurationMinutes: availability.minDurationMinutes || 30,
        message: `仅支持提前 ${availability.advanceDays} 天预约` 
      };
    }
 
    const rules = availability.rules.filter((r: any) => r.day === dayOfWeek);
    const availableSlots: { start: string, end: string }[] = [];
    rules.forEach((rule: any) => {
      availableSlots.push({
        start: `${dStr}T${rule.start}:00`,
        end: `${dStr}T${rule.end}:00`
      });
    });
 
    const dStrStart = new Date(`${dStr}T00:00:00`);
    const dStrStartMs = dStrStart.getTime();
 
    const dStrEnd = new Date(`${dStr}T00:00:00`);
    dStrEnd.setDate(dStrEnd.getDate() + 1);
    const dStrEndMs = dStrEnd.getTime();
 
    const localReservations = rangeReservations.filter((r: any) => {
      const sMs = new Date(r.start_time).getTime();
      const eMs = new Date(r.end_time).getTime();
      return sMs < dStrEndMs && eMs > dStrStartMs;
    });
 
    return {
      date: dStr,
      availableSlots,
      reservations: localReservations,
      maxDurationMinutes: availability.maxDurationMinutes,
      minDurationMinutes: availability.minDurationMinutes || 30,
      dailyMaxDurationMinutes: availability.dailyMaxDurationMinutes,
      allowExceedDuration: availability.allowExceedDuration,
      allowExceedDurationOffPeak: availability.allowExceedDurationOffPeak || false,
      peakHours: availability.peakHours || []
    };
  });
 
  if (isRange) {
    return res.json(results);
  } else {
    return res.json({ 
      availableSlots: results[0].availableSlots, 
      reservations: results[0].reservations, 
      maxDurationMinutes: results[0].maxDurationMinutes,
      minDurationMinutes: results[0].minDurationMinutes,
      message: (results[0] as any).message
    });
  }
});
 
// Get all reservations for an equipment in a date range (for chart)
app.get('/api/equipment/:id/reservations', (req, res) => {
  const { id } = req.params;
  const { start, end } = req.query;
  
  const reservations = db.prepare(`
    SELECT start_time, end_time, student_name, status FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active', 'completed')
    AND start_time >= ? AND end_time <= ?
  `).all(id, start, end);
  
  res.json(reservations);
});
 
function validateOperatingHours(start: Date, end: Date, availability: any, tzOffset: number): { isValid: boolean, error?: string, isOutOfHours: boolean } {
  const allowOutOfHours = !!availability.allowOutOfHours;
 
  const startMs = start.getTime();
  const endMs = end.getTime();
  
  const localStartMs = startMs - tzOffset * 60000;
  const localEndMs = endMs - tzOffset * 60000;
 
  let currentMs = localStartMs;
 
  while (currentMs < localEndMs) {
    const currentLocal = new Date(currentMs);
    const nextMidnightLocal = new Date(currentLocal);
    nextMidnightLocal.setUTCHours(24, 0, 0, 0); 
    
    const chunkEndMs = Math.min(localEndMs, nextMidnightLocal.getTime());
    
    const dayOfWeek = currentLocal.getUTCDay();
    
    const dayRules = (availability.rules || []).filter((r: any) => r.day === dayOfWeek);
    
    if (dayRules.length === 0) {
      if (allowOutOfHours) return { isValid: true, isOutOfHours: true };
      return { isValid: false, error: '所选时间包含了仪器不开放的日期', isOutOfHours: true };
    }
    
    const startLocalMinutes = currentLocal.getUTCHours() * 60 + currentLocal.getUTCMinutes();
    
    const endDatesLocal = new Date(chunkEndMs);
    let endLocalMinutes = endDatesLocal.getUTCHours() * 60 + endDatesLocal.getUTCMinutes();
    if (endLocalMinutes === 0 && chunkEndMs > currentMs) {
       endLocalMinutes = 24 * 60;
    }
    
    const fallsWithinAnyRule = dayRules.some((rule: any) => {
      const rsMins = parseInt(rule.start.split(':')[0]) * 60 + parseInt(rule.start.split(':')[1]);
      let reMins = parseInt(rule.end.split(':')[0]) * 60 + parseInt(rule.end.split(':')[1]);
      if (reMins === 1439) reMins = 1440; // 23:59 inclusive of midnight
      return startLocalMinutes >= rsMins && endLocalMinutes <= reMins;
    });
 
    if (!fallsWithinAnyRule) {
      if (allowOutOfHours) return { isValid: true, isOutOfHours: true };
      const validRanges = dayRules.map((r: any) => `${r.start}-${r.end}`).join(', ');
      return { isValid: false, error: `部分所选时间不在仪器开放范围内 (该日开放: ${validRanges})`, isOutOfHours: true };
    }
    
    currentMs = chunkEndMs;
  }
  
  return { isValid: true, isOutOfHours: false };
}
 
function calculatePeakAccumulatedMinutes(start: Date, end: Date, peakHours: any[], tzOffset: number): number {
  if (!peakHours || peakHours.length === 0) return 0;
  
  const startMs = start.getTime();
  const endMs = end.getTime();
  
  const localStartMs = startMs - tzOffset * 60000;
  const localEndMs = endMs - tzOffset * 60000;
  
  let currentMs = localStartMs;
  let accumulated = 0;
  
  while (currentMs < localEndMs) {
    const currentLocal = new Date(currentMs);
    const nextMidnightLocal = new Date(currentLocal);
    nextMidnightLocal.setUTCHours(24, 0, 0, 0); 
    
    const chunkEndMs = Math.min(localEndMs, nextMidnightLocal.getTime());
    
    const startLocalMinutes = currentLocal.getUTCHours() * 60 + currentLocal.getUTCMinutes();
    
    const endDatesLocal = new Date(chunkEndMs);
    let endLocalMinutes = endDatesLocal.getUTCHours() * 60 + endDatesLocal.getUTCMinutes();
    if (endLocalMinutes === 0 && chunkEndMs > currentMs) {
       endLocalMinutes = 24 * 60;
    }
    
    for (const peak of peakHours) {
      const psMins = parseInt(peak.start.split(':')[0]) * 60 + parseInt(peak.start.split(':')[1]);
      let peMins = parseInt(peak.end.split(':')[0]) * 60 + parseInt(peak.end.split(':')[1]);
      if (peMins === 1439) peMins = 1440;
      
      const overlapStart = Math.max(startLocalMinutes, psMins);
      const overlapEnd = Math.min(endLocalMinutes, peMins);
      
      if (overlapEnd > overlapStart) {
        accumulated += overlapEnd - overlapStart;
      }
    }
    
    currentMs = chunkEndMs;
  }
  
  return accumulated;
}
 
// 4. Create reservation
app.post('/api/reservations', actionLimiter, (req, res) => {
  const { equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time } = req.body;
 
  // Input validation
  const stringFields = { student_id, student_name, supervisor, phone, email, start_time, end_time };
  for (const [key, val] of Object.entries(stringFields)) {
    if (typeof val !== 'string' || val.trim() === '') {
      return res.status(400).json({ error: `${key} 不能为空且必须为字符串` });
    }
  }
  if (student_name.length > 100 || supervisor.length > 100) {
    return res.status(400).json({ error: '姓名或导师名称过长（上限100字符）' });
  }
  if (supervisor.includes('教授') || supervisor.includes('老师')) {
    return res.status(400).json({ error: '导师姓名请直接填写真实姓名，请勿包含“教授”或“老师”等称谓' });
  }
  if (email.length > 200) {
    return res.status(400).json({ error: '邮箱地址过长（上限200字符）' });
  }
  if (equipment_id === undefined || equipment_id === null || isNaN(Number(equipment_id)) || !Number.isInteger(Number(equipment_id))) {
    return res.status(400).json({ error: 'equipment_id 必须为有效的整数' });
  }
  
  // Retrieve setting and check email suffix
  const emailSuffixesSettingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('allowed_email_suffixes') as any;
  if (emailSuffixesSettingRow && emailSuffixesSettingRow.value) {
    const allowedSuffixes = emailSuffixesSettingRow.value.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    if (allowedSuffixes.length > 0) {
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: `邮箱格式不正确，目前仅允许以下后缀: ${allowedSuffixes.join(', ')}` });
      }
      const domain = email.split('@').pop()?.toLowerCase() || '';
      if (!allowedSuffixes.includes(domain)) {
        return res.status(400).json({ error: `暂不支持该邮箱，目前仅允许以下邮箱后缀: ${allowedSuffixes.join(', ')}` });
      }
    }
  }
 
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id) as any;
  if (!equipment) return res.status(404).json({ error: '未找到该仪器' });
  
  let penaltyCheck = { isPenalized: false, penaltyMethod: 'NONE', reason: '', restrictions: { reduce_days: 0, min_retain_days: 999, fee_multiplier: 1.0 }, violation_ids: [] as number[] };
  try {
    penaltyCheck = checkUserPenalty(student_id, equipment_id) as any;
  } catch (e) {
    console.error('Error in checkUserPenalty:', e);
    return res.status(500).json({ error: '检查用户惩罚状态时发生错误' });
  }
 
  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    return res.status(403).json({ 
      error: penaltyCheck.reason, 
      violation_ids: penaltyCheck.violation_ids,
      structured_penalty: (penaltyCheck as any).structured_penalty 
    });
  }
  
  if (equipment.is_hidden) {
    return res.status(403).json({ error: '该仪器暂不开放预约' });
  }
 
  // Whitelist check
  if (equipment.whitelist_enabled) {
    const whitelist = (equipment.whitelist_data || '').split(/[\n,，]/).map((s: string) => s.trim()).filter(Boolean);
    if (!whitelist.includes(student_name.trim())) {
      return res.status(403).json({ 
        error: '您不在该仪器的预约白名单中，请先申请加入白名单。',
        needs_whitelist_application: true 
      });
    }
  }
 
  // Check if slot is in the past
  const now = new Date();
  const start = new Date(start_time);
  const end = new Date(end_time);
 
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
 
  if (isBefore(start, now)) {
    return res.status(400).json({ error: '不能预约已经开始或过去的时间' });
  }
 
  let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  try {
    if (equipment.availability_json) {
      availability = JSON.parse(equipment.availability_json);
    }
  } catch (e) {}
 
  if (end <= start) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }
 
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const minDuration = availability.minDurationMinutes || 30;
 
  if (durationMinutes < minDuration) return res.status(400).json({ error: `预约时长不能少于 ${minDuration} 分钟` });
 
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
    return res.status(400).json({ error: `只能提前 ${originalAdvanceDays} 天预约` });
  } else if (start > maxPenalizedDate) {
    return res.status(403).json({ 
      error: `受惩罚规则限制，您当前只能提前 ${penalizedAdvanceDays} 天预约`, 
      structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
    });
  }
 
  const tz_offset = req.body.tz_offset || 0;
  const validResult = validateOperatingHours(start, end, availability, tz_offset);
  if (!validResult.isValid) {
    return res.status(400).json({ error: validResult.error });
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
      AND DATE(start_time, ?) = DATE(?, ?)
      AND status IN ('pending', 'approved', 'active')
  `).get(equipment_id, student_id, offsetModifier, start_time, offsetModifier) as any;
  const userDailyUsed = userDailyUsedRow ? userDailyUsedRow.total_minutes : 0;
 
  if (dailyMaxDuration > 0 && userDailyUsed + durationMinutes > dailyMaxDuration) {
    return res.status(400).json({ error: `超过单日预约总时长硬性上限 (${dailyMaxDuration} 分钟)` });
  }
 
  const peakAccumulated = calculatePeakAccumulatedMinutes(start, end, peakHours, tz_offset);
  let isPeakExceeded = false;
  
  if (peakAccumulated > maxDuration) {
    if (!allowExceed) {
      return res.status(400).json({ error: `您的预约占用的忙时 (${peakAccumulated} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许忙时超额预约。` });
    }
    isPeakExceeded = true;
  } else if (durationMinutes > maxDuration) {
    if (!allowExceedOffPeak) {
      return res.status(400).json({ error: `您的预约时长 (${durationMinutes} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许闲时超额预约。` });
    }
  }
 
  const tx = db.transaction(() => {
    // Check if slot is already booked
    const existingRaw = db.prepare(`
      SELECT id, start_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
      AND start_time < ? AND end_time > ?
    `).all(equipment_id, end_time, start_time);
 
    let hasConflict = false;
    if (existingRaw.length > 0) {
      if (equipment.release_noshow_slots) {
        const nowTime = new Date().getTime();
        hasConflict = existingRaw.some((res: any) => {
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
      return { ok: false, error: '该时间段已被预约' };
    }
 
    const booking_code = crypto.randomBytes(4).toString('hex').toUpperCase();
    let status = (isOutOfHours || isPeakExceeded || !equipment.auto_approve) ? 'pending' : 'approved';
    
    if (penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL') {
      status = 'pending';
    }
 
    const stmt = db.prepare(`
      INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
 
    const info = stmt.run(equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code);
    return { ok: true, info, booking_code, status };
  });
 
  let txResult;
  try {
    txResult = tx();
  } catch (e: any) {
    console.error('Create reservation transaction error:', e);
    return res.status(500).json({ error: '预约失败：服务器内部数据库错误，请重试' });
  }
 
  if (!txResult.ok) {
    return res.status(400).json({ error: txResult.error });
  }
 
  const { info, booking_code, status } = txResult;
 
  notifyEvent(db, 'booking_created', {
    booking_id: info.lastInsertRowid,
    booking_code,
    student_id,
    student_name,
    equipment_name: equipment.name,
    start_time,
    end_time,
    status
  }, email);
 
  const deliveryWeb = db.prepare('SELECT value FROM settings WHERE key = ?').get('booking_code_delivery.web') as any;
  const smtpEnabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp.enabled') as any;
  const smtpEventCreated = db.prepare('SELECT value FROM settings WHERE key = ?').get('email.events.booking_created.enabled') as any;
  const smtpEventApproved = db.prepare('SELECT value FROM settings WHERE key = ?').get('email.events.booking_approved.enabled') as any;
 
  const webhookEnabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.enabled') as any;
  const webhookEventCreated = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.events.booking_created.enabled') as any;
  const webhookEventApproved = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.events.booking_approved.enabled') as any;
 
  const hasSmtp = smtpEnabled?.value === 'true' && (smtpEventCreated?.value === 'true' || smtpEventApproved?.value === 'true');
  const hasWebhook = webhookEnabled?.value === 'true' && (webhookEventCreated?.value === 'true' || webhookEventApproved?.value === 'true');
 
  const booking_code_delivery = {
    web: deliveryWeb ? deliveryWeb.value : 'true',
    email: hasSmtp ? 'true' : 'false',
    webhook: hasWebhook ? 'true' : 'false',
  };
 
  const webhookAliasObj = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.alias') as any;
 
  res.json({ 
    id: info.lastInsertRowid, 
    booking_code: booking_code_delivery.web === 'false' ? undefined : booking_code, 
    status,
    message: penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL' ? penaltyCheck.reason : undefined,
    booking_code_delivery,
    webhook_alias: webhookAliasObj?.value || 'Webhook',
    structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
  });
});
 
// Whitelist Application
app.post('/api/whitelist/apply', (req, res) => {
  const { equipment_id, student_id, student_name, supervisor, phone, email } = req.body;
  
  const stringFields = { student_id, student_name, supervisor, phone, email };
  for (const [key, val] of Object.entries(stringFields)) {
    if (typeof val !== 'string' || val.trim() === '') {
      return res.status(400).json({ error: `${key} 不能为空且必须为字符串` });
    }
  }
  if (equipment_id === undefined || equipment_id === null || isNaN(Number(equipment_id)) || !Number.isInteger(Number(equipment_id))) {
    return res.status(400).json({ error: 'equipment_id 必须为有效的整数' });
  }
  if (student_name.length > 100 || supervisor.length > 100) {
    return res.status(400).json({ error: '姓名或导师名称过长（上限100字符）' });
  }
  if (supervisor.includes('教授') || supervisor.includes('老师')) {
    return res.status(400).json({ error: '导师姓名请直接填写真实姓名，请勿包含“教授”或“老师”等称谓' });
  }
 
  const stmt = db.prepare(`
    INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(equipment_id, student_id, student_name, supervisor, phone, email);
  
  res.json({ success: true });
});
 
// Admin get whitelist applications
app.get('/api/admin/whitelist/applications', adminAuth, (req, res) => {
  const { status } = req.query;
  let apps;
  if (status) {
    apps = db.prepare(`
      SELECT wa.*, e.name as equipment_name 
      FROM whitelist_applications wa
      JOIN equipment e ON wa.equipment_id = e.id
      WHERE wa.status = ?
      ORDER BY wa.created_at DESC
    `).all(status);
  } else {
    apps = db.prepare(`
      SELECT wa.*, e.name as equipment_name 
      FROM whitelist_applications wa
      JOIN equipment e ON wa.equipment_id = e.id
      ORDER BY wa.created_at DESC
    `).all();
  }
  res.json(apps);
});
 
// Admin approve whitelist application
app.post('/api/admin/whitelist/applications/:id/approve', adminAuth, (req, res) => {
  const { id } = req.params;
  const app = db.prepare('SELECT * FROM whitelist_applications WHERE id = ?').get(id) as any;
  if (!app) return res.status(404).json({ error: '未找到申请' });
 
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(app.equipment_id) as any;
  if (!equipment) return res.status(404).json({ error: '未找到仪器' });
 
  let whitelist = (equipment.whitelist_data || '').split(/[\n,，]/).map((s: string) => s.trim()).filter(Boolean);
  if (!whitelist.includes(app.student_name.trim())) {
    whitelist.push(app.student_name.trim());
  }
  
  db.prepare('UPDATE equipment SET whitelist_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(whitelist.join('\n'), app.equipment_id);
  db.prepare("UPDATE whitelist_applications SET status = 'approved' WHERE id = ?").run(id);
 
  notifyEvent(db, 'whitelist_resolved', {
    student_id: app.student_id,
    student_name: app.student_name,
    equipment_name: equipment.name,
    resolution: 'approved',
    reason: app.reason || ''
  }, app.student_email || undefined);
  
  res.json({ success: true });
});
 
// Admin reject whitelist application
app.post('/api/admin/whitelist/applications/:id/reject', adminAuth, (req, res) => {
  const { id } = req.params;
  const appRecord = db.prepare('SELECT * FROM whitelist_applications WHERE id = ?').get(id) as any;
  if (!appRecord) return res.status(404).json({ error: '未找到申请' });
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(appRecord.equipment_id) as any;
 
  db.prepare("UPDATE whitelist_applications SET status = 'rejected' WHERE id = ?").run(id);
 
  notifyEvent(db, 'whitelist_resolved', {
    student_id: appRecord.student_id,
    student_name: appRecord.student_name,
    equipment_name: equipment ? equipment.name : '未知仪器',
    resolution: 'rejected',
    reason: appRecord.reason || ''
  }, appRecord.student_email || undefined);
 
  res.json({ success: true });
});
 
// 5. Get reservations by code (batch)
app.post('/api/reservations/batch', (req, res) => {
  const codesArray = req.body.codes as string[];
  if (!Array.isArray(codesArray)) {
    return res.status(400).json({ error: 'codes must be an array' });
  }
 
  const validCodes = codesArray.map(c => String(c).trim()).filter(Boolean);
  if (validCodes.length === 0) {
    return res.json([]);
  }
 
  if (validCodes.length > 200) {
    return res.status(400).json({ error: 'Too many codes' });
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
 
  res.json(reservations);
});
 
// 5. Get reservation by code
 
app.get('/api/reservations/:code', (req, res) => {
  const { code } = req.params;
  const reservation = db.prepare(`
    SELECT 
      r.id, r.equipment_id, r.student_name, r.student_id, r.supervisor, 
      r.start_time, r.end_time, r.status, r.booking_code,
      r.total_cost, r.consumable_quantity, r.modified_count, r.created_at,
      e.name as equipment_name, e.price_type, e.price, e.consumable_fee
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.booking_code = ?
  `).get(code);
 
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  res.json(reservation);
});
 
// 6. Cancel reservation
app.post('/api/reservations/cancel', actionLimiter, (req, res) => {
  const { booking_code } = req.body;
  
  try {
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
 
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Cancel reservation error:', error);
      res.status(500).json({ error: '取消预约失败，请重试' });
    }
  }
});
 
// Update reservation (User)
app.post('/api/reservations/update', actionLimiter, (req, res) => {
  const { booking_code, start_time, end_time } = req.body;
  if (typeof booking_code !== 'string' || typeof start_time !== 'string' || typeof end_time !== 'string') {
    return res.status(400).json({ error: '参数类型错误' });
  }
  const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'pending' && reservation.status !== 'approved') {
    return res.status(400).json({ error: '无法修改进行中或已完成的预约' });
  }
  
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
  const maxLateMinutes = 30;
  
  const startTime = new Date(reservation.start_time).getTime();
  if (Date.now() > startTime + maxLateMinutes * 60000) {
    return res.status(400).json({ error: `超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改` });
  }
 
  if (reservation.modified_count >= 1) {
    return res.status(400).json({ error: '每个预约仅允许修改一次时间，请取消后重新预约' });
  }
 
  const penaltyCheck = checkUserPenalty(reservation.student_id, reservation.equipment_id);
  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    return res.status(403).json({ 
      error: penaltyCheck.reason,
      structured_penalty: penaltyCheck.structured_penalty
    });
  }
 
  const start = new Date(start_time);
  const end = new Date(end_time);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
 
  if (end <= start) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }
 
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  
  let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  try {
    if (equipment.availability_json) {
      availability = JSON.parse(equipment.availability_json);
    }
  } catch (e) {}
 
  const minDuration = availability.minDurationMinutes || 30;
 
  if (durationMinutes < minDuration) return res.status(400).json({ error: `预约时长不能少于 ${minDuration} 分钟` });
 
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
    return res.status(400).json({ error: `只能提前 ${originalAdvanceDays} 天预约` });
  } else if (start > maxPenalizedDate) {
    return res.status(403).json({ 
      error: `受惩罚规则限制，您当前只能提前 ${penalizedAdvanceDays} 天预约`, 
      structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
    });
  }
  if (start < now) {
    return res.status(400).json({ error: '不能预约过去的时间' });
  }
 
  const tz_offset = req.body.tz_offset || 0;
  const validResult = validateOperatingHours(start, end, availability, tz_offset);
  if (!validResult.isValid) {
    return res.status(400).json({ error: validResult.error });
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
    return res.status(400).json({ error: `超过单日预约总时长硬性上限 (${dailyMaxDuration} 分钟)` });
  }
 
  const peakAccumulated = calculatePeakAccumulatedMinutes(start, end, peakHours, tz_offset);
  let isPeakExceeded = false;
  
  if (peakAccumulated > maxDuration) {
    if (!allowExceed) {
      return res.status(400).json({ error: `您的预约占用的忙时 (${peakAccumulated} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许忙时超额预约。` });
    }
    isPeakExceeded = true;
  } else if (durationMinutes > maxDuration) {
    if (!allowExceedOffPeak) {
      return res.status(400).json({ error: `您的预约时长 (${durationMinutes} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许闲时超额预约。` });
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
      return { ok: false, error: '所选时间段已有其他预约' };
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
    return { ok: true };
  });
 
  let txResult;
  try {
    txResult = tx();
  } catch (e: any) {
    console.error('Update reservation transaction error:', e);
    return res.status(500).json({ error: '修改失败：服务器内部数据库错误，请重试' });
  }
 
  if (!txResult.ok) {
    return res.status(400).json({ error: txResult.error });
  }
  
  res.json({ success: true });
});
 
// 7. Check-in
app.post('/api/reservations/checkin', (req, res) => {
  const { booking_code, consumable_quantity } = req.body;
  
  try {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'approved') throw new OperationRejectError('预约未通过审批或已开始');
 
      const now = new Date();
      const startTime = new Date(reservation.start_time);
      
      const scheduledStart = new Date(reservation.start_time);
      const earliestCheckin = new Date(scheduledStart.getTime() - 30 * 60 * 1000);
      if (now.getTime() < earliestCheckin.getTime()) {
        throw new OperationRejectError(`只能在预约开始前 30 分钟内上机。您的预约开始时间为 ${format(scheduledStart, 'HH:mm')}，请在 ${format(earliestCheckin, 'HH:mm')} 后重试。`);
      }
 
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
      if (diffMinutes > maxLateMinutes) {
        throw new OperationRejectError(`已超过预约开始时间${maxLateMinutes}分钟，不允许上机`);
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
    
    res.json({ success: true, actual_start_time: result.nowStr });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Checkin error:', error);
      res.status(500).json({ error: '上机失败，请重试' });
    }
  }
});
 
// 8. Check-out
app.post('/api/reservations/checkout', (req, res) => {
  const { booking_code, consumable_quantity } = req.body;
  
  try {
    const result = db.transaction(() => {
      const reservation = db.prepare(`
        SELECT r.*, e.price_type, e.price, e.consumable_fee 
        FROM reservations r
        JOIN equipment e ON r.equipment_id = e.id
        WHERE r.booking_code = ?
      `).get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'active') throw new OperationRejectError('预约未在进行中');
 
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
        // We removed the hardcoded total_cost *= 2 here because fee multiplier is handled by penalty rules now.
        // If they want overtime to double fee, they should create a penalty rule for it.
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
    
    res.json({ success: true, actual_end_time: result.nowStr, total_cost: result.total_cost, consumable_quantity: result.finalConsumableQty });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Checkout error:', error);
      res.status(500).json({ error: '下机失败，请重试' });
    }
  }
});
 
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
 
// Admin delete equipment
app.delete('/api/admin/equipment/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM equipment WHERE id = ?").run(id);
  res.json({ success: true });
});
 
// Deprecated PUT /api/admin/reports/reservations/:id removed
 
// Deprecated DELETE /api/admin/reports/reservations/:id removed
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
// Removed /api/admin/reports
 
app.use(settingsRoutes);
app.use(auditRoutes);
app.use("/api/admin", notificationRoutes);
app.use(violationRoutes);

 
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
