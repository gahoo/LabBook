import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './src/config.js';

import { createServer as createViteServer } from 'vite';
import cronParser from 'cron-parser';
import * as cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { addDays, format, isBefore, parseISO, startOfDay, endOfDay, isAfter } from 'date-fns';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

class OperationRejectError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'OperationRejectError';
    this.statusCode = statusCode;
  }
}

// ICS Token helper functions
function encryptID(id: string | number, secretHex: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(secretHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(String(id), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptID(token: string, secretHex: string): string | null {
  try {
    const parts = token.split(':');
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const key = Buffer.from(secretHex, 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return null;
  }
}

import { marked } from 'marked';
import { notifyEvent, processNotificationQueue, scheduleNextRun, setBaseUrl } from './src/services/notificationService';

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: { error: '登录请求过于频繁，请稍后再试' },
  standardHeaders: true, 
  legacyHeaders: false, 
});

const mailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '发送邮件请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const actionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: '操作请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

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

let backupTask: cron.ScheduledTask | null = null;

async function executeBackup() {
  const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
  const backupPath = path.join(backupDir, `lab_equipment_backup_${timestamp}.db`);
  try {
    await db.backup(backupPath);
    console.log(`Database backup successful: ${backupPath}`);
    
    // Clean up old backups
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('lab_equipment_backup_') && f.endsWith('.db'))
      .sort()
      .reverse();
      
    const retentionRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_retention'").get() as any;
    const keepCount = retentionRow && !isNaN(parseInt(retentionRow.value, 10)) ? parseInt(retentionRow.value, 10) : 7;
      
    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(backupDir, file));
        console.log(`Deleted old backup: ${file}`);
      }
    }
  } catch (err) {
    console.error('Database backup failed:', err);
  }
}

export function reloadBackupCron() {
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
  }
  
  const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_enabled'").get() as any;
  const cronRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_cron'").get() as any;
  
  const isEnabled = enabledRow ? enabledRow.value === 'true' : false;
  const cronExpression = cronRow ? cronRow.value : '0 3 * * *';
  
  if (isEnabled && cron.validate(cronExpression)) {
    backupTask = cron.schedule(cronExpression, executeBackup);
    console.log(`Backup cron scheduled with expression: ${cronExpression}`);
  } else if (isEnabled) {
    console.warn(`Invalid backup cron expression: ${cronExpression}, auto backup disabled.`);
  } else {
    console.log('Auto backup is disabled.');
  }
}

reloadBackupCron();

let upcomingReminderTask: cron.ScheduledTask | null = null;

function upcomingReminderScan() {
  try {

    const advanceRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_upcoming_advance_minutes'").get() as any;
    const advanceMins = parseInt(advanceRow?.value || '30', 10);
    
    const now = new Date();
    const thresholdTime = new Date(now.getTime() + advanceMins * 60000 + 5 * 60000); // add 5 mins buffer
    const maxLookingBack = new Date(now.getTime() - 24 * 60 * 60 * 1000); 

    const upcomingReservations = db.prepare(`
      SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee 
      FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.status = 'approved'
        AND r.start_time > ?
        AND r.start_time <= ?
    `).all(maxLookingBack.toISOString(), thresholdTime.toISOString()) as any[];

    for (const resv of upcomingReservations) {
      const startTime = new Date(resv.start_time);
      const diffMins = (startTime.getTime() - now.getTime()) / 60000;
      
      if (diffMins > 0 && diffMins <= advanceMins) {
        const existing = db.prepare(`
          SELECT 1 FROM notifications 
          WHERE event = 'booking_upcoming' AND reference_code = ?
        `).get(resv.booking_code);
        
        if (!existing) {
          notifyEvent(db, 'booking_upcoming', {
            ...resv,
            student_id: resv.student_id,
            student_name: resv.student_name,
            equipment_name: resv.equipment_name,
            booking_code: resv.booking_code,
            start_time: resv.start_time,
            end_time: resv.end_time,
            advance_minutes: advanceMins
          }, resv.email);
        }
      }
    }
  } catch (err) {
    console.error("Error scanning for upcoming reminders:", err);
  }
}

export function startUpcomingReminderCron() {
  if (upcomingReminderTask) {
    upcomingReminderTask.stop();
    upcomingReminderTask = null;
  }

  const emailRow = db.prepare("SELECT value FROM settings WHERE key = 'email.events.booking_upcoming.enabled'").get() as any;
  const webhookRow = db.prepare("SELECT value FROM settings WHERE key = 'webhook.events.booking_upcoming.enabled'").get() as any;

  if (emailRow?.value === 'true' || webhookRow?.value === 'true') {
    upcomingReminderTask = cron.schedule('*/5 * * * *', upcomingReminderScan);
    console.log('Upcoming reminder cron scheduled every 5 minutes.');
    // Run immediately when started
    upcomingReminderScan();
  } else {
    console.log('Upcoming reminder cron is disabled.');
  }
}

let endingReminderTask: cron.ScheduledTask | null = null;

function endingReminderScan() {
  try {
    const advanceRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_ending_advance_minutes'").get() as any;
    const advanceMins = parseInt(advanceRow?.value || '15', 10);
    
    const now = new Date();
    const thresholdTime = new Date(now.getTime() + advanceMins * 60000 + 5 * 60000); // add 5 mins buffer
    const maxLookingBack = new Date(now.getTime() - 24 * 60 * 60 * 1000); 

    const endingReservations = db.prepare(`
      SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee 
      FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.status = 'active'
        AND r.end_time > ?
        AND r.end_time <= ?
    `).all(maxLookingBack.toISOString(), thresholdTime.toISOString()) as any[];

    for (const resv of endingReservations) {
      const endTime = new Date(resv.end_time);
      const diffMins = (endTime.getTime() - now.getTime()) / 60000;
      
      if (diffMins > 0 && diffMins <= advanceMins) {
        const existing = db.prepare(`
          SELECT 1 FROM notifications 
          WHERE event = 'booking_ending' AND reference_code = ?
        `).get(resv.booking_code);
        
        if (!existing) {
          notifyEvent(db, 'booking_ending', {
            ...resv,
            student_id: resv.student_id,
            student_name: resv.student_name,
            equipment_name: resv.equipment_name,
            booking_code: resv.booking_code,
            start_time: resv.start_time,
            end_time: resv.end_time,
            advance_minutes: advanceMins
          }, resv.email);
        }
      }
    }
  } catch (err) {
    console.error("Error scanning for ending reminders:", err);
  }
}

export function startEndingReminderCron() {
  if (endingReminderTask) {
    endingReminderTask.stop();
    endingReminderTask = null;
  }

  const emailRow = db.prepare("SELECT value FROM settings WHERE key = 'email.events.booking_ending.enabled'").get() as any;
  const webhookRow = db.prepare("SELECT value FROM settings WHERE key = 'webhook.events.booking_ending.enabled'").get() as any;

  if (emailRow?.value === 'true' || webhookRow?.value === 'true') {
    endingReminderTask = cron.schedule('*/5 * * * *', endingReminderScan);
    console.log('Ending reminder cron scheduled every 5 minutes.');
    // Run immediately when started
    endingReminderScan();
  } else {
    console.log('Ending reminder cron is disabled.');
  }
}

startUpcomingReminderCron();
startEndingReminderCron();


// Start the notification processor
processNotificationQueue(db).catch(console.error);

const adminAuth = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (decoded && decoded.role === 'admin') {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

function getNaturalPeriodStart(now: Date, periodType: string): Date {
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
      // Assuming Fall semester starts Sept 1 (month 8), Spring starts Feb 1 (month 1)
      if (month >= 8) return new Date(year, 8, 1);
      if (month >= 1) return new Date(year, 1, 1);
      return new Date(year - 1, 8, 1); // Jan belongs to previous Fall semester
    case 'academic_year':
      // Assuming Academic year starts Sept 1
      if (month >= 8) return new Date(year, 8, 1);
      return new Date(year - 1, 8, 1);
    default:
      return new Date(year, month, 1);
  }
}

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

function evaluatePenaltiesOnViolation(student_id: string) {
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

function formatRuleName(ruleName: string, triggerConfigStr?: string, defaultViolationType?: string) {
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

function checkUserPenalty(student_id: string, target_equipment_id?: number) {
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

// API Routes

// --- Penalty Rules API ---
// --- Validation Helpers ---
function validateTimeRange(req: any, res: any, startDateKey: string = 'startDate', endDateKey: string = 'endDate'): boolean {
  const startDate = req.query[startDateKey];
  const endDate = req.query[endDateKey];

  if (!startDate || !endDate) {
    res.status(400).json({ error: '必须提供开始和结束时间范围' });
    return false;
  }
  const startObj = new Date(startDate as string);
  const endObj = new Date(endDate as string);
  if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
    res.status(400).json({ error: '时间参数不合法' });
    return false;
  }
  const diff = endObj.getTime() - startObj.getTime();
  if (diff < 0) {
    res.status(400).json({ error: '结束时间不能早于开始时间' });
    return false;
  }
  if (diff > 366 * 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: '查询时间跨度不能超过 1 年 (366 天)' });
    return false;
  }
  return true;
}

app.get('/api/public/penalty-rules', (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1 ORDER BY id DESC').all();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch penalty rules' });
  }
});

app.get('/api/admin/penalty-rules', adminAuth, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM penalty_rules ORDER BY id DESC').all();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch penalty rules' });
  }
});

app.post('/api/admin/penalty-rules', adminAuth, (req, res) => {
  try {
    const { name, description, violation_type, trigger_config, action_config, is_active } = req.body;
    const stmt = db.prepare(`
      INSERT INTO penalty_rules (name, description, violation_type, trigger_config, action_config, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const info = stmt.run(name, description, violation_type, JSON.stringify(trigger_config), JSON.stringify(action_config), is_active ? 1 : 0);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create penalty rule' });
  }
});

app.put('/api/admin/penalty-rules/:id', adminAuth, (req, res) => {
  try {
    const { name, description, violation_type, trigger_config, action_config, is_active } = req.body;
    const stmt = db.prepare(`
      UPDATE penalty_rules 
      SET name = ?, description = ?, violation_type = ?, trigger_config = ?, action_config = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(name, description, violation_type, JSON.stringify(trigger_config), JSON.stringify(action_config), is_active ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update penalty rule' });
  }
});

app.delete('/api/admin/penalty-rules/:id', adminAuth, (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM penalty_rules WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete penalty rule' });
  }
});

import { generateICS } from './src/lib/ics';

// Get settings
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const sensitivePrefixes = ['smtp.', 'webhook.', 'calendar_sync_secret'];
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    if (!sensitivePrefixes.some(prefix => curr.key.startsWith(prefix))) {
      acc[curr.key] = curr.value;
    }
    return acc;
  }, {});
  res.json(settingsMap);
});

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

app.get('/api/admin/settings', adminAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  res.json(settingsMap);
});

app.get('/api/admin/settings/violation-params', adminAuth, (req, res) => {
  const keys = ['violation_late_grace_minutes', 'violation_overtime_grace_minutes', 'violation_late_cancel_minutes', 'violation_no_show_grace_minutes'];
  const settingsRows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys) as any[];
  
  const map = {
    violation_late_grace_minutes: 15,
    violation_overtime_grace_minutes: 15,
    violation_late_cancel_minutes: 120,
    violation_no_show_grace_minutes: 30
  };
  
  for (const row of settingsRows) {
    const parsed = parseInt(row.value, 10);
    if (!isNaN(parsed)) {
      (map as any)[row.key] = parsed;
    }
  }
  
  res.json(map);
});

// Update settings (Admin)
app.post('/api/admin/settings', adminAuth, (req, res) => {
  const bodyKeys = Object.keys(req.body);
  
  // Validation for booking_code_delivery.web
  // Create a simulated next state for settings involved
  const getCurrent = (k: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as any;
    return row ? row.value : null;
  };
  
  const getNext = (k: string) => req.body[k] !== undefined ? req.body[k] : getCurrent(k);
  
  const webDelivery = getNext('booking_code_delivery.web') !== 'false';
  
  if (!webDelivery) {
    const smtpEnabled = getNext('smtp.enabled') === 'true';
    const smtpEventCreated = getNext('email.events.booking_created.enabled') === 'true';
    const smtpEventApproved = getNext('email.events.booking_approved.enabled') === 'true';
    
    const webhookEnabled = getNext('webhook.enabled') === 'true';
    const webhookEventCreated = getNext('webhook.events.booking_created.enabled') === 'true';
    const webhookEventApproved = getNext('webhook.events.booking_approved.enabled') === 'true';
    
    const validSmtp = smtpEnabled && (smtpEventCreated || smtpEventApproved);
    const validWebhook = webhookEnabled && (webhookEventCreated || webhookEventApproved);
    
    if (!validSmtp && !validWebhook) {
      return res.status(400).json({ error: '必须至少保留一种有效的预约码获取途径。关闭网页展示时，需确保已全局开启并勾选了 Email 或 Webhook 相关的预约通知。' });
    }
  }

  const stmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  
  const updateSetting = (key: string, value: any) => {
    if (value !== undefined) {
      const stringValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      insertStmt.run(key, stringValue);
      stmt.run(stringValue, key);
    }
  };

  for (const key of bodyKeys) {
    updateSetting(key, req.body[key]);
  }
  
  if (req.body.cron_no_show_scan_interval_minutes !== undefined) {
    startNoShowScanner(); // Restart the scanner with new interval
  }

  let backupSettingsChanged = false;
  if (req.body.auto_backup_enabled !== undefined || req.body.auto_backup_cron !== undefined || req.body.auto_backup_retention !== undefined) {
    backupSettingsChanged = true;
  }
  
  if (backupSettingsChanged) {
    reloadBackupCron();
  }

  if (
    req.body['email.events.booking_upcoming.enabled'] !== undefined ||
    req.body['webhook.events.booking_upcoming.enabled'] !== undefined ||
    req.body['booking_upcoming_advance_minutes'] !== undefined
  ) {
    startUpcomingReminderCron();
  }

  if (
    req.body['email.events.booking_ending.enabled'] !== undefined ||
    req.body['webhook.events.booking_ending.enabled'] !== undefined ||
    req.body['booking_ending_advance_minutes'] !== undefined
  ) {
    startEndingReminderCron();
  }
  
  res.json({ success: true });
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
app.get('/api/user/active-penalties', (req, res) => {
  const student_id = req.query.student_id as string;
  if (!student_id) {
    return res.status(400).json({ error: 'Missing student_id' });
  }
  try {
    const penalty = checkUserPenalty(student_id);
    res.json(penalty);
  } catch (error) {
    console.error('Error fetching active penalties:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

app.post('/api/violations/my', (req, res) => {
  const { student_id, student_name, violation_ids } = req.body;
  if (typeof student_id !== 'string' || typeof student_name !== 'string' || !student_id.trim() || !student_name.trim()) {
    return res.status(400).json({ error: 'Missing credentials' });
  }
  
  let query = `
    SELECT v.*, r.student_id, r.student_name, r.booking_code, e.name as equipment_name 
    FROM violation_records v
    JOIN reservations r ON v.reservation_id = r.id
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.student_id = ? AND r.student_name = ?
  `;
  const params: any[] = [student_id, student_name];

  if (violation_ids && Array.isArray(violation_ids) && violation_ids.length > 0) {
    const placeholders = violation_ids.map(() => '?').join(',');
    query += ` AND v.id IN (${placeholders})`;
    params.push(...violation_ids);
  }

  query += ` ORDER BY v.violation_time DESC`;
  
  const violations = db.prepare(query).all(...params);
  
  let userPenaltyDetails = null;
  if (!violation_ids) {
    userPenaltyDetails = checkUserPenalty(student_id);
  }
  
  res.json({ violations, userPenaltyDetails });
});

app.post('/api/violations/:id/appeal', (req, res) => {
  const { id } = req.params;
  const { student_id, student_name, appeal_reason } = req.body;
  
  if (typeof student_id !== 'string' || typeof student_name !== 'string' || typeof appeal_reason !== 'string') {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!student_id.trim() || !student_name.trim() || !appeal_reason.trim()) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (appeal_reason.length > 2000) {
    return res.status(400).json({ error: '申诉理由过长（上限2000字符）' });
  }

  const violation = db.prepare(`
    SELECT v.*, r.student_id, r.student_name 
    FROM violation_records v
    JOIN reservations r ON v.reservation_id = r.id
    WHERE v.id = ?
  `).get(id) as any;
  
  if (!violation) return res.status(404).json({ error: 'Record not found' });
  if (violation.student_id !== student_id || violation.student_name !== student_name) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  let remarkObj: any = {};
  if (violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  if (remarkObj.appeal_reason) {
    return res.status(400).json({ error: 'Already appealed' });
  }
  
  remarkObj.appeal_reason = appeal_reason;
  remarkObj.appeal_time = new Date().toISOString();
  
  db.prepare('UPDATE violation_records SET remark = ? WHERE id = ?').run(JSON.stringify(remarkObj), id);
  
  res.json({ success: true });
});

app.get('/api/admin/violations', adminAuth, (req, res) => {
  const { startDate, endDate, ids, appealStatus, reservation_id } = req.query;

  const hasSpecificId = reservation_id || (ids && typeof ids === 'string' && ids.trim() !== '');
  if (!hasSpecificId) {
    if (!validateTimeRange(req, res)) return;
  }

  let query = `
    SELECT v.*, r.student_name, r.supervisor, r.booking_code, r.equipment_id, e.name as equipment_name, r.start_time, r.end_time, r.actual_start_time, r.actual_end_time, r.phone, r.email, r.total_cost, r.consumable_quantity, r.notes as reservation_notes
    FROM violation_records v
    LEFT JOIN reservations r ON v.reservation_id = r.id
    LEFT JOIN equipment e ON r.equipment_id = e.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (reservation_id) {
    query += ` AND v.reservation_id = ?`;
    params.push(reservation_id);
  }

  if (ids && typeof ids === 'string') {
    const idArray = ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    if (idArray.length > 0) {
      query += ` AND v.id IN (${idArray.map(() => '?').join(',')})`;
      params.push(...idArray);
    } else {
      query += ` AND 1=0`; // Return empty if invalid ids
    }
  } else {
    if (startDate) {
      query += ` AND v.violation_time >= ?`;
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query += ` AND v.violation_time <= ?`;
      params.push(`${endDate}T23:59:59.999Z`);
    }
  }

  if (appealStatus === 'appealing') {
    query += ` AND v.status = 'active' AND json_valid(v.remark) = 1 AND json_extract(v.remark, '$.appeal_reason') IS NOT NULL AND json_extract(v.remark, '$.appeal_reply') IS NULL`;
  } else if (appealStatus === 'rejected') {
    query += ` AND v.status = 'active' AND json_valid(v.remark) = 1 AND json_extract(v.remark, '$.appeal_reply') IS NOT NULL`;
  }

  query += ` ORDER BY v.violation_time DESC`;
  
  const records = db.prepare(query).all(...params);
  res.json(records);
});

app.post('/api/admin/penalty-rules/simulate', adminAuth, (req, res) => {
  const { trigger, action, start_date, end_date } = req.body;
  
  if (!trigger || typeof trigger !== 'object') {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  if (typeof start_date !== 'string' || typeof end_date !== 'string' || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const violationTypes = trigger.violation_types || [trigger.violation_type];
  if (!violationTypes || violationTypes.length === 0) {
     return res.json([]);
  }
  
  const typePlaceholders = violationTypes.map(() => '?').join(',');
  
  let scopeCondition = '';
  // Append T23:59:59.999Z to end_date to include the whole day if it's a date string like '2023-10-15'
  const finalEndDate = end_date.includes('T') ? end_date : end_date + 'T23:59:59.999Z';
  let queryParams: any[] = [...violationTypes, start_date, finalEndDate];

  if (trigger.scope && Array.isArray(trigger.scope) && trigger.scope.length > 0) {
    const placeholders = trigger.scope.map(() => '?').join(',');
    scopeCondition = `AND reservation_id IN (SELECT id FROM reservations WHERE equipment_id IN (${placeholders}))`;
    queryParams.push(...trigger.scope);
  }

  try {
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

    res.json(results);
  } catch (error: any) {
    console.error('Simulation error:', error);
    res.status(500).json({ error: '模拟执行失败: ' + (error.message || String(error)) });
  }
});

app.post('/api/admin/violations', adminAuth, (req, res) => {
  const { student_id, booking_code, violation_type, violation_time, admin_note } = req.body;

  if (!student_id || !violation_type || !violation_time) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const allowedTypes = ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'];
  if (!allowedTypes.includes(violation_type)) {
    return res.status(400).json({ error: '不支持的违规类型' });
  }

  try {
    let reservation_id = null;
    let actual_student_name = null;
    let email = null;
    let equipment_name = '无关联设备';

    if (booking_code) {
      const reservation = db.prepare('SELECT r.id, r.student_id, r.student_name, r.email, e.name as equipment_name FROM reservations r LEFT JOIN equipment e ON r.equipment_id = e.id WHERE r.booking_code = ?').get(booking_code) as any;
      if (!reservation) {
        return res.status(400).json({ error: '预约码不存在' });
      }
      if (reservation.student_id !== student_id) {
        return res.status(400).json({ error: '预约码与学号不匹配' });
      }
      reservation_id = reservation.id;
      actual_student_name = reservation.student_name;
      email = reservation.email;
      if (reservation.equipment_name) {
        equipment_name = reservation.equipment_name;
      }
    }

    const remark = admin_note ? JSON.stringify({ admin_note }) : null;

    const result = db.prepare(
      'INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, remark) VALUES (?, ?, ?, ?, ?)'
    ).run(student_id, reservation_id, violation_type, new Date(violation_time).toISOString(), remark);

    evaluatePenaltiesOnViolation(student_id);

    try {
      if (!email && !booking_code) {
          const resWithEmail = db.prepare('SELECT email, student_name FROM reservations WHERE student_id = ? AND email IS NOT NULL ORDER BY id DESC LIMIT 1').get(student_id) as any;
          if (resWithEmail) {
              email = resWithEmail.email;
              actual_student_name = resWithEmail.student_name;
          }
      }

      if (email) {
          try {
              notifyEvent(db, 'violation_created', {
                  userId: student_id,
                  userName: actual_student_name || student_id,
                  violation_type,
                  equipment_name,
                  violation_time: new Date(violation_time).toISOString(),
                  booking_code: booking_code || '无关联预约',
                  admin_note: admin_note || ''
              }, email);
          } catch (err) {
              console.error('Failed to queue notification for standalone violation:', err);
          }
      }
    } catch (e) {
        console.error('Error fetching email for notification:', e);
    }

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Error adding standalone violation:', error);
    res.status(500).json({ error: '添加失败：服务器内部错误' });
  }
});

app.put('/api/admin/violations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { violation_type, remark } = req.body;

  if (!violation_type) {
    return res.status(400).json({ error: '缺少违规类型字段' });
  }

  const allowedTypes = ['hygiene_issue', 'improper_operation', 'proxy_booking', 'other_manual'];
  if (!allowedTypes.includes(violation_type)) {
    return res.status(400).json({ error: '不支持的违规类型' });
  }

  const existing = db.prepare('SELECT student_id, remark, violation_type FROM violation_records WHERE id = ?').get(id) as any;
  if (!existing) {
    return res.status(404).json({ error: '违规记录不存在' });
  }
  
  if (!allowedTypes.includes(existing.violation_type)) {
    return res.status(400).json({ error: '不允许修改系统自动生成的违规记录' });
  }

  let finalRemark = existing.remark;
  if (remark !== undefined) {
    let remarkObj: any = {};
    try {
      remarkObj = existing.remark ? JSON.parse(existing.remark) : {};
    } catch(e) {}
    if (remark) {
      remarkObj.admin_note = remark;
    } else {
      delete remarkObj.admin_note;
    }
    finalRemark = Object.keys(remarkObj).length > 0 ? JSON.stringify(remarkObj) : null;
  }

  try {
    db.prepare('UPDATE violation_records SET violation_type = ?, remark = ? WHERE id = ?').run(violation_type, finalRemark, id);
    
    // Re-evaluate penalties just in case
    evaluatePenaltiesOnViolation(existing.student_id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.post('/api/admin/violations/:id/revoke', adminAuth, (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  
  const violationRecord = db.prepare('SELECT v.*, r.student_name, r.email FROM violation_records v LEFT JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?').get(id) as any;
  const violation = db.prepare('SELECT remark FROM violation_records WHERE id = ?').get(id) as any;
  let remarkObj: any = {};
  if (violation && violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  let newRemarkObj: any = {};
  try {
    newRemarkObj = JSON.parse(remark);
  } catch (e) {
    newRemarkObj = { admin_note: remark };
  }

  remarkObj.admin_note = newRemarkObj.admin_note;
  if (remarkObj.appeal_reason) {
    remarkObj.appeal_reply = newRemarkObj.admin_note || '申诉已通过，违规记录已撤销';
  }
  
  db.prepare("UPDATE violation_records SET status = 'revoked', remark = ? WHERE id = ?").run(JSON.stringify(remarkObj), id);
  
  // Auto-revoke any active user_penalties that relied on this violation
  db.prepare(`
    UPDATE user_penalties 
    SET status = 'revoked' 
    WHERE status = 'active' AND contributing_violation_ids LIKE ?
  `).run(`%,${id},%`);

  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'revoked',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }

  res.json({ success: true });
});

app.post('/api/admin/violations/:id/restore', adminAuth, (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  
  const violationRecord = db.prepare('SELECT v.*, r.student_name, r.email FROM violation_records v LEFT JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?').get(id) as any;
  const violation = db.prepare('SELECT remark FROM violation_records WHERE id = ?').get(id) as any;
  let remarkObj: any = {};
  if (violation && violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  let newRemarkObj: any = {};
  try {
    newRemarkObj = JSON.parse(remark);
  } catch (e) {
    newRemarkObj = { admin_note: remark };
  }

  remarkObj.admin_note = newRemarkObj.admin_note;
  if (remarkObj.appeal_reason) {
    remarkObj.appeal_reply = newRemarkObj.admin_note || '申诉已驳回，违规记录恢复生效';
  }

  db.prepare("UPDATE violation_records SET status = 'active', remark = ? WHERE id = ?").run(JSON.stringify(remarkObj), id);
  
  // Note: We don't automatically restore user_penalties because we don't know if they should still be active
  // based on current time, or if other violations have occurred. The next violation will trigger a re-evaluation.
  
  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'restored',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }

  res.json({ success: true });
});

app.post('/api/admin/violations/:id/reject-appeal', adminAuth, (req, res) => {
  const { id } = req.params;
  const { remark } = req.body;
  
  const violationRecord = db.prepare('SELECT v.*, r.student_name, r.email FROM violation_records v LEFT JOIN reservations r ON v.reservation_id = r.id WHERE v.id = ?').get(id) as any;
  const violation = db.prepare('SELECT remark FROM violation_records WHERE id = ?').get(id) as any;
  let remarkObj: any = {};
  if (violation && violation.remark) {
    try {
      remarkObj = JSON.parse(violation.remark);
    } catch (e) {
      remarkObj = { admin_note: violation.remark };
    }
  }
  
  let newRemarkObj: any = {};
  try {
    newRemarkObj = JSON.parse(remark);
  } catch (e) {
    newRemarkObj = { admin_note: remark };
  }

  remarkObj.admin_note = newRemarkObj.admin_note;
  remarkObj.appeal_reply = newRemarkObj.admin_note || '申诉已驳回';
  
  db.prepare("UPDATE violation_records SET remark = ? WHERE id = ?").run(JSON.stringify(remarkObj), id);

  if (violationRecord && remarkObj.appeal_reason) {
    notifyEvent(db, 'appeal_resolved', {
      violation_id: id,
      student_id: violationRecord.student_id,
      student_name: violationRecord.student_name || '未知',
      resolution: 'rejected',
      reply: remarkObj.appeal_reply
    }, violationRecord.email || undefined);
  }

  res.json({ success: true });
});

app.post('/api/admin/penalties/batch', adminAuth, (req, res) => {
  const { rule_id, student_ids } = req.body;
  
  if (!rule_id || !student_ids || !Array.isArray(student_ids)) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const rule = db.prepare('SELECT * FROM penalty_rules WHERE id = ?').get(rule_id) as any;
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  
  const trigger = JSON.parse(rule.trigger_config);
  const action = JSON.parse(rule.action_config);
  
  if (action.duration_type === 'dynamic') {
    return res.status(400).json({ error: 'Cannot batch insert for dynamic duration rules' });
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

  try {
    const count = insertTx(student_ids);
    res.json({ success: true, count });
  } catch (err) {
    console.error('Batch insert penalties failed:', err);
    res.status(500).json({ error: 'Failed to batch insert penalties' });
  }
});

app.get('/api/admin/penalties/active', adminAuth, (req, res) => {
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

  res.json(allPenalties);
});

app.post('/api/admin/penalties/waive', adminAuth, (req, res) => {
  const { penalty_id, student_id, rule_id, contributing_violation_ids, is_dynamic } = req.body;
  
  if (!student_id || !rule_id || !contributing_violation_ids) {
    return res.status(400).json({ error: '缺少必要的参数' });
  }

  try {
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
    
    res.json({ success: true });
  } catch(e) {
    console.error('Error waiving penalty:', e);
    res.status(500).json({ error: '豁免失败' });
  }
});

app.get('/api/admin/violations/stats', adminAuth, (req, res) => {
  if (!validateTimeRange(req, res)) return;
  
  const { startDate, endDate, dimension = 'user' } = req.query as { startDate?: string, endDate?: string, dimension?: 'user' | 'supervisor' | 'equipment' };
  
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

  res.json(violations);
});

// Removed /api/admin/reports

app.get('/api/admin/audit-logs', adminAuth, (req, res) => {
  if (!validateTimeRange(req, res, 'start_date', 'end_date')) return;

  const { start_date, end_date } = req.query;
  let query = `
    SELECT a.*, r.booking_code 
    FROM audit_logs a
    LEFT JOIN reservations r ON a.reservation_id = r.id
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (start_date) {
    query += ` AND a.created_at >= ?`;
    params.push(start_date);
  }
  if (end_date) {
    query += ` AND a.created_at <= ?`;
    params.push(end_date);
  }
  
  query += ` ORDER BY a.created_at DESC`;
  
  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

app.post('/api/admin/notifications/test-connection', adminAuth, async (req, res) => {
  const { type, config } = req.body;
  
  try {
    if (type === 'smtp') {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port || '465', 10),
        secure: parseInt(config.port || '465', 10) === 465,
        auth: { user: config.user, pass: config.pass }
      });
      await transporter.verify();
      res.json({ success: true, message: 'SMTP 连接成功' });
    } else if (type === 'webhook') {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers ? JSON.parse(config.headers) : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, message: 'Ping from booking system' }),
      });
      if (response.ok) {
        res.json({ success: true, message: `Webhook 测试成功, 状态码: ${response.status}` });
      } else {
        throw new OperationRejectError(`Webhook 响应异常, 状态码: ${response.status}`);
      }
    } else {
      res.status(400).json({ error: '不支持的类型' });
    }
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Test connection error:', error);
      res.status(500).json({ error: '连接测试失败: ' + (error.message || String(error)) });
    }
  }
});

app.post('/api/admin/notifications/test-event', adminAuth, async (req, res) => {
  const { event, type, config, eventConfig } = req.body;
  
  // Mock Data
  const mockData: Record<string, string> = {
    booking_code: 'TEST-1234',
    student_id: '12345678',
    student_name: '测试用户',
    equipment_name: '蔡司LSM980激光共聚焦显微镜',
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 3600000).toISOString(),
    action: 'test_action',
    reason: '测试原因',
    resolution: 'approved',
    reply: '测试回复',
    advance_minutes: '30',
    calendar_url: 'webcal://example.com/api/calendar/user/TEST_TOKEN.ics'
  };

  try {
    const { renderTemplate } = await import('./src/services/notificationService');
    
    if (type === 'webhook') {
      const payloadString = renderTemplate(eventConfig.template || '', mockData);
      let payload;
      try {
        payload = JSON.parse(payloadString);
      } catch(e) {
        throw new OperationRejectError('解析Webhook模板JSON失败');
      }
      
      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers ? JSON.parse(config.headers) : { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new OperationRejectError(`服务端返回 HTTP ${response.status}`);
      res.json({ success: true, message: 'Webhook 推送成功' });
      
    } else if (type === 'smtp') {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port || '465', 10),
        secure: parseInt(config.port || '465', 10) === 465,
        auth: { user: config.user, pass: config.pass }
      });
      
      const subject = renderTemplate(eventConfig.subject || '测试通知', mockData);
      const markdown = renderTemplate(eventConfig.template || '', mockData);
      const html = await marked.parse(markdown);
      
      const toEmail = req.body.to_email || config.user; // Send to themselves for testing if not provided

      await transporter.sendMail({
        from: `"${config.from_name || 'System'}" <${config.from_email || config.user}>`,
        to: toEmail,
        subject,
        html
      });
      res.json({ success: true, message: '邮件推送测试成功' });
    }
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Test event error:', error);
      res.status(500).json({ error: '测试推送失败: ' + (error.message || String(error)) });
    }
  }
});

app.get('/api/admin/delivery-logs', adminAuth, (req, res) => {
  const { status, reference_code, target, events, startDate, endDate, page = '1', limit = '50' } = req.query;
  try {
    const rawLimit = parseInt(limit as string) || 50;
    const safeLimit = Math.min(rawLimit, 500);
    let query = `SELECT id, event, channel, target, reference_code, status, retry_count, next_retry_time, error_message, created_at, updated_at FROM notifications WHERE 1=1`;
    const params: any[] = [];
    
    if (status && status !== '全部' && status !== 'All') {
      const statusList = (status as string).split(',');
      const statusMap: Record<string, string> = {
        '待发送': 'pending',
        '重试中': 'retrying',
        '发送成功': 'success',
        '发送失败': 'failed'
      };
      
      const dbStatuses = statusList
        .map(s => statusMap[s] || s)
        .filter(s => ['pending', 'retrying', 'success', 'failed'].includes(s));
        
      if (dbStatuses.length > 0) {
        query += ` AND status IN (${dbStatuses.map(() => '?').join(',')})`;
        params.push(...dbStatuses);
      }
    }

    if (events && events !== '全部' && events !== 'All') {
      const eventList = (events as string).split(',').filter(Boolean);
      if (eventList.length > 0) {
        query += ` AND event IN (${eventList.map(() => '?').join(',')})`;
        params.push(...eventList);
      }
    }
    
    if (reference_code) {
      query += ` AND reference_code LIKE ?`;
      params.push(`%${reference_code}%`);
    }

    if (target) {
      query += ` AND target LIKE ?`;
      params.push(`%${target}%`);
    }

    if (startDate) {
      query += ` AND created_at >= ?`;
      params.push(`${startDate}T00:00:00.000Z`);
    }

    if (endDate) {
      query += ` AND created_at <= ?`;
      params.push(`${endDate}T23:59:59.999Z`);
    }

    const countQuery = query.replace('id, event, channel, target, reference_code, status, retry_count, next_retry_time, error_message, created_at, updated_at', 'count(*) as total');
    const totalRow = db.prepare(countQuery).get(...params) as any;
    const total = totalRow ? totalRow.total : 0;

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const offset = (Math.max(1, parseInt(page as string) || 1) - 1) * safeLimit;
    params.push(safeLimit, offset);

    const logs = db.prepare(query).all(...params) as any[];
    
    // Process webhook alias
    const webhookAliasRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.alias') as any;
    const webhookAlias = webhookAliasRow ? webhookAliasRow.value : 'Webhook';
    const processedLogs = logs.map(log => ({
        ...log,
        channel: log.channel === 'webhook' ? webhookAlias : log.channel
    }));

    res.json({ logs: processedLogs, total });
  } catch (error) {
    console.error('Error fetching delivery logs', error);
    res.status(500).json({ error: 'Failed to fetch delivery logs' });
  }
});

app.post('/api/admin/delivery-logs/:id/retry', adminAuth, (req, res) => {
  try {
      db.prepare(`UPDATE notifications SET status = 'pending', retry_count = 0, next_retry_time = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
      setTimeout(() => { scheduleNextRun(db); }, 100);
      res.json({ success: true });
  } catch(e) {
      res.status(500).json({ error: 'Failed to retry' });
  }
});

let noShowScannerInterval: NodeJS.Timeout | null = null;

function startNoShowScanner() {
  if (noShowScannerInterval) {
    clearInterval(noShowScannerInterval);
  }

  const intervalRow = db.prepare("SELECT value FROM settings WHERE key = 'cron_no_show_scan_interval_minutes'").get() as any;
  const intervalMinutes = intervalRow ? parseInt(intervalRow.value, 10) : 15;
  
  noShowScannerInterval = setInterval(() => {
    scanForNoShows();
  }, intervalMinutes * 60 * 1000);
  
  // Run once immediately on start
  scanForNoShows();
}

function scanForNoShows() {
  try {
    const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
    const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
    
    const now = new Date();
    
    const pendingReservations = db.prepare(`
      SELECT * FROM reservations 
      WHERE status = 'approved'
    `).all() as any[];
    
    for (const res of pendingReservations) {
      const startTime = new Date(res.start_time);
      const limitTime = new Date(startTime.getTime() + maxLateMinutes * 60000);
      
      if (now > limitTime) {
        db.transaction(() => {
          const currentRes = db.prepare('SELECT status FROM reservations WHERE id = ?').get(res.id) as any;
          if (currentRes && currentRes.status === 'approved') {
            const nowStr = now.toISOString();
            db.prepare("UPDATE reservations SET status = 'cancelled', actual_end_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nowStr, res.id);
            db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(res.student_id, res.id, 'no-show', nowStr);
            
            evaluatePenaltiesOnViolation(res.student_id);
          }
        })();
      }
    }
  } catch (error) {
    console.error("Error scanning for no-shows:", error);
  }
}

async function startServer() {
  if (!config.isTest) {
    startNoShowScanner();
  }
  
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

