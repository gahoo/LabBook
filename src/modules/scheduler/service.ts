import fs from 'fs';
import path from 'path';
import * as cron from 'node-cron';
import { format } from 'date-fns';
import { db } from '../../db/index.js';
import { notifyEvent } from '../notification/service.js';
import { evaluatePenaltiesOnViolation } from '../violation/service.js';

// Auto Backup Logic
const backupDir = path.join(process.cwd(), 'backups');
let backupTask: cron.ScheduledTask | null = null;

export async function executeBackup(targetDir?: string) {
  const dirToUse = targetDir || backupDir;
  if (!fs.existsSync(dirToUse)) {
    fs.mkdirSync(dirToUse, { recursive: true });
  }

  const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
  const backupPath = path.join(dirToUse, `lab_equipment_backup_${timestamp}.db`);
  try {
    await db.backup(backupPath);
    console.log(`Database backup successful: ${backupPath}`);
    
    // Clean up old backups
    const files = fs.readdirSync(dirToUse)
      .filter(f => f.startsWith('lab_equipment_backup_') && f.endsWith('.db'))
      .sort()
      .reverse();
    
    const retentionRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_retention'").get() as any;
    const keepCount = retentionRow && !isNaN(parseInt(retentionRow.value, 10)) ? parseInt(retentionRow.value, 10) : 7;
    
    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(dirToUse, file));
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
    backupTask = cron.schedule(cronExpression, () => executeBackup());
    console.log(`Backup cron scheduled with expression: ${cronExpression}`);
  } else if (isEnabled) {
    console.warn(`Invalid backup cron expression: ${cronExpression}, auto backup disabled.`);
  } else {
    console.log('Auto backup is disabled.');
  }
}

let upcomingReminderTask: cron.ScheduledTask | null = null;

export function upcomingReminderScan() {
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

export function endingReminderScan() {
  try {
    const advanceRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_ending_advance_minutes'").get() as any;
    const advanceMins = parseInt(advanceRow?.value || '15', 10);
    
    const now = new Date();
    const thresholdTime = new Date(now.getTime() + advanceMins * 60000 + 5 * 60000); // buffer
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

let noShowScannerInterval: NodeJS.Timeout | null = null;

export function startNoShowScanner() {
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

export function scanForNoShows() {
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

export function initSchedulers(isTest: boolean) {
  if (!isTest) {
    reloadBackupCron();
    startUpcomingReminderCron();
    startEndingReminderCron();
    startNoShowScanner();
  }
}
