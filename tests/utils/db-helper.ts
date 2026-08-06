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
    'notification_logs',
    'penalty_rules',
    'settings',
    'penalty_exemptions'
  ];
  
  // Wrap in a transaction for safety, though SQLite handles separate deletes fine
  db.transaction(() => {
    for (const table of tablesToClear) {
      try {
        db.prepare(`DELETE FROM ${table}`).run();
      } catch (e) {
        // ignore if table doesn't exist yet
      }
    }
  })();
}
