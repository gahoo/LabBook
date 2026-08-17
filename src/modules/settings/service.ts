import { db } from '../../db/index.js';
import { 
  reloadBackupCron, 
  startUpcomingReminderCron, 
  startEndingReminderCron,
  startNoShowScanner
} from '../scheduler/service.js';
import { recordAuditLog } from '../audit/service.js';

export function getPublicSettings() {
  const settings = db.prepare('SELECT * FROM settings').all();
  const sensitivePrefixes = ['smtp.', 'webhook.', 'calendar_sync_secret'];
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    if (!sensitivePrefixes.some(prefix => curr.key.startsWith(prefix))) {
      acc[curr.key] = curr.value;
    }
    return acc;
  }, {});
  return settingsMap;
}

export function getAllSettings() {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  return settingsMap;
}

export function updateSettings(updates: Record<string, any>) {
  const bodyKeys = Object.keys(updates);

  // Validation for booking_code_delivery.web
  const getCurrent = (k: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as any;
    return row ? row.value : null;
  };
  
  const getNext = (k: string) => updates[k] !== undefined ? updates[k] : getCurrent(k);
  
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
      throw new Error('必须至少保留一种有效的预约码获取途径。关闭网页展示时，需确保已全局开启并勾选了 Email 或 Webhook 相关的预约通知。');
    }
  }

  const stmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  
  db.transaction(() => {
    for (const key of bodyKeys) {
      const value = updates[key];
      if (value !== undefined) {
        const stringValue = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
        insertStmt.run(key, stringValue);
        stmt.run(stringValue, key);
      }
    }
    recordAuditLog('update_settings', updates);
  })();

  if (updates.cron_no_show_scan_interval_minutes !== undefined) {
    startNoShowScanner(); // Restart the scanner with new interval
  }

  let backupSettingsChanged = false;
  if (updates.auto_backup_enabled !== undefined || updates.auto_backup_cron !== undefined || updates.auto_backup_retention !== undefined) {
    backupSettingsChanged = true;
  }
  
  if (backupSettingsChanged) {
    reloadBackupCron();
  }

  if (
    updates['email.events.booking_upcoming.enabled'] !== undefined ||
    updates['webhook.events.booking_upcoming.enabled'] !== undefined ||
    updates['booking_upcoming_advance_minutes'] !== undefined
  ) {
    startUpcomingReminderCron();
  }

  if (
    updates['email.events.booking_ending.enabled'] !== undefined ||
    updates['webhook.events.booking_ending.enabled'] !== undefined ||
    updates['booking_ending_advance_minutes'] !== undefined
  ) {
    startEndingReminderCron();
  }
}
