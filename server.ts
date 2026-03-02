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
`);

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

const adminAuth = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${ADMIN_PASSWORD}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// API Routes

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
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data } = req.body;
  
  const stmt = db.prepare(`
    INSERT INTO equipment (name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, description, image_url, location, availability_json, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0, whitelist_enabled ? 1 : 0, whitelist_data || '');
  
  res.json({ id: info.lastInsertRowid });
});

// Update equipment (Admin)
app.put('/api/admin/equipment/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data } = req.body;
  
  const stmt = db.prepare(`
    UPDATE equipment 
    SET name = ?, description = ?, image_url = ?, location = ?, availability_json = ?, auto_approve = ?, price_type = ?, price = ?, consumable_fee = ?, whitelist_enabled = ?, whitelist_data = ?
    WHERE id = ?
  `);
  stmt.run(name, description, image_url, location, availability_json, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0, whitelist_enabled ? 1 : 0, whitelist_data || '', id);
  
  res.json({ success: true });
});

app.get('/api/equipment/availability/today', (req, res) => {
  const date = format(new Date(), 'yyyy-MM-dd');
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
      const [startH, startM] = rule.start.split(':').map(Number);
      const [endH, endM] = rule.end.split(':').map(Number);
      
      const start = new Date(targetDate);
      start.setHours(startH, startM, 0, 0);
      
      const end = new Date(targetDate);
      end.setHours(endH, endM, 0, 0);
      
      return { start: start.toISOString(), end: end.toISOString() };
    });

    const reservations = db.prepare(`
      SELECT * FROM reservations 
      WHERE equipment_id = ? 
      AND status IN ('pending', 'approved', 'active')
      AND date(start_time) = ?
    `).all(eq.id, date);

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
    const [startH, startM] = rule.start.split(':').map(Number);
    const [endH, endM] = rule.end.split(':').map(Number);
    
    const slotStart = new Date(targetDate);
    slotStart.setHours(startH, startM, 0, 0);
    
    const slotEnd = new Date(targetDate);
    slotEnd.setHours(endH, endM, 0, 0);

    availableSlots.push({
      start: slotStart.toISOString(),
      end: slotEnd.toISOString()
    });
  });

  // Fetch existing reservations for this date
  const reservations = db.prepare(`
    SELECT start_time, end_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND date(start_time) = date(?)
  `).all(id, date);

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
  const rule = availability.rules.find((r: any) => r.day === dayOfWeek);
  
  let isOutOfHours = false;
  if (!rule) {
    if (!availability.allowOutOfHours) {
      return res.status(400).json({ error: '所选日期仪器不开放' });
    }
    isOutOfHours = true;
  } else {
    const ruleStart = new Date(start);
    const [rsH, rsM] = rule.start.split(':').map(Number);
    ruleStart.setHours(rsH, rsM, 0, 0);

    const ruleEnd = new Date(start);
    const [reH, reM] = rule.end.split(':').map(Number);
    ruleEnd.setHours(reH, reM, 0, 0);

    if (start < ruleStart || end > ruleEnd) {
      if (!availability.allowOutOfHours) {
        return res.status(400).json({ error: `所选时间不在仪器开放范围内 (${rule.start}-${rule.end})` });
      }
      isOutOfHours = true;
    }
  }

  // Check if slot is already booked
  const existing = db.prepare(`
    SELECT id FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND ((start_time <= ? AND end_time > ?) OR (start_time < ? AND end_time >= ?))
  `).get(equipment_id, start_time, start_time, end_time, end_time);

  if (existing) {
    return res.status(400).json({ error: '该时间段已被预约' });
  }

  const booking_code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const status = isOutOfHours ? 'pending' : (equipment.auto_approve ? 'approved' : 'pending');

  const stmt = db.prepare(`
    INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code);

  res.json({ id: info.lastInsertRowid, booking_code, status });
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
    SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee 
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
  const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'pending' && reservation.status !== 'approved') {
    return res.status(400).json({ error: '无法取消进行中或已完成的预约' });
  }

  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE booking_code = ?").run(booking_code);
  res.json({ success: true });
});

// Update reservation (User)
app.post('/api/reservations/update', (req, res) => {
  const { booking_code, start_time, end_time } = req.body;
  const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'pending' && reservation.status !== 'approved') {
    return res.status(400).json({ error: '无法修改进行中或已完成的预约' });
  }
  if (reservation.modified_count >= 1) {
    return res.status(400).json({ error: '每个预约仅允许修改一次时间，请取消后重新预约' });
  }

  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
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
  const rule = availability.rules.find((r: any) => r.day === dayOfWeek);
  
  let isOutOfHours = false;
  if (!rule) {
    if (!availability.allowOutOfHours) {
      return res.status(400).json({ error: '所选日期仪器不开放' });
    }
    isOutOfHours = true;
  } else {
    const ruleStart = new Date(start);
    const [rsH, rsM] = rule.start.split(':').map(Number);
    ruleStart.setHours(rsH, rsM, 0, 0);

    const ruleEnd = new Date(start);
    const [reH, reM] = rule.end.split(':').map(Number);
    ruleEnd.setHours(reH, reM, 0, 0);

    if (start < ruleStart || end > ruleEnd) {
      if (!availability.allowOutOfHours) {
        return res.status(400).json({ error: `所选时间不在仪器开放范围内 (${rule.start}-${rule.end})` });
      }
      isOutOfHours = true;
    }
  }

  // Check conflicts (excluding self)
  const conflict = db.prepare(`
    SELECT id FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active') AND id != ?
    AND ((start_time <= ? AND end_time > ?) OR (start_time < ? AND end_time >= ?))
  `).get(reservation.equipment_id, reservation.id, start_time, start_time, end_time, end_time);

  if (conflict) {
    return res.status(400).json({ error: '所选时间段已有其他预约' });
  }

  const newStatus = isOutOfHours ? 'pending' : (equipment.auto_approve ? 'approved' : 'pending');

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
  const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'approved') {
    return res.status(400).json({ error: '预约未通过审批或已开始' });
  }

  const now = new Date();
  const startTime = new Date(reservation.start_time);
  const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);

  if (diffMinutes > 30) {
    return res.status(400).json({ error: '已超过预约开始时间30分钟，不允许上机' });
  }

  const scheduledStart = new Date(reservation.start_time);
  
  // Only allow check-in 30 minutes before scheduled start
  const earliestCheckin = new Date(scheduledStart.getTime() - 30 * 60 * 1000);
  if (isBefore(now, earliestCheckin)) {
    return res.status(400).json({ error: `只能在预约开始前 30 分钟内上机。您的预约开始时间为 ${format(scheduledStart, 'HH:mm')}，请在 ${format(earliestCheckin, 'HH:mm')} 后重试。` });
  }

  const nowStr = now.toISOString();
  db.prepare("UPDATE reservations SET status = 'active', actual_start_time = ?, consumable_quantity = ? WHERE booking_code = ?").run(nowStr, consumable_quantity || 0, booking_code);
  res.json({ success: true, actual_start_time: nowStr });
});

// 8. Check-out
app.post('/api/reservations/checkout', (req, res) => {
  const { booking_code } = req.body;
  const reservation = db.prepare(`
    SELECT r.*, e.price_type, e.price, e.consumable_fee 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.booking_code = ?
  `).get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'active') {
    return res.status(400).json({ error: '预约未在进行中' });
  }

  const now = new Date().toISOString();
  const actualStart = new Date(reservation.actual_start_time);
  const actualEnd = new Date(now);
  const durationHours = (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60 * 60);
  
  let total_cost = (reservation.consumable_quantity || 0) * (reservation.consumable_fee || 0);
  if (reservation.price_type === 'hour') {
    total_cost += Math.ceil(durationHours) * reservation.price;
  } else {
    total_cost += reservation.price;
  }

  db.prepare("UPDATE reservations SET status = 'completed', actual_end_time = ?, total_cost = ? WHERE booking_code = ?").run(now, total_cost, booking_code);
  res.json({ success: true, actual_end_time: now, total_cost });
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
  const { actual_start_time, actual_end_time, consumable_quantity } = req.body;
  
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
  }

  const stmt = db.prepare(`
    UPDATE reservations 
    SET actual_start_time = ?, actual_end_time = ?, consumable_quantity = ?, total_cost = ?
    WHERE id = ?
  `);
  stmt.run(actual_start_time, actual_end_time, consumable_quantity, total_cost, id);
  
  const newRes = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as any;
  
  db.prepare(`
    INSERT INTO audit_logs (reservation_id, action, old_data, new_data)
    VALUES (?, ?, ?, ?)
  `).run(id, 'Admin modified actual times/consumables', JSON.stringify(oldRes), JSON.stringify(newRes));
  
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

app.get('/api/admin/reports', adminAuth, (req, res) => {
  const { period, student_name, supervisor, startDate, endDate } = req.query;
  
  let dateFormat = "'%Y-%m-%d'";
  if (period === 'week') dateFormat = "'%Y-%W'";
  if (period === 'month') dateFormat = "'%Y-%m'";
  if (period === 'quarter') dateFormat = "strftime('%Y', actual_start_time) || '-Q' || ((cast(strftime('%m', actual_start_time) as integer) + 2) / 3)";
  if (period === 'year') dateFormat = "'%Y'";
  
  const periodExpr = period === 'quarter' ? dateFormat : `strftime(${dateFormat}, actual_start_time)`;

  let whereClause = "WHERE 1=1";
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
    whereClause += " AND date(start_time) >= date(?)";
    params.push(startDate);
  }
  if (endDate) {
    whereClause += " AND date(start_time) <= date(?)";
    params.push(endDate);
  }

  // Helper to calculate report status
  const calculateStatus = (res: any, prevRes: any) => {
    if (res.status === 'cancelled') return '已取消';
    if (!res.actual_start_time) {
      if (new Date() < new Date(res.start_time)) {
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

    if (actualStart.getTime() > start.getTime() + lateThreshold && !isDelayCausedByPrev) {
      return '迟到';
    }
    if (actualEnd && actualEnd.getTime() > end.getTime() + overtimeThreshold) {
      return '超时';
    }
    
    return '正常';
  };

  const allReservationsRaw = db.prepare(`
    SELECT r.*, e.name as equipment_name 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    ${whereClause}
    ORDER BY r.equipment_id, r.start_time ASC
  `).all(...params);

  const allReservations = allReservationsRaw.map((res: any, idx: number) => {
    const prevRes = idx > 0 && (allReservationsRaw[idx-1] as any).equipment_id === res.equipment_id ? (allReservationsRaw[idx-1] as any) : null;
    const reportStatus = calculateStatus(res, prevRes);
    return { ...res, reportStatus };
  });

  // Filter for stats: exclude no-shows and cancelled
  const statsReservations = allReservations.filter(r => r.actual_start_time && r.status === 'completed');

  const usageByTime = db.prepare(`
    SELECT ${periodExpr} as period, 
           SUM((julianday(actual_end_time) - julianday(actual_start_time)) * 24) as total_hours,
           SUM(total_cost) as total_revenue
    FROM reservations
    ${whereClause} AND status = 'completed' AND actual_start_time IS NOT NULL
    GROUP BY period
    ORDER BY period ASC
  `).all(...params);

  // Grouping by person and supervisor manually to ensure correct sorting and filtering
  const personMap = new Map();
  const supervisorMap = new Map();

  statsReservations.forEach(r => {
    const hours = (new Date(r.actual_end_time).getTime() - new Date(r.actual_start_time).getTime()) / (1000 * 60 * 60);
    const revenue = r.total_cost || 0;

    const personKey = `${r.student_id}_${r.student_name}`;
    if (!personMap.has(personKey)) {
      personMap.set(personKey, { student_name: r.student_name, student_id: r.student_id, supervisor: r.supervisor, total_hours: 0, total_revenue: 0 });
    }
    const p = personMap.get(personKey);
    p.total_hours += hours;
    p.total_revenue += revenue;

    if (!supervisorMap.has(r.supervisor)) {
      supervisorMap.set(r.supervisor, { supervisor: r.supervisor, total_hours: 0, total_revenue: 0 });
    }
    const s = supervisorMap.get(r.supervisor);
    s.total_hours += hours;
    s.total_revenue += revenue;
  });

  const usageByPerson = Array.from(personMap.values()).sort((a, b) => b.total_hours - a.total_hours);
  const usageBySupervisor = Array.from(supervisorMap.values()).sort((a, b) => b.total_hours - a.total_hours);

  res.json({ usageByTime, usageByPerson, usageBySupervisor, allReservations });
});

app.get('/api/admin/audit-logs', adminAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM audit_logs
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

async function startServer() {
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
