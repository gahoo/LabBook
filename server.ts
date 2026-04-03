import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import cronParser from 'cron-parser';
import { addDays, format, isBefore, parseISO, startOfDay, endOfDay, isAfter } from 'date-fns';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const db = new Database('lab_equipment.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT, -- New field
    location TEXT, -- New field
    cron_availability TEXT,
    availability_json TEXT, -- New JSON structure
    auto_approve INTEGER DEFAULT 1,
    price_type TEXT NOT NULL,
    price REAL NOT NULL,
    consumable_fee REAL DEFAULT 0,
    whitelist_enabled INTEGER DEFAULT 0,
    whitelist_data TEXT
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
    modified_count INTEGER DEFAULT 0, -- New field
    notes TEXT, -- New field
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
`);

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS whitelist_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      supervisor TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (equipment_id) REFERENCES equipment(id)
    )
  `);
} catch (e) {}

try {
  db.exec(`ALTER TABLE reservations ADD COLUMN violation_type TEXT`);
  db.exec(`ALTER TABLE reservations ADD COLUMN violation_time TEXT`);
} catch (e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS penalty_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      window_type TEXT NOT NULL,
      window_value INTEGER NOT NULL,
      window_unit TEXT NOT NULL,
      duration_type TEXT NOT NULL,
      duration_value INTEGER,
      duration_unit TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_penalties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      rule_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (rule_id) REFERENCES penalty_rules(id)
    )
  `);
  
  try {
    db.prepare('ALTER TABLE penalty_rules ADD COLUMN penalty_method TEXT DEFAULT \'BAN\'').run();
  } catch (e) {
    // Column might already exist
  }
  
  const rulesCount = db.prepare('SELECT COUNT(*) as count FROM penalty_rules').get() as any;
  if (rulesCount.count === 0) {
    const insertRule = db.prepare(`
      INSERT INTO penalty_rules (name, description, trigger_type, threshold, window_type, window_value, window_unit, duration_type, duration_value, duration_unit, is_active, penalty_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertRule.run('频繁逾期限制', '近30天内逾期达到3次，将限制借用（需管理员审批），直到旧的逾期记录移出统计周期。', 'overdue', 3, 'ROLLING', 30, 'days', 'DYNAMIC', null, null, 1, 'REQUIRE_APPROVAL');
    insertRule.run('频繁爽约封禁', '近30天内爽约达到2次，固定封禁7天。', 'no-show', 2, 'ROLLING', 30, 'days', 'FIXED', 7, 'days', 1, 'BAN');
  }
} catch (e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  
  // Insert default settings if they don't exist
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('app_name', 'LabBook');
  insertSetting.run('default_route', '/');
  insertSetting.run('app_logo', '');
  insertSetting.run('violation_late_grace_minutes', '15');
  insertSetting.run('violation_overtime_grace_minutes', '15');
  insertSetting.run('violation_late_cancel_hours', '2');
  insertSetting.run('violation_no_show_grace_minutes', '30');
  insertSetting.run('cron_no_show_scan_interval_minutes', '15');
} catch (e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS violation_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,           
        reservation_id INTEGER,             
        violation_type TEXT NOT NULL,       
        violation_time DATETIME NOT NULL,   
        status TEXT DEFAULT 'active',       
        remark TEXT,                        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_violation_stats ON violation_records(student_id, violation_type, status, violation_time)
  `);
} catch (e) {}

const adminAuth = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${ADMIN_PASSWORD}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

function evaluatePenaltiesOnViolation(student_id: string, trigger_type: string) {
  const rules = db.prepare('SELECT * FROM penalty_rules WHERE trigger_type = ? AND is_active = 1').all(trigger_type) as any[];
  
  for (const rule of rules) {
    let windowStart = new Date();
    if (rule.window_type === 'ROLLING') {
      if (rule.window_unit === 'days') windowStart.setDate(windowStart.getDate() - rule.window_value);
      if (rule.window_unit === 'weeks') windowStart.setDate(windowStart.getDate() - rule.window_value * 7);
      if (rule.window_unit === 'months') windowStart.setMonth(windowStart.getMonth() - rule.window_value);
    } else if (rule.window_type === 'NATURAL') {
      if (rule.window_unit === 'months') {
        windowStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
      } else if (rule.window_unit === 'weeks') {
        const day = windowStart.getDay();
        const diff = windowStart.getDate() - day + (day === 0 ? -6 : 1);
        windowStart = new Date(windowStart.setDate(diff));
        windowStart.setHours(0,0,0,0);
      } else if (rule.window_unit === 'days') {
        windowStart.setHours(0,0,0,0);
      }
    }

    const windowStartStr = windowStart.toISOString();
    
    const countRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violation_records 
      WHERE student_id = ? 
        AND status = 'active' 
        AND violation_type = ? 
        AND violation_time >= ?
    `).get(student_id, trigger_type, windowStartStr) as any;

    if (countRow.count >= rule.threshold) {
      const now = new Date().toISOString();
      
      if (rule.duration_type === 'FIXED') {
        const existing = db.prepare('SELECT * FROM user_penalties WHERE student_id = ? AND rule_id = ? AND end_time > ? AND status = \'active\'').get(student_id, rule.id, now) as any;
        
        if (!existing) {
          const penaltyEnd = new Date();
          if (rule.duration_unit === 'days') penaltyEnd.setDate(penaltyEnd.getDate() + rule.duration_value);
          if (rule.duration_unit === 'weeks') penaltyEnd.setDate(penaltyEnd.getDate() + rule.duration_value * 7);
          if (rule.duration_unit === 'months') penaltyEnd.setMonth(penaltyEnd.getMonth() + rule.duration_value);
          
          db.prepare(`
            INSERT INTO user_penalties (student_id, rule_id, start_time, end_time, status)
            VALUES (?, ?, ?, ?, 'active')
          `).run(student_id, rule.id, now, penaltyEnd.toISOString());
          
          if (rule.penalty_method === 'BAN') {
            db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE student_id = ? AND status = 'pending' AND start_time > ?`).run(student_id, now);
          }
        }
      } else if (rule.duration_type === 'DYNAMIC') {
        if (rule.penalty_method === 'BAN') {
          db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE student_id = ? AND status = 'pending' AND start_time > ?`).run(student_id, now);
        }
      }
    }
  }
}

function checkUserPenalty(student_id: string) {
  const now = new Date().toISOString();
  const activeFixed = db.prepare(`
    SELECT up.*, pr.name as rule_name, pr.penalty_method FROM user_penalties up
    JOIN penalty_rules pr ON up.rule_id = pr.id
    WHERE up.student_id = ? AND up.status = 'active' AND up.end_time > ?
  `).get(student_id, now) as any;

  if (activeFixed) {
    return { 
      isPenalized: true, 
      penaltyMethod: activeFixed.penalty_method || 'BAN',
      reason: `触发惩罚规则：${activeFixed.rule_name}。${activeFixed.penalty_method === 'REQUIRE_APPROVAL' ? '您的预约需要管理员审批。' : `您当前处于封禁期，解封时间：${format(new Date(activeFixed.end_time), 'yyyy-MM-dd HH:mm')}。`}` 
    };
  }

  const activeRules = db.prepare('SELECT * FROM penalty_rules WHERE is_active = 1 AND duration_type = \'DYNAMIC\'').all() as any[];
  
  for (const rule of activeRules) {
    let windowStart = new Date();
    if (rule.window_type === 'ROLLING') {
      if (rule.window_unit === 'days') windowStart.setDate(windowStart.getDate() - rule.window_value);
      if (rule.window_unit === 'weeks') windowStart.setDate(windowStart.getDate() - rule.window_value * 7);
      if (rule.window_unit === 'months') windowStart.setMonth(windowStart.getMonth() - rule.window_value);
    } else if (rule.window_type === 'NATURAL') {
      if (rule.window_unit === 'months') {
        windowStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
      } else if (rule.window_unit === 'weeks') {
        const day = windowStart.getDay();
        const diff = windowStart.getDate() - day + (day === 0 ? -6 : 1);
        windowStart = new Date(windowStart.setDate(diff));
        windowStart.setHours(0,0,0,0);
      } else if (rule.window_unit === 'days') {
        windowStart.setHours(0,0,0,0);
      }
    }

    const windowStartStr = windowStart.toISOString();
    const countRes = db.prepare(`
      SELECT COUNT(*) as count FROM violation_records 
      WHERE student_id = ? AND status = 'active' AND violation_type = ? AND violation_time >= ?
    `).get(student_id, rule.trigger_type, windowStartStr) as any;

    if (countRes.count >= rule.threshold) {
      return { 
        isPenalized: true, 
        penaltyMethod: rule.penalty_method || 'BAN',
        reason: `触发动态惩罚规则：${rule.name}。${rule.penalty_method === 'REQUIRE_APPROVAL' ? '您的预约需要管理员审批。' : '您在统计周期内违规次数已达标，暂时无法预约。'}` 
      };
    }
  }

  return { isPenalized: false, penaltyMethod: 'NONE', reason: '' };
}

// API Routes

// --- Penalty Rules API ---
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
    const { name, description, trigger_type, threshold, window_type, window_value, window_unit, duration_type, duration_value, duration_unit, is_active } = req.body;
    const stmt = db.prepare(`
      INSERT INTO penalty_rules (name, description, trigger_type, threshold, window_type, window_value, window_unit, duration_type, duration_value, duration_unit, is_active, penalty_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name, description, trigger_type, threshold, window_type, window_value, window_unit, duration_type, duration_value || null, duration_unit || null, is_active ? 1 : 0, req.body.penalty_method || 'BAN');
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create penalty rule' });
  }
});

app.put('/api/admin/penalty-rules/:id', adminAuth, (req, res) => {
  try {
    const { name, description, trigger_type, threshold, window_type, window_value, window_unit, duration_type, duration_value, duration_unit, is_active } = req.body;
    const stmt = db.prepare(`
      UPDATE penalty_rules 
      SET name = ?, description = ?, trigger_type = ?, threshold = ?, window_type = ?, window_value = ?, window_unit = ?, duration_type = ?, duration_value = ?, duration_unit = ?, is_active = ?, penalty_method = ?
      WHERE id = ?
    `);
    stmt.run(name, description, trigger_type, threshold, window_type, window_value, window_unit, duration_type, duration_value || null, duration_unit || null, is_active ? 1 : 0, req.body.penalty_method || 'BAN', req.params.id);
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

// Get settings
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsMap = settings.reduce((acc: any, curr: any) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  res.json(settingsMap);
});

// Update settings (Admin)
app.post('/api/admin/settings', adminAuth, (req, res) => {
  const { 
    app_name, default_route, app_logo,
    violation_late_grace_minutes,
    violation_overtime_grace_minutes,
    violation_late_cancel_hours,
    violation_no_show_grace_minutes,
    cron_no_show_scan_interval_minutes
  } = req.body;
  
  const stmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  
  const updateSetting = (key: string, value: any) => {
    if (value !== undefined) {
      insertStmt.run(key, value.toString());
      stmt.run(value.toString(), key);
    }
  };

  updateSetting('app_name', app_name);
  updateSetting('default_route', default_route);
  updateSetting('app_logo', app_logo);
  updateSetting('violation_late_grace_minutes', violation_late_grace_minutes);
  updateSetting('violation_overtime_grace_minutes', violation_overtime_grace_minutes);
  updateSetting('violation_late_cancel_hours', violation_late_cancel_hours);
  updateSetting('violation_no_show_grace_minutes', violation_no_show_grace_minutes);
  
  if (cron_no_show_scan_interval_minutes !== undefined) {
    updateSetting('cron_no_show_scan_interval_minutes', cron_no_show_scan_interval_minutes);
    startNoShowScanner(); // Restart the scanner with new interval
  }
  
  res.json({ success: true });
});

// 1. Get all equipment
app.get('/api/equipment', (req, res) => {
  const equipment = db.prepare('SELECT * FROM equipment').all();
  res.json(equipment);
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: '密码错误' });
  }
});

// 2. Add equipment (Admin)
app.post('/api/admin/equipment', adminAuth, (req, res) => {
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots } = req.body;
  
  const stmt = db.prepare(`
    INSERT INTO equipment (name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    SET name = ?, description = ?, image_url = ?, location = ?, availability_json = ?, auto_approve = ?, price_type = ?, price = ?, consumable_fee = ?, whitelist_enabled = ?, whitelist_data = ?, is_hidden = ?, release_noshow_slots = ?
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
            SET ${updateFields.join(', ')}
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

    const reservationsRaw = db.prepare(`
      SELECT * FROM reservations 
      WHERE equipment_id = ? 
      AND status IN ('pending', 'approved', 'active')
      AND date(start_time) IN (date(?, '-1 day'), date(?), date(?, '+1 day'))
    `).all(eq.id, date, date, date);

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
      reservations,
      maxDurationMinutes: availability.maxDurationMinutes || 60,
      minDurationMinutes: availability.minDurationMinutes || 30
    };
  });

  res.json(results);
});

// 3. Get availability for an equipment on a specific date
app.get('/api/equipment/:id/availability', (req, res) => {
  const { id } = req.params;
  const { date } = req.query; // YYYY-MM-DD
  
  if (!date || typeof date !== 'string') {
    return res.status(400).json({ error: '需要提供日期' });
  }

  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as any;
  if (!equipment) {
    return res.status(404).json({ error: '未找到该仪器' });
  }

  const targetDate = parseISO(date);
  const dayOfWeek = targetDate.getDay(); // 0 (Sun) to 6 (Sat)
  
  let availability;
  try {
    availability = JSON.parse(equipment.availability_json || '{"rules":[], "advanceDays": 7, "maxDurationMinutes": 60, "minDurationMinutes": 30}');
  } catch (e) {
    availability = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  }

  // Check if date is within advance booking range
  const today = startOfDay(new Date());
  const maxDate = addDays(today, availability.advanceDays || 7);
  if (isAfter(targetDate, maxDate)) {
    return res.json({ availableSlots: [], message: `仅支持提前 ${availability.advanceDays} 天预约` });
  }

  const rules = availability.rules.filter((r: any) => r.day === dayOfWeek);
  const availableSlots: { start: string, end: string }[] = [];

  rules.forEach((rule: any) => {
    availableSlots.push({
      start: `${date}T${rule.start}:00`,
      end: `${date}T${rule.end}:00`
    });
  });

  // Fetch existing reservations for this date and adjacent dates to handle timezone offsets
  const reservationsRaw = db.prepare(`
    SELECT id, start_time, end_time, actual_start_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND date(start_time) IN (date(?, '-1 day'), date(?), date(?, '+1 day'))
  `).all(id, date, date, date);

  let reservations = reservationsRaw;
  if (equipment.release_noshow_slots) {
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

  res.json({ 
    availableSlots, 
    reservations, 
    maxDurationMinutes: availability.maxDurationMinutes,
    minDurationMinutes: availability.minDurationMinutes || 30
  });
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

// 4. Create reservation
app.post('/api/reservations', (req, res) => {
  const { equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time } = req.body;
  
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id) as any;
  if (!equipment) return res.status(404).json({ error: '未找到该仪器' });
  
  const penaltyCheck = checkUserPenalty(student_id);
  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    return res.status(403).json({ error: penaltyCheck.reason });
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
  const maxDuration = availability.maxDurationMinutes || 60;
  const minDuration = availability.minDurationMinutes || 30;

  if (durationMinutes > maxDuration) return res.status(400).json({ error: `预约时长不能超过 ${maxDuration} 分钟` });
  if (durationMinutes < minDuration) return res.status(400).json({ error: `预约时长不能少于 ${minDuration} 分钟` });

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + (availability.advanceDays || 7));
  maxDate.setHours(23, 59, 59, 999);
  
  if (start > maxDate) {
    return res.status(400).json({ error: `只能提前 ${availability.advanceDays || 7} 天预约` });
  }

  const dayOfWeek = start.getDay();
  const dayRules = availability.rules.filter((r: any) => r.day === dayOfWeek);
  
  let isOutOfHours = false;
  if (dayRules.length === 0) {
    if (!availability.allowOutOfHours) {
      return res.status(400).json({ error: '所选日期仪器不开放' });
    }
    isOutOfHours = true;
  } else {
    const tz_offset = req.body.tz_offset || 0;
    const startLocalMinutes = (start.getUTCHours() * 60 + start.getUTCMinutes() - tz_offset + 1440) % 1440;
    let endLocalMinutes = (end.getUTCHours() * 60 + end.getUTCMinutes() - tz_offset + 1440) % 1440;
    if (endLocalMinutes === 0) endLocalMinutes = 24 * 60;

    const fallsWithinAnyRule = dayRules.some((rule: any) => {
      const rsMins = parseInt(rule.start.split(':')[0]) * 60 + parseInt(rule.start.split(':')[1]);
      const reMins = parseInt(rule.end.split(':')[0]) * 60 + parseInt(rule.end.split(':')[1]);
      return startLocalMinutes >= rsMins && endLocalMinutes <= reMins;
    });

    if (!fallsWithinAnyRule) {
      if (!availability.allowOutOfHours) {
        const validRanges = dayRules.map((r: any) => `${r.start}-${r.end}`).join(', ');
        return res.status(400).json({ error: `所选时间不在仪器开放范围内 (${validRanges})` });
      }
      isOutOfHours = true;
    }
  }

  // Check if slot is already booked
  const existingRaw = db.prepare(`
    SELECT id, start_time, actual_start_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND ((start_time <= ? AND end_time > ?) OR (start_time < ? AND end_time >= ?))
  `).all(equipment_id, start_time, start_time, end_time, end_time);

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
    return res.status(400).json({ error: '该时间段已被预约' });
  }

  const booking_code = crypto.randomBytes(4).toString('hex').toUpperCase();
  let status = isOutOfHours || !equipment.auto_approve ? 'pending' : 'approved';
  
  if (penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL') {
    status = 'pending';
  }

  const stmt = db.prepare(`
    INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code);

  res.json({ 
    id: info.lastInsertRowid, 
    booking_code, 
    status,
    message: penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL' ? penaltyCheck.reason : undefined
  });
});

// Whitelist Application
app.post('/api/whitelist/apply', (req, res) => {
  const { equipment_id, student_id, student_name, supervisor, phone, email } = req.body;
  
  const stmt = db.prepare(`
    INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(equipment_id, student_id, student_name, supervisor, phone, email);
  
  res.json({ success: true });
});

// Admin get whitelist applications
app.get('/api/admin/whitelist/applications', adminAuth, (req, res) => {
  const apps = db.prepare(`
    SELECT wa.*, e.name as equipment_name 
    FROM whitelist_applications wa
    JOIN equipment e ON wa.equipment_id = e.id
    ORDER BY wa.created_at DESC
  `).all();
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
  
  db.prepare('UPDATE equipment SET whitelist_data = ? WHERE id = ?').run(whitelist.join('\n'), app.equipment_id);
  db.prepare("UPDATE whitelist_applications SET status = 'approved' WHERE id = ?").run(id);
  
  res.json({ success: true });
});

// Admin reject whitelist application
app.post('/api/admin/whitelist/applications/:id/reject', adminAuth, (req, res) => {
  const { id } = req.params;
  db.prepare("UPDATE whitelist_applications SET status = 'rejected' WHERE id = ?").run(id);
  res.json({ success: true });
});

// 5. Get reservation by code
app.get('/api/reservations/:code', (req, res) => {
  const { code } = req.params;
  const reservation = db.prepare(`
    SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee, e.release_noshow_slots 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.booking_code = ?
  `).get(code);

  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  res.json(reservation);
});

// 6. Cancel reservation
app.post('/api/reservations/cancel', (req, res) => {
  const { booking_code } = req.body;
  
  try {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new Error('未找到该预约');
      if (reservation.status !== 'pending' && reservation.status !== 'approved') {
        throw new Error('无法取消进行中或已完成的预约');
      }
      
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const startTime = new Date(reservation.start_time).getTime();
      const now = Date.now();
      if (now > startTime + maxLateMinutes * 60000) {
        throw new Error(`超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改`);
      }

      const nowStr = new Date(now).toISOString();
      db.prepare("UPDATE reservations SET status = 'cancelled', actual_end_time = ? WHERE booking_code = ?").run(nowStr, booking_code);
      
      const lateCancelRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_cancel_hours'").get() as any;
      const lateCancelHours = lateCancelRow ? parseInt(lateCancelRow.value, 10) : 2;
      
      let isLateCancel = false;
      if (now >= startTime - lateCancelHours * 60 * 60 * 1000) {
        isLateCancel = true;
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'late_cancel', nowStr);
      }
      
      return { isLateCancel, student_id: reservation.student_id };
    })();
    
    if (result.isLateCancel) {
      evaluatePenaltiesOnViolation(result.student_id, 'late_cancel');
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Update reservation (User)
app.post('/api/reservations/update', (req, res) => {
  const { booking_code, start_time, end_time } = req.body;
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

  const penaltyCheck = checkUserPenalty(reservation.student_id);
  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    return res.status(403).json({ error: penaltyCheck.reason });
  }

  const start = new Date(start_time);
  const end = new Date(end_time);
  
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

  const maxDuration = availability.maxDurationMinutes || 60;
  const minDuration = availability.minDurationMinutes || 30;

  if (durationMinutes > maxDuration) return res.status(400).json({ error: `预约时长不能超过 ${maxDuration} 分钟` });
  if (durationMinutes < minDuration) return res.status(400).json({ error: `预约时长不能少于 ${minDuration} 分钟` });

  const now = new Date();
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + (availability.advanceDays || 7));
  maxDate.setHours(23, 59, 59, 999);
  
  if (start > maxDate) {
    return res.status(400).json({ error: `只能提前 ${availability.advanceDays || 7} 天预约` });
  }
  if (start < now) {
    return res.status(400).json({ error: '不能预约过去的时间' });
  }

  const dayOfWeek = start.getDay();
  const dayRules = availability.rules.filter((r: any) => r.day === dayOfWeek);
  
  let isOutOfHours = false;
  if (dayRules.length === 0) {
    if (!availability.allowOutOfHours) {
      return res.status(400).json({ error: '所选日期仪器不开放' });
    }
    isOutOfHours = true;
  } else {
    const tz_offset = req.body.tz_offset || 0;
    const startLocalMinutes = (start.getUTCHours() * 60 + start.getUTCMinutes() - tz_offset + 1440) % 1440;
    let endLocalMinutes = (end.getUTCHours() * 60 + end.getUTCMinutes() - tz_offset + 1440) % 1440;
    if (endLocalMinutes === 0) endLocalMinutes = 24 * 60;

    const fallsWithinAnyRule = dayRules.some((rule: any) => {
      const rsMins = parseInt(rule.start.split(':')[0]) * 60 + parseInt(rule.start.split(':')[1]);
      const reMins = parseInt(rule.end.split(':')[0]) * 60 + parseInt(rule.end.split(':')[1]);
      return startLocalMinutes >= rsMins && endLocalMinutes <= reMins;
    });

    if (!fallsWithinAnyRule) {
      if (!availability.allowOutOfHours) {
        const validRanges = dayRules.map((r: any) => `${r.start}-${r.end}`).join(', ');
        return res.status(400).json({ error: `所选时间不在仪器开放范围内 (${validRanges})` });
      }
      isOutOfHours = true;
    }
  }

  // Check conflicts (excluding self)
  const conflictRaw = db.prepare(`
    SELECT id, start_time, actual_start_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active') AND id != ?
    AND ((start_time <= ? AND end_time > ?) OR (start_time < ? AND end_time >= ?))
  `).all(reservation.equipment_id, reservation.id, start_time, start_time, end_time, end_time);

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
    return res.status(400).json({ error: '所选时间段已有其他预约' });
  }

  let newStatus = isOutOfHours || !equipment.auto_approve ? 'pending' : 'approved';
  
  if (penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL') {
    newStatus = 'pending';
  }

  const stmt = db.prepare(`
    UPDATE reservations 
    SET start_time = ?, end_time = ?, modified_count = modified_count + 1, status = ?
    WHERE id = ?
  `);
  stmt.run(start_time, end_time, newStatus, reservation.id);
  
  res.json({ success: true });
});

// 7. Check-in
app.post('/api/reservations/checkin', (req, res) => {
  const { booking_code, consumable_quantity } = req.body;
  
  try {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new Error('未找到该预约');
      if (reservation.status !== 'approved') throw new Error('预约未通过审批或已开始');

      const now = new Date();
      const startTime = new Date(reservation.start_time);
      
      const scheduledStart = new Date(reservation.start_time);
      const earliestCheckin = new Date(scheduledStart.getTime() - 30 * 60 * 1000);
      if (now.getTime() < earliestCheckin.getTime()) {
        throw new Error(`只能在预约开始前 30 分钟内上机。您的预约开始时间为 ${format(scheduledStart, 'HH:mm')}，请在 ${format(earliestCheckin, 'HH:mm')} 后重试。`);
      }

      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
      if (diffMinutes > maxLateMinutes) {
        throw new Error(`已超过预约开始时间${maxLateMinutes}分钟，不允许上机`);
      }

      const nowStr = now.toISOString();
      db.prepare("UPDATE reservations SET status = 'active', actual_start_time = ?, consumable_quantity = ? WHERE booking_code = ?").run(nowStr, consumable_quantity || 0, booking_code);
      
      const lateGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_grace_minutes'").get() as any;
      const lateGraceMinutes = lateGraceRow ? parseInt(lateGraceRow.value, 10) : 15;
      
      let isLate = false;
      if (diffMinutes > lateGraceMinutes) {
        isLate = true;
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'late', nowStr);
      }
      
      return { nowStr, isLate, student_id: reservation.student_id };
    })();
    
    if (result.isLate) {
      evaluatePenaltiesOnViolation(result.student_id, 'late');
    }
    
    res.json({ success: true, actual_start_time: result.nowStr });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
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
      
      if (!reservation) throw new Error('未找到该预约');
      if (reservation.status !== 'active') throw new Error('预约未在进行中');

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

      const overtimeGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_overtime_grace_minutes'").get() as any;
      const overtimeGraceMinutes = overtimeGraceRow ? parseInt(overtimeGraceRow.value, 10) : 15;
      const overtimeThreshold = overtimeGraceMinutes * 60 * 1000;
      
      const end = new Date(reservation.end_time);
      let isOvertime = false;
      if (now.getTime() > end.getTime() + overtimeThreshold) {
        total_cost *= 2;
        isOvertime = true;
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'overdue', nowStr);
      }

      db.prepare("UPDATE reservations SET status = 'completed', actual_end_time = ?, total_cost = ?, consumable_quantity = ? WHERE booking_code = ?").run(nowStr, total_cost, finalConsumableQty, booking_code);
      
      return { nowStr, total_cost, finalConsumableQty, isOvertime, student_id: reservation.student_id };
    })();
    
    if (result.isOvertime) {
      evaluatePenaltiesOnViolation(result.student_id, 'overdue');
    }
    
    res.json({ success: true, actual_end_time: result.nowStr, total_cost: result.total_cost, consumable_quantity: result.finalConsumableQty });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin get all reservations
app.get('/api/admin/reservations', adminAuth, (req, res) => {
  const reservations = db.prepare(`
    SELECT r.*, e.name as equipment_name 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    ORDER BY r.start_time DESC
  `).all();
  res.json(reservations);
});

// Admin update reservation
app.put('/api/admin/reservations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { student_id, student_name, supervisor, phone, email, start_time, end_time, status } = req.body;
  
  const stmt = db.prepare(`
    UPDATE reservations 
    SET student_id = ?, student_name = ?, supervisor = ?, phone = ?, email = ?, start_time = ?, end_time = ?, status = ?
    WHERE id = ?
  `);
  stmt.run(student_id, student_name, supervisor, phone, email, start_time, end_time, status, id);
  
  updateReservationViolation(Number(id));
  
  res.json({ success: true });
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

// 9. Admin Reports
app.put('/api/admin/reports/reservations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { actual_start_time, actual_end_time, consumable_quantity, notes } = req.body;
  
  const oldRes = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as any;
  if (!oldRes) return res.status(404).json({ error: '未找到该预约' });

  let total_cost = oldRes.total_cost;
  if (actual_start_time && actual_end_time) {
    const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(oldRes.equipment_id) as any;
    const start = new Date(actual_start_time);
    const end = new Date(actual_end_time);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    
    if (eq.price_type === 'hour') {
      total_cost = hours * eq.price;
    } else {
      total_cost = eq.price;
    }
    if (eq.consumable_fee > 0 && consumable_quantity > 0) {
      total_cost += eq.consumable_fee * consumable_quantity;
    }

    const overtimeThreshold = 30 * 60 * 1000;
    const scheduledEnd = new Date(oldRes.end_time);
    if (end.getTime() > scheduledEnd.getTime() + overtimeThreshold) {
      total_cost *= 2;
    }
  }

  let newStatus = oldRes.status;
  if (actual_end_time && (oldRes.status === 'active' || oldRes.status === 'approved')) {
    newStatus = 'completed';
  }

  const stmt = db.prepare(`
    UPDATE reservations 
    SET actual_start_time = ?, actual_end_time = ?, consumable_quantity = ?, total_cost = ?, notes = ?, status = ?
    WHERE id = ?
  `);
  stmt.run(actual_start_time, actual_end_time, consumable_quantity, total_cost, notes, newStatus, id);
  
  const newRes = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as any;
  
  db.prepare(`
    INSERT INTO audit_logs (reservation_id, action, old_data, new_data)
    VALUES (?, ?, ?, ?)
  `).run(id, 'Admin modified actual times/consumables/notes', JSON.stringify(oldRes), JSON.stringify(newRes));
  
  updateReservationViolation(Number(id));
  
  res.json({ success: true, total_cost });
});

app.delete('/api/admin/reports/reservations/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const oldRes = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as any;
  if (!oldRes) return res.status(404).json({ error: '未找到该预约' });

  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);

  db.prepare(`
    INSERT INTO audit_logs (reservation_id, action, old_data, new_data)
    VALUES (?, ?, ?, ?)
  `).run(id, 'Admin deleted reservation from reports', JSON.stringify(oldRes), null);

  res.json({ success: true });
});

app.get('/api/admin/violation-records', adminAuth, (req, res) => {
  const records = db.prepare(`
    SELECT v.*, r.student_name, r.equipment_id, e.name as equipment_name, r.start_time, r.end_time
    FROM violation_records v
    LEFT JOIN reservations r ON v.reservation_id = r.id
    LEFT JOIN equipment e ON r.equipment_id = e.id
    ORDER BY v.violation_time DESC
  `).all();
  res.json(records);
});

app.post('/api/admin/violation-records/:id/revoke', adminAuth, (req, res) => {
  const { id } = req.params;
  db.prepare("UPDATE violation_records SET status = 'revoked' WHERE id = ?").run(id);
  res.json({ success: true });
});

app.get('/api/admin/reports/violations', adminAuth, (req, res) => {
  const VIOLATION_WINDOW_DAYS = 30;
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - VIOLATION_WINDOW_DAYS);
  const windowStartStr = windowStart.toISOString();

  const violationsRaw = db.prepare(`
    SELECT v.*, r.student_name, r.supervisor
    FROM violation_records v
    LEFT JOIN reservations r ON v.reservation_id = r.id
    WHERE v.violation_time >= ? AND v.status = 'active'
  `).all(windowStartStr) as any[];

  const personMap = new Map();

  violationsRaw.forEach((v: any) => {
    const personKey = `${v.student_id}`;
    if (!personMap.has(personKey)) {
      personMap.set(personKey, {
        student_id: v.student_id,
        student_name: v.student_name || '未知',
        supervisor: v.supervisor || '未知',
        late_count: 0,
        late_duration: 0,
        overtime_count: 0,
        overtime_duration: 0,
        noshow_count: 0,
        cancelled_count: 0,
        late_cancelled_count: 0
      });
    }
    
    const p = personMap.get(personKey);
    if (p.student_name === '未知' && v.student_name) p.student_name = v.student_name;
    if (p.supervisor === '未知' && v.supervisor) p.supervisor = v.supervisor;

    if (v.violation_type === 'late') p.late_count++;
    if (v.violation_type === 'overdue') p.overtime_count++;
    if (v.violation_type === 'no-show') p.noshow_count++;
    if (v.violation_type === 'late_cancel') {
      p.cancelled_count++;
      p.late_cancelled_count++;
    }
  });

  const violations = Array.from(personMap.values()).map(p => {
    const penaltyScore = p.late_count + p.overtime_count + p.noshow_count;
    let suggestedPenalty = '无';
    
    if (penaltyScore >= 5) {
      suggestedPenalty = '暂停预约30天';
    } else if (penaltyScore >= 3) {
      suggestedPenalty = '暂停预约7天';
    } else if (penaltyScore >= 1) {
      suggestedPenalty = '警告';
    } else if (p.cancelled_count >= 5) {
      suggestedPenalty = '频繁取消警告';
    }

    return {
      ...p,
      total_violations: penaltyScore + p.late_cancelled_count,
      suggested_penalty: suggestedPenalty
    };
  }).sort((a, b) => b.total_violations - a.total_violations || b.cancelled_count - a.cancelled_count);

  res.json(violations);
});

app.get('/api/admin/reports', adminAuth, (req, res) => {
  const { period, student_name, supervisor, startDate, endDate } = req.query;
  
  let dateFormat = "'%Y-%m-%d'";
  if (period === 'week') dateFormat = "'%Y-%W'";
  if (period === 'month') dateFormat = "'%Y-%m'";
  if (period === 'quarter') dateFormat = "strftime('%Y', actual_start_time) || '-Q' || ((cast(strftime('%m', actual_start_time) as integer) + 2) / 3)";
  if (period === 'year') dateFormat = "'%Y'";
  
  const periodExpr = period === 'quarter' ? dateFormat : `strftime(${dateFormat}, actual_start_time)`;

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

  // Helper to calculate report status
  const calculateStatus = (res: any, prevRes: any) => {
    if (res.status === 'cancelled') {
      // If cancelled, check if it was cancelled within 30 minutes before start time or after start time
      if (res.actual_end_time) {
        const cancelTime = new Date(res.actual_end_time).getTime();
        const startTime = new Date(res.start_time).getTime();
        if (cancelTime >= startTime - 30 * 60 * 1000) {
          return '临期取消';
        }
      }
      return '已取消';
    }
    
    const maxLateMinutes = 30;
    
    if (!res.actual_start_time) {
      if (new Date().getTime() <= new Date(res.start_time).getTime() + maxLateMinutes * 60000) {
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

    const lateThreshold = 15 * 60 * 1000;
    const overtimeThreshold = 30 * 60 * 1000;
    const normalThreshold = 30 * 60 * 1000;

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
  };

  const allReservationsRaw = db.prepare(`
    SELECT r.*, e.name as equipment_name, e.release_noshow_slots, e.price_type, e.price, e.consumable_fee
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    ${whereClause}
    ORDER BY r.equipment_id, r.start_time ASC
  `).all(...params);

  const allReservations = allReservationsRaw.map((res: any, idx: number) => {
    const prevRes = idx > 0 && (allReservationsRaw[idx-1] as any).equipment_id === res.equipment_id ? (allReservationsRaw[idx-1] as any) : null;
    const reportStatus = calculateStatus(res, prevRes);
    
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
  }).filter((res: any) => !res.reportStatus.includes('已取消'));

  // Filter for stats: exclude cancelled, include completed and no-shows
  const statsReservations = allReservations.filter(r => (r.actual_start_time && r.status === 'completed') || r.reportStatus.includes('爽约'));

  // Grouping by time
  const timeMap = new Map();
  
  // Grouping by person and supervisor manually to ensure correct sorting and filtering
  const personMap = new Map();
  const supervisorMap = new Map();

  statsReservations.forEach(r => {
    let hours = 0;
    if (r.actual_start_time && r.actual_end_time) {
      hours = (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60);
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
      timeMap.set(pStr, { period: pStr, total_hours: 0, total_revenue: 0 });
    }
    const t = timeMap.get(pStr);
    t.total_hours += hours;
    t.total_revenue += revenue;

    // Person grouping
    const personKey = `${r.student_id}_${r.student_name}`;
    if (!personMap.has(personKey)) {
      personMap.set(personKey, { student_name: r.student_name, student_id: r.student_id, supervisor: r.supervisor, total_hours: 0, total_revenue: 0 });
    }
    const p = personMap.get(personKey);
    p.total_hours += hours;
    p.total_revenue += revenue;

    // Supervisor grouping
    if (!supervisorMap.has(r.supervisor)) {
      supervisorMap.set(r.supervisor, { supervisor: r.supervisor, total_hours: 0, total_revenue: 0 });
    }
    const s = supervisorMap.get(r.supervisor);
    s.total_hours += hours;
    s.total_revenue += revenue;
  });

  const usageByTime = Array.from(timeMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  const usageByPerson = Array.from(personMap.values()).sort((a, b) => b.total_hours - a.total_hours);
  const usageBySupervisor = Array.from(supervisorMap.values()).sort((a, b) => b.total_hours - a.total_hours);

  res.json({ usageByTime, usageByPerson, usageBySupervisor, allReservations });
});

app.get('/api/admin/audit-logs', adminAuth, (req, res) => {
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
            db.prepare("UPDATE reservations SET status = 'cancelled', actual_end_time = ? WHERE id = ?").run(nowStr, res.id);
            db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(res.student_id, res.id, 'no-show', nowStr);
            
            evaluatePenaltiesOnViolation(res.student_id, 'no-show');
          }
        })();
      }
    }
  } catch (error) {
    console.error("Error scanning for no-shows:", error);
  }
}

async function startServer() {
  startNoShowScanner();
  
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
