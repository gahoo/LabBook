import { authRouter } from "./src/modules/auth/routes.js";
import { calendarRouter } from "./src/modules/calendar/routes.js";
import { settingsRouter } from "./src/modules/settings/routes.js";
import { auditAdminRouter } from './src/modules/audit/routes.js';
import { equipmentRouter, equipmentAdminRouter } from './src/modules/equipment/routes.js';
import { violationRouter } from './src/modules/violation/routes.js';
import { whitelistRouter, whitelistAdminRouter } from './src/modules/whitelist/routes.js';
import { reservationRouter, reservationAdminRouter } from './src/modules/reservation/routes.js';
import { notificationAdminRouter } from "./src/modules/notification/routes.js";
import { adminAuth } from "./src/middleware/auth.js";
import express from 'express'; 
import { config } from './src/config.js'; 
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { initSchedulers } from './src/modules/scheduler/service.js';    
import { processNotificationQueue, setBaseUrl } from './src/modules/notification/service.js';
import { db } from './src/db/index.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.use(express.json());

app.use((req, res, next) => {
  setBaseUrl(req.protocol + '://' + req.get('host'));
  next();
});

// Auto Backup Logic Initialization
const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Start the notification processor
processNotificationQueue(db).catch(console.error);

// Register application routes
app.use('/api/admin', authRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/equipment', equipmentRouter);
app.use('/api/admin', equipmentAdminRouter);
app.use(settingsRouter);
app.use('/api/admin/audit-logs', auditAdminRouter);
app.use("/api/admin", notificationAdminRouter);
app.use(violationRouter);
app.use('/api/whitelist', whitelistRouter);
app.use('/api/admin/whitelist', adminAuth, whitelistAdminRouter);
app.use('/api/reservations', reservationRouter);
app.use('/api/admin/reservations', adminAuth, reservationAdminRouter);

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
