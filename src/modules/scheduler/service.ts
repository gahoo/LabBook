import * as cron from 'node-cron';
import { db } from '../../db/index.js';

// Import workers from their respective domains
import { executeBackup } from '../backup/service.js';
import { upcomingReminderScan, endingReminderScan } from '../notification/scanner.js';
import { scanForNoShows } from '../violation/scanner.js';

// ---------------------------------------------------------
// Backup Cron
// ---------------------------------------------------------
let backupTask: cron.ScheduledTask | null = null;

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

// ---------------------------------------------------------
// Notification Crons
// ---------------------------------------------------------
let upcomingReminderTask: cron.ScheduledTask | null = null;

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

// ---------------------------------------------------------
// Violation Scanner (Interval)
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// Global Init
// ---------------------------------------------------------
export function initSchedulers(isTest: boolean) {
  if (!isTest) {
    reloadBackupCron();
    startUpcomingReminderCron();
    startEndingReminderCron();
    startNoShowScanner();
  }
}
