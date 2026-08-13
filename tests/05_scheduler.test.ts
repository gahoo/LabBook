import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../src/db/index.js';
import fs from 'fs';
import path from 'path';
import * as cron from 'node-cron';
import { 
  upcomingReminderScan, 
  endingReminderScan, 
  executeBackup,
  startUpcomingReminderCron,
  startEndingReminderCron,
  reloadBackupCron
} from '../server.js';

// 4. Mock node-cron lifecycle
vi.mock('node-cron', () => {
  return {
    default: {
      schedule: vi.fn(() => ({ stop: vi.fn() })),
      validate: vi.fn(() => true)
    },
    schedule: vi.fn(() => ({ stop: vi.fn() })),
    validate: vi.fn(() => true)
  };
});

describe('Scheduler Module (05_scheduler.test.ts)', () => {
  // 1. 冻结系统时间 (Fake Timers)
  const FIXED_TIME = new Date('2026-08-01T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

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
      ['webhook.events.booking_upcoming.template', '{"booking_code":"{{booking_code}}", "student_id":"{{student_id}}", "equipment_name":"{{equipment_name}}", "advance_minutes":{{advance_minutes}}}'],
      ['webhook.events.booking_ending.enabled', 'true'],
      ['webhook.events.booking_ending.template', '{"booking_code":"{{booking_code}}", "student_id":"{{student_id}}", "equipment_name":"{{equipment_name}}", "advance_minutes":{{advance_minutes}}}'],
      ['booking_upcoming_advance_minutes', '30'],
      ['booking_ending_advance_minutes', '15']
    ];
    for (const [key, val] of settings) {
       db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, val);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('upcomingReminderScan', () => {
    it('should create a booking_upcoming notification for reservation starting soon with strict assertions', async () => {
      // 预约将在 15 分钟后开始
      const startTime = new Date(FIXED_TIME.getTime() + 15 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (1, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-123', 1, ?, ?, 'approved', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-123'`).all() as any[];
      expect(notifs.length).toBe(1);

      // 3. 收紧断言粒度 (Strict Assertions)
      const payload = JSON.parse(notifs[0].payload);
      console.log(payload);
      expect(notifs[0].reference_code).toBe('UPCOMING-123');
      expect(payload.body.booking_code).toBe('UPCOMING-123');
      expect(payload.body.student_id).toBe('STU1');
      expect(payload.body.equipment_name).toBe('Test Equipment');
      expect(payload.body.advance_minutes).toBe(30);
    });

    it('should NOT create a notification if reservation starts further than advance minutes', async () => {
      // 预约将在 60 分钟后开始 (大于 30)
      const startTime = new Date(FIXED_TIME.getTime() + 60 * 60000);
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
      const startTime = new Date(FIXED_TIME.getTime() + 15 * 60000);
      const endTime = new Date(startTime.getTime() + 60 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (4, 'STU1', 'Test', '123', 'test@test.com', 'UPCOMING-IDEM', 1, ?, ?, 'approved', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await upcomingReminderScan();
      await upcomingReminderScan(); // Call twice

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_upcoming' AND reference_code = 'UPCOMING-IDEM'`).all();
      expect(notifs.length).toBe(1); // 确保只通知了一次
    });

    it('should NOT create notification for non-approved statuses', async () => {
      const startTime = new Date(FIXED_TIME.getTime() + 15 * 60000);
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

  describe('endingReminderScan (Symmetrical Tests)', () => {
    it('should create a booking_ending notification for active reservation ending soon with strict assertions', async () => {
      // 2. 补齐对称测试 - 正常情况
      const startTime = new Date(FIXED_TIME.getTime() - 50 * 60000);
      const endTime = new Date(FIXED_TIME.getTime() + 10 * 60000); // 10分钟后结束 (<=15)

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (3, 'STU1', 'Test', '123', 'test@test.com', 'ENDING-123', 1, ?, ?, 'active', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await endingReminderScan();

      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_ending' AND reference_code = 'ENDING-123'`).all() as any[];
      expect(notifs.length).toBe(1);

      // 3. 收紧断言粒度
      const payload = JSON.parse(notifs[0].payload);
      console.log(payload);
      expect(notifs[0].reference_code).toBe('ENDING-123');
      expect(payload.body.booking_code).toBe('ENDING-123');
      expect(payload.body.student_id).toBe('STU1');
      expect(payload.body.equipment_name).toBe('Test Equipment');
      expect(payload.body.advance_minutes).toBe(15);
    });

    it('should NOT create a notification if reservation ends further than advance minutes', async () => {
      // 2. 补齐对称测试 - 超出提前时间不入队
      const startTime = new Date(FIXED_TIME.getTime() - 10 * 60000);
      const endTime = new Date(FIXED_TIME.getTime() + 120 * 60000); // 2小时后结束 (>15)

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (6, 'STU1', 'Test', '123', 'test@test.com', 'ENDING-FAR', 1, ?, ?, 'active', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await endingReminderScan();
      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_ending' AND reference_code = 'ENDING-FAR'`).all();
      expect(notifs.length).toBe(0);
    });

    it('should NOT create notification for non-active statuses', async () => {
      // 2. 补齐对称测试 - 状态过滤
      const startTime = new Date(FIXED_TIME.getTime() - 50 * 60000);
      const endTime = new Date(FIXED_TIME.getTime() + 10 * 60000);

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (7, 'STU1', 'Test', '123', 'test@test.com', 'ENDING-COMPLETED', 1, ?, ?, 'completed', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await endingReminderScan();
      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_ending' AND reference_code = 'ENDING-COMPLETED'`).all();
      expect(notifs.length).toBe(0);
    });

    it('should NOT create notification for already ended historical reservations', async () => {
      // 2. 补齐对称测试 - 已超时的历史预约
      const startTime = new Date(FIXED_TIME.getTime() - 180 * 60000);
      const endTime = new Date(FIXED_TIME.getTime() - 120 * 60000); // 2小时前已经结束

      db.prepare(`
        INSERT INTO reservations (id, student_id, student_name, phone, email, booking_code, equipment_id, start_time, end_time, status, supervisor)
        VALUES (8, 'STU1', 'Test', '123', 'test@test.com', 'ENDING-HISTORICAL', 1, ?, ?, 'active', 'SuperV')
      `).run(startTime.toISOString(), endTime.toISOString());

      await endingReminderScan();
      const notifs = db.prepare(`SELECT * FROM notifications WHERE event = 'booking_ending' AND reference_code = 'ENDING-HISTORICAL'`).all();
      expect(notifs.length).toBe(0);
    });
  });

  describe('Cron Lifecycle Management', () => {
    // 4. 引入对 node-cron 启停逻辑的 Mock 测试
    it('should schedule upcoming reminder cron when enabled', () => {
      startUpcomingReminderCron();
      expect(cron.schedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function));
    });

    it('should NOT schedule upcoming reminder cron when disabled', () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('webhook.events.booking_upcoming.enabled', 'false')").run();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email.events.booking_upcoming.enabled', 'false')").run();
      
      vi.clearAllMocks();
      startUpcomingReminderCron();
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    it('should stop old task when reloading upcoming reminder cron', () => {
      startUpcomingReminderCron();
      // 获取第一次调用时返回的 mock task
      const mockTask = vi.mocked(cron.schedule).mock.results[0].value;
      
      startUpcomingReminderCron(); // 第二次调用
      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('should schedule backup cron with retention cleanup when enabled', () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup_enabled', 'true')").run();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup_cron', '0 3 * * *')").run();
      
      vi.clearAllMocks();
      reloadBackupCron();
      expect(cron.schedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));
    });
  });

  describe('executeBackup', () => {
    it('should create a database backup file and maintain retention', async () => {
      vi.useRealTimers();
      
      const backupDir = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(backupDir)) {
         fs.mkdirSync(backupDir, { recursive: true });
      } else {
         const files = fs.readdirSync(backupDir);
         for (const file of files) fs.unlinkSync(path.join(backupDir, file));
      }
      
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_backup_retention', '2')`).run();
      
      await executeBackup();
      await new Promise(r => setTimeout(r, 1100));
      await executeBackup();
      await new Promise(r => setTimeout(r, 1100));
      await executeBackup();
      
      const files = fs.readdirSync(backupDir).filter(f => f.startsWith('lab_equipment_backup_') && f.endsWith('.db'));
      expect(files.length).toBe(2);
    }, 10000); // give it more timeout
  });
});
