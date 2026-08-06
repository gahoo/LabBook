import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'crypto';

export function runMigrations(db: DatabaseType) {
  try {
    db.prepare("ALTER TABLE reservations ADD COLUMN notes TEXT").run();
  } catch (e) {
    // Column might already exist
  }
  
  try {
    // Remove foreign key constraint from audit_logs
    const tableInfo = db.prepare("PRAGMA table_info(audit_logs)").all();
    if (tableInfo.length > 0) {
      const foreignKeyInfo = db.prepare("PRAGMA foreign_key_list(audit_logs)").all();
      if (foreignKeyInfo.length > 0) {
        db.exec(`
          CREATE TABLE audit_logs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reservation_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            old_data TEXT,
            new_data TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO audit_logs_new SELECT * FROM audit_logs;
          DROP TABLE audit_logs;
          ALTER TABLE audit_logs_new RENAME TO audit_logs;
        `);
      }
    }
  } catch (e) {
    console.error("Migration error:", e);
  }

  // Migration: Add new columns if they don't exist
  try {
    db.exec(`ALTER TABLE equipment ADD COLUMN availability_json TEXT`);
    db.exec(`ALTER TABLE reservations ADD COLUMN consumable_quantity REAL DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE equipment ADD COLUMN is_hidden INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE equipment ADD COLUMN release_noshow_slots INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE equipment ADD COLUMN whitelist_enabled INTEGER DEFAULT 0`);
    db.exec(`ALTER TABLE equipment ADD COLUMN whitelist_data TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE reservations ADD COLUMN modified_count INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE reservations ADD COLUMN violation_type TEXT`);
    db.exec(`ALTER TABLE reservations ADD COLUMN violation_time TEXT`);
  } catch (e) {}

  try {
    // Check if old columns exist
    const tableInfo = db.prepare("PRAGMA table_info(penalty_rules)").all() as any[];
    const hasTriggerType = tableInfo.some(col => col.name === 'trigger_type');
    if (hasTriggerType) {
      db.exec(`
        ALTER TABLE penalty_rules RENAME TO penalty_rules_old;
      `);
    }
  } catch(e) {}

  try {
    const rulesCount = db.prepare('SELECT COUNT(*) as count FROM penalty_rules').get() as any;
    if (rulesCount.count === 0) {
      const insertRule = db.prepare(`
        INSERT INTO penalty_rules (name, description, violation_type, trigger_config, action_config, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      insertRule.run('频繁爽约封禁', '近30天内爽约达到2次，固定封禁', 'no-show', '{"metric":"count","threshold":2,"period_days":30}', '{"type":"ban"}', 1);
      insertRule.run('频繁逾期限制', '近30天内逾期达到3次，将限制借用（需管理员审批）', 'overdue', '{"metric":"count","threshold":3,"period_days":30}', '{"type":"require_approval"}', 1);
    }
  } catch (e) {}

  try {
    // Insert default settings if they don't exist
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('app_name', 'LabBook');
    insertSetting.run('default_route', '/');
    insertSetting.run('app_logo', '');
    insertSetting.run('violation_late_grace_minutes', '15');
    insertSetting.run('violation_overtime_grace_minutes', '15');
    insertSetting.run('violation_late_cancel_minutes', '120');
    insertSetting.run('violation_no_show_grace_minutes', '30');
    insertSetting.run('cron_no_show_scan_interval_minutes', '15');
    insertSetting.run('auto_backup_enabled', 'false');
    insertSetting.run('auto_backup_cron', '0 3 * * *');
    insertSetting.run('auto_backup_retention', '7');
    insertSetting.run('calendar_subscription.enabled', 'false');
    insertSetting.run('booking_upcoming_advance_minutes', '30');
    insertSetting.run('booking_ending_advance_minutes', '15');
    insertSetting.run('jwt_expires_in_hours', '168');
    
    const hasSecret = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('calendar_sync_secret');
    if (!hasSecret) {
      insertSetting.run('calendar_sync_secret', crypto.randomBytes(32).toString('hex'));
    }
  } catch (e) {}

  try {
    const lateHoursRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_cancel_hours'").get() as any;
    if (lateHoursRow) {
      const hours = parseInt(lateHoursRow.value, 10);
      if (!isNaN(hours)) {
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('violation_late_cancel_minutes', ?)").run((hours * 60).toString());
      }
      db.prepare("DELETE FROM settings WHERE key = 'violation_late_cancel_hours'").run();
    }
  } catch (e) {}

  try {
    db.prepare('ALTER TABLE violation_records ADD COLUMN duration_minutes INTEGER').run();
  } catch (e) {}
}
