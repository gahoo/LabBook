import { db } from '../../db/index.js';
import { encryptID, decryptID } from '../../lib/crypto.js';
import { generateICS } from '../../lib/ics.js';
import { notifyEvent } from '../notification/service.js';
import { OperationRejectError } from '../../lib/errors.js';

export function getCalendarConfig() {
  const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'calendar_subscription.enabled'").get() as any;
  const secretRow = db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_secret'").get() as any;
  const advanceRow = db.prepare("SELECT value FROM settings WHERE key = 'booking_upcoming_advance_minutes'").get() as any;
  const smtpRow = db.prepare("SELECT value FROM settings WHERE key = 'smtp.enabled'").get() as any;
  
  return {
    enabled: enabledRow?.value === 'true',
    secret: secretRow?.value,
    advanceMins: parseInt(advanceRow?.value || '30', 10),
    smtpEnabled: smtpRow?.value === 'true'
  };
}

export function generateUserCalendarUrl(bookingCode: string, protocol: string, host: string): string {
  const config = getCalendarConfig();
  if (!config.enabled) throw new OperationRejectError('Calendar subscription is disabled', 403);
  if (!bookingCode) throw new OperationRejectError('booking_code is required to verify identity', 400);
  
  const reservation = db.prepare('SELECT student_id FROM reservations WHERE booking_code = ?').get(bookingCode) as any;
  if (!reservation) throw new OperationRejectError('Invalid booking code', 404);
  if (!config.secret) throw new OperationRejectError('Secret not configured', 500);
  
  const token = encryptID(reservation.student_id, config.secret);
  return `${protocol}://${host}/api/calendar/user/${token}.ics`;
}

export function processUserCalendarMail(bookingCode: string, host: string): string {
  const config = getCalendarConfig();
  if (!config.enabled) throw new OperationRejectError('Calendar subscription is disabled', 403);
  if (!config.smtpEnabled) throw new OperationRejectError('SMTP email service is not configured', 400);
  if (!bookingCode) throw new OperationRejectError('booking_code is required', 400);

  const reservation = db.prepare('SELECT student_id, email FROM reservations WHERE booking_code = ?').get(bookingCode) as any;
  if (!reservation) throw new OperationRejectError('Invalid booking code', 404);
  if (!config.secret) throw new OperationRejectError('Secret not configured', 500);

  if (!reservation.email) throw new OperationRejectError('No email associated with this booking', 400);

  const token = encryptID(reservation.student_id, config.secret);
  const url = `webcal://${host}/api/calendar/user/${token}.ics`;
  
  notifyEvent(db, 'calendar_subscription', {
    student_id: reservation.student_id,
    calendar_url: url
  }, reservation.email);

  return reservation.email;
}

export function getUserICS(token: string): string {
  const config = getCalendarConfig();
  if (!config.secret) throw new OperationRejectError('Secret not configured', 500);
  
  const studentId = decryptID(token, config.secret);
  if (!studentId) throw new OperationRejectError('Invalid token', 400);
  
  const reservations = db.prepare(`
    SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.student_id = ? AND r.status IN ('approved', 'cancelled')
    ORDER BY r.start_time ASC
  `).all(studentId) as any[];

  return generateICS(reservations, 'user', config.advanceMins);
}

export function getEquipmentICS(token: string) {
  const config = getCalendarConfig();
  if (!config.secret) throw new OperationRejectError('Secret not configured', 500);

  const equipmentId = decryptID(token, config.secret);
  if (!equipmentId) throw new OperationRejectError('Invalid token', 400);

  const reservations = db.prepare(`
    SELECT r.*, e.name as equipment_name 
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.equipment_id = ? AND r.status IN ('approved', 'cancelled')
    ORDER BY r.start_time ASC
  `).all(equipmentId) as any[];

  return {
    icsContent: generateICS(reservations, 'admin', config.advanceMins),
    equipmentId
  };
}

export function generateEquipmentCalendarUrl(equipmentId: string | number, host: string): string {
  const config = getCalendarConfig();
  if (!config.secret) throw new OperationRejectError('Secret not configured', 500);
  
  const token = encryptID(equipmentId, config.secret);
  return `webcal://${host}/api/calendar/equipment/${token}.ics`;
}
