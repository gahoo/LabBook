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
    cron_availability TEXT NOT NULL,
    auto_approve INTEGER DEFAULT 1,
    price_type TEXT NOT NULL,
    price REAL NOT NULL,
    consumable_fee REAL DEFAULT 0
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
    FOREIGN KEY (equipment_id) REFERENCES equipment(id)
  );
`);

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
  const { name, description, cron_availability, auto_approve, price_type, price, consumable_fee } = req.body;
  
  // Validate cron
  try {
    // @ts-ignore
    cronParser.parse(cron_availability);
  } catch (err) {
    return res.status(400).json({ error: '无效的Cron表达式' });
  }

  const stmt = db.prepare(`
    INSERT INTO equipment (name, description, cron_availability, auto_approve, price_type, price, consumable_fee)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, description, cron_availability, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0);
  
  res.json({ id: info.lastInsertRowid });
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
  const start = startOfDay(targetDate);
  const end = endOfDay(targetDate);

  const options = {
    currentDate: start,
    endDate: end,
    iterator: true
  };

  let interval;
  try {
    // @ts-ignore
    interval = cronParser.parse(equipment.cron_availability, options);
  } catch (err) {
    return res.status(500).json({ error: '解析Cron失败' });
  }

  const availableSlots: { start: string, end: string }[] = [];
  while (true) {
    try {
      const obj = interval.next();
      const slotStart = obj.value.toDate();
      // Assuming 1-hour slots for simplicity based on cron start times
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
      
      if (isAfter(slotStart, end)) break;
      
      availableSlots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString()
      });
    } catch (e) {
      break;
    }
  }

  // Fetch existing reservations for this date
  const reservations = db.prepare(`
    SELECT start_time, end_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND start_time >= ? AND start_time <= ?
  `).all(id, start.toISOString(), end.toISOString()) as any[];

  // Filter out booked slots
  const freeSlots = availableSlots.filter(slot => {
    return !reservations.some(res => 
      (slot.start >= res.start_time && slot.start < res.end_time) ||
      (slot.end > res.start_time && slot.end <= res.end_time)
    );
  });

  res.json(freeSlots);
});

// 4. Create reservation
app.post('/api/reservations', (req, res) => {
  const { equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time } = req.body;
  
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id) as any;
  if (!equipment) return res.status(404).json({ error: '未找到该仪器' });

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
  const status = equipment.auto_approve ? 'approved' : 'pending';

  const stmt = db.prepare(`
    INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code);

  res.json({ id: info.lastInsertRowid, booking_code, status });
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

// 7. Check-in
app.post('/api/reservations/checkin', (req, res) => {
  const { booking_code } = req.body;
  const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'approved') {
    return res.status(400).json({ error: '预约未通过审批或已开始' });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE reservations SET status = 'active', actual_start_time = ? WHERE booking_code = ?").run(now, booking_code);
  res.json({ success: true, actual_start_time: now });
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
  
  let total_cost = reservation.consumable_fee;
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
app.get('/api/admin/reports', adminAuth, (req, res) => {
  const { period, student_name, supervisor } = req.query; // 'day', 'week', 'month', 'quarter', 'year'
  
  let dateFormat = "'%Y-%m-%d'";
  if (period === 'week') dateFormat = "'%Y-%W'";
  if (period === 'month') dateFormat = "'%Y-%m'";
  if (period === 'quarter') dateFormat = "strftime('%Y', actual_start_time) || '-Q' || ((cast(strftime('%m', actual_start_time) as integer) + 2) / 3)";
  if (period === 'year') dateFormat = "'%Y'";
  
  const periodExpr = period === 'quarter' ? dateFormat : `strftime(${dateFormat}, actual_start_time)`;

  let whereClause = "WHERE status = 'completed'";
  const params: any[] = [];
  
  if (student_name) {
    whereClause += " AND student_name LIKE ?";
    params.push(`%${student_name}%`);
  }
  if (supervisor) {
    whereClause += " AND supervisor LIKE ?";
    params.push(`%${supervisor}%`);
  }

  const usageByTime = db.prepare(`
    SELECT ${periodExpr} as period, 
           SUM((julianday(actual_end_time) - julianday(actual_start_time)) * 24) as total_hours,
           SUM(total_cost) as total_revenue
    FROM reservations
    ${whereClause}
    GROUP BY period
    ORDER BY period DESC
    LIMIT 30
  `).all(...params);

  const usageByPerson = db.prepare(`
    SELECT student_name, student_id,
           SUM((julianday(actual_end_time) - julianday(actual_start_time)) * 24) as total_hours,
           SUM(total_cost) as total_revenue
    FROM reservations
    ${whereClause}
    GROUP BY student_id, student_name
    ORDER BY total_revenue DESC
    LIMIT 20
  `).all(...params);

  const usageBySupervisor = db.prepare(`
    SELECT supervisor,
           SUM((julianday(actual_end_time) - julianday(actual_start_time)) * 24) as total_hours,
           SUM(total_cost) as total_revenue
    FROM reservations
    ${whereClause}
    GROUP BY supervisor
    ORDER BY total_revenue DESC
    LIMIT 20
  `).all(...params);

  res.json({ usageByTime, usageByPerson, usageBySupervisor });
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
