import { db } from '../../server.js';
import { initializeSchema } from '../../src/db/schema.js';
import { runMigrations } from '../../src/db/migrations.js';

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
    'notifications',
    'penalty_rules',
    'penalty_rules_old',
    'settings',
    'penalty_exemptions',
    'penalty_waivers'
  ];
  
  db.transaction(() => {
    // 1. Drop all tables to ensure a clean slate
    for (const table of tablesToClear) {
      try {
        db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      } catch (e) {
        // ignore
      }
    }
  })();
}

export function resetTestDatabase() {
  clearDatabase();
  initializeSchema(db);
  runMigrations(db);
}

