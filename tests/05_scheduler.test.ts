import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/index.js';
import fs from 'fs';
import path from 'path';
import { upcomingReminderScan, endingReminderScan, executeBackup } from '../server.js';

describe('Scheduler Module (05_scheduler.test.ts)', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM notifications').run();
    db.prepare('DELETE FROM reservations').run();
    db.prepare('DELETE FROM equipment').run();
    db.prepare('DELETE FROM settings').run();
    
    db.prepare(`
      INSERT OR IGNORE INTO equipment (id, name, price_type, price) VALUES (1, 'Test Equipment', 'hourly', 10)
    `).run();

    // Setup webhook notifications so they actually get enqueued
    const settings = [
      ['webhook.enabled', 'true'],
      ['webhook.url', 'https://example.com'],
      ['webhook.events.booking_upcoming.enabled', 'true'],
      ['webhook.events.booking_upcoming.template', '{}'],
      ['webhook.events.booking_ending.enabled', 'true'],
      ['webhook.events.booking_ending.template', '{}'],
      ['booking_upcoming_advance_minutes', '30'],
      ['booking_ending_advance_minutes', '15']
    ];
    for (const [key, val] of settings) {
       db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, val);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('upcomingReminderScan', () => {
    it('should create a booking_upcoming notification for reservation starting soon', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 15 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (1, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-123', 1, ?, ?, 'approved', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-123'`).all();
      expect(notifs.length).toBe(1);
    });

    it('should NOT create a notification if reservation starts further than advance minutes', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 60 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (2, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-456', 1, ?, ?, 'approved', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-456'`).all();
      expect(notifs.length).toBe(0);
    });

    it('should NOT create duplicate notifications (Idempotency)', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 15 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (4, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-IDEM', 1, ?, ?, 'approved', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();
      await upcomingReminderScan(); // Call twice

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-IDEM'`).all();
      expect(notifs.length).toBe(1);
    });

    it('should NOT create notification for non-approved statuses', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 15 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (5, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-REJECTED', 1, ?, ?, 'rejected', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();
      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-REJECTED'`).all();
      expect(notifs.length).toBe(0);
    });
  });

  describe('endingReminderScan', () => {
    it('should create a booking_ending notification for active reservation ending soon', async () => {
      const now = new Date();
      const startTime = new Date(now.getTime() - 50 * 60000);
      const endTime = new Date(now.getTime() + 10 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (3, 'STU1', 'Test', '123', 'test@test.com', 'ENDING-123', 1, ?, ?, 'active', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await endingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_ending' AND reference_code = 'ENDING-123'`).all();
      expect(notifs.length).toBe(1);
    });
  });

  describe('executeBackup', () => {
    it('should create a database backup file and maintain retention', async () => {
      const backupDir = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(backupDir)) {
         fs.mkdirSync(backupDir, { recursive: true });
      } else {
         const files = fs.readdirSync(backupDir);
         for (const file of files) fs.unlinkSync(path.join(backupDir, file));
      }
      
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup_retention', '2')`).run();
      
      await executeBackup();
      await new Promise(r => setTimeout(r, 1000));
      await executeBackup();
      await new Promise(r => setTimeout(r, 1000));
      await executeBackup();
      
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('lab_equipment_backup_') && f.endsWith('.db'));
      expect(files.length).toBe(2);
    });
  });
});
