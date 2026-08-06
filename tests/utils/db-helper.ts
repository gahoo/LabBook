import { db } from '../../server.js';

export function clearDatabase() {
  const tablesToClear = [
    'reservations',
    'equipment',
    'violation_records',
    'user_penalties',
    'whitelist',
    'whitelist_applications',
    'audit_logs',
    'notification_logs'
  ];
  
  for (const table of tablesToClear) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
    } catch (e) {
      // ignore if table doesn't exist yet
    }
  }
}
