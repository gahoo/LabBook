import { validateTimeRange, validateOperatingHours, calculatePeakAccumulatedMinutes } from './src/lib/validators.js';
import authRoutes from "./src/modules/auth/routes.js";
import { calendarRoutes } from "./src/modules/calendar/routes.js";
import settingsRoutes from "./src/modules/settings/routes.js";
import auditRoutes from './src/modules/audit/routes.js';
import { equipmentRouter, equipmentAdminRouter } from './src/modules/equipment/routes.js';
import { recordAuditLog } from './src/modules/audit/service.js';
import violationRoutes from './src/modules/violation/routes.js';
import { whitelistRouter, whitelistAdminRouter } from './src/modules/whitelist/routes.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation, getNaturalPeriodStart } from './src/modules/violation/service.js';
import { adminAuth } from "./src/middleware/auth.js";
import { notificationRoutes } from "./src/modules/notification/routes.js";
import { authLimiter, mailLimiter, actionLimiter } from "./src/middleware/rateLimiter.js";
import express from 'express';
 
import { config } from './src/config.js';
 
import { OperationRejectError } from './src/lib/errors.js';
import { encryptID, decryptID } from './src/lib/crypto.js';
import { createServer as createViteServer } from 'vite';
import cronParser from 'cron-parser';
import * as cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { addDays, format, isBefore, parseISO, startOfDay, endOfDay, isAfter } from 'date-fns';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { 
  reloadBackupCron, 
  startUpcomingReminderCron, 
  startEndingReminderCron, 
  startNoShowScanner,
  initSchedulers 
} from './src/modules/scheduler/service.js';

 
 
 
 
import { marked } from 'marked';
import { notifyEvent, processNotificationQueue, scheduleNextRun, setBaseUrl } from './src/modules/notification/service.js';
 
const app = express();
app.set('trust proxy', config.trustProxy);
app.use(express.json());
 
 
app.use((req, res, next) => {
  setBaseUrl(req.protocol + '://' + req.get('host'));
  next();
});
 
import { db } from './src/db/index.js';
 
 
 

 
// Auto Backup Logic
const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

 
 

 

 
 
 
// Start the notification processor
processNotificationQueue(db).catch(console.error);
 
 
 
 
function getNextNaturalPeriodStart(now: Date, periodType: string): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  
  switch (periodType) {
    case 'month':
      return new Date(year, month + 1, 1);
    case 'quarter':
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return new Date(year, quarterStartMonth + 3, 1);
    case 'year':
      return new Date(year + 1, 0, 1);
    case 'semester':
      if (month >= 8) return new Date(year + 1, 1, 1); // Next is Spring
      if (month >= 1) return new Date(year, 8, 1);     // Next is Fall
      return new Date(year, 1, 1);                     // Next is Spring
    case 'week':
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(year, month, diff);
      return new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(year, month + 1, 1);
  }
}
 
 
 
 
 
 
 
 
 
// API Routes
 
// --- Penalty Rules API ---
// --- Validation Helpers ---
 
 
 
 
 
 
 
 
 
 
 
import { generateICS } from './src/lib/ics';
 
// Get settings
 
 
// Deprecated PUT /api/admin/reports/reservations/:id removed
 
// Deprecated DELETE /api/admin/reports/reservations/:id removed
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
// Removed /api/admin/reports
 
app.use(authRoutes);
app.use(calendarRoutes);
app.use(equipmentRouter);
app.use(equipmentAdminRouter);
app.use(settingsRoutes);
app.use(auditRoutes);
app.use("/api/admin", notificationRoutes);
app.use(violationRoutes);
app.use('/api/whitelist', whitelistRouter);

import { reservationRouter, reservationAdminRouter } from './src/modules/reservation/routes.js';
app.use('/api/reservations', reservationRouter);
app.use('/api/admin/reservations', adminAuth, reservationAdminRouter);

app.use('/api/admin/whitelist', adminAuth, whitelistAdminRouter);

 
async function startServer() {
  initSchedulers(config.isTest);
  
  
  if (!config.isProduction && !config.isTest) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (config.isProduction) {
    app.use(express.static('dist'));
  }
 
  const PORT = 3000;
  if (!config.isTest) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}
 
if (!config.isTest) {
  startServer();
}
 
export { app, db };
