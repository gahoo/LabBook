import { db } from '../../db/index.js';
import { notifyEvent } from './service.js';

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
