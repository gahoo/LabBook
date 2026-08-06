import { Database as DatabaseType } from 'better-sqlite3';

export function initializeSchema(db: DatabaseType) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      location TEXT,
      cron_availability TEXT,
      availability_json TEXT,
      auto_approve INTEGER DEFAULT 1,
      price_type TEXT NOT NULL,
      price REAL NOT NULL,
      consumable_fee REAL DEFAULT 0,
      whitelist_enabled INTEGER DEFAULT 0,
      whitelist_data TEXT,
      is_hidden INTEGER DEFAULT 0,
      release_noshow_slots INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS whitelist_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      supervisor TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- pending, approved, rejected
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      supervisor TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL,
      booking_code TEXT UNIQUE NOT NULL,
      actual_start_time TEXT,
      actual_end_time TEXT,
      total_cost REAL,
      consumable_quantity REAL DEFAULT 0,
      modified_count INTEGER DEFAULT 0,
      notes TEXT,
      violation_type TEXT,
      violation_time TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      old_data TEXT,
      new_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS penalty_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      violation_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      action_config TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS violation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      reservation_id INTEGER,
      violation_type TEXT NOT NULL,
      violation_time DATETIME NOT NULL,
      duration_minutes INTEGER,
      status TEXT DEFAULT 'active',
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_penalties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      rule_id INTEGER NOT NULL,
      penalty_method TEXT NOT NULL,
      restrictions TEXT,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      status TEXT DEFAULT 'active',
      contributing_violation_ids TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS penalty_waivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      rule_id INTEGER NOT NULL,
      violation_ids TEXT NOT NULL,
      user_penalty_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      channel TEXT NOT NULL,
      target TEXT,
      reference_code TEXT,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      next_retry_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_violation_stats ON violation_records(student_id, violation_type, status, violation_time);
  `);
}
