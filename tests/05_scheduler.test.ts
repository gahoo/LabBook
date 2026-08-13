import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/index.js';
import fs from 'fs';
import path from 'path';
// We assume these will be exported from the new scheduler service
import { upcomingReminderScan, endingReminderScan, executeBackup } from '../src/modules/scheduler/service.js';

describe('Scheduler Module (05_scheduler.test.ts)', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM notifications').run();
    db.prepare('DELETE FROM reservations').run();
    db.prepare('DELETE FROM equipment').run();
    
    db.prepare(`
      INSERT OR IGNORE INTO equipment (id, name, price_type, price) VALUES (1, 'Test Equipment', 'hourly', 10)
    `).run();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('upcomingReminderScan', () => {
    it('should create a booking_upcoming notification for reservation starting soon', async () => {
      // Set advance minutes to 30
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('booking_upcoming_advance_minutes', '30')`).run();
      
      const now = new Date();
      // Reservation starts in 15 minutes
      const startTime = new Date(now.getTime() + 15 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status)
        VALUES (1, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-123', 1, ?, ?, 'approved')
      `).run(startTime.toISOString(), endTime.toISOString());

      // Should be triggered because 15 mins <= 30 mins
      await upcomingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-123'`).all();
      expect(notifs.length).toBe(1);
    });

    it('should NOT create a notification if reservation starts further than advance minutes', async () => {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('booking_upcoming_advance_minutes', '30')`).run();
      
      const now = new Date();
      // Reservation starts in 60 minutes
      const startTime = new Date(now.getTime() + 60 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status)
        VALUES (2, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-456', 1, ?, ?, 'approved')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-456'`).all();
      expect(notifs.length).toBe(0);
    });
  });

  describe('endingReminderScan', () => {
    it('should create a booking_ending notification for active reservation ending soon', async () => {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('booking_ending_advance_minutes', '15')`).run();
      
      const now = new Date();
      // Reservation ends in 10 minutes, started 50 minutes ago
      const startTime = new Date(now.getTime() - 50 * 60000);
      const endTime = new Date(now.getTime() + 10 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status)
        VALUES (3, 'STU1', 'Test', '123', 'test@test.com', 'ENDING-123', 1, ?, ?, 'active')
      `).run(startTime.toISOString(), endTime.toISOString());

      await endingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_ending' AND reference_code = 'ENDING-123'`).all();
      expect(notifs.length).toBe(1);
    });
  });

  describe('executeBackup', () => {
    it('should create a database backup file and maintain retention', async () => {
      const backupDir = path.join(process.cwd(), 'backups');
      if (fs.existsSync(backupDir)) {
         fs.rmSync(backupDir, { recursive: true, force: true });
      }
      
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup_retention', '2')`).run();
      
      // Execute 3 times to trigger retention cleanup
      await executeBackup();
      await new Promise(r => setTimeout(r, 1000)); // wait a bit so timestamps differ
      await executeBackup();
      await new Promise(r => setTimeout(r, 1000));
      await executeBackup();
      
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('lab_equipment_backup_') && f.endsWith('.db'));
      
      // Since retention is 2, there should be exactly 2 files
      expect(files.length).toBe(2);
    });
  });
});
