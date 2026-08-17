import { Router } from 'express';
import { db } from '../../db/index.js';
import { encryptID, decryptID } from '../../lib/crypto.js';
import { generateICS } from '../../lib/ics.js';
import { notifyEvent } from '../notification/service.js';
import { adminAuth } from '../../middleware/auth.js';
import { mailLimiter } from '../../middleware/rateLimiter.js';

export const calendarRoutes = Router();

calendarRoutes.get('/api/calendar/user/url', (req, res) => {
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

calendarRoutes.post('/api/calendar/user/mail', mailLimiter, (req, res) => {
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

calendarRoutes.get('/api/calendar/user/:token.ics', (req, res) => {
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

calendarRoutes.get('/api/calendar/equipment/:token.ics', (req, res) => {
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
    res.setHeader('Content-Disposition', `attachment; filename="equip_\${equipmentId}_reservations.ics"`);
    res.send(icsContent);
  } catch(error) {
    res.status(500).send('Internal Server Error');
  }
});

calendarRoutes.get('/api/calendar/equipment/:id/url', adminAuth, (req, res) => {
  try {
    const secret = (db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any)?.value;
    if (!secret) return res.status(500).json({ error: 'Secret not configured' });
    
    const token = encryptID(req.params.id, secret);
    const host = req.get('host');
    const url = `webcal://\${host}/api/calendar/equipment/\${token}.ics`;
    
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate calendar URL' });
  }
});
