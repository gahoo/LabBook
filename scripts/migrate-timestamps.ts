import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'lab_equipment.db');
const db = new Database(dbPath);

console.log('Running timestamp migration...');

const tables = ['reservations', 'equipment', 'penalty_rules'];
const columns = ['created_at', 'updated_at'];

for (const table of tables) {
  for (const column of columns) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} DATETIME`);
      console.log(`[SUCCESS] Added ${column} to ${table}`);
    } catch (e: any) {
      if (e.message.includes('duplicate column name')) {
        console.log(`[SKIP] Column ${column} already exists in ${table}`);
      } else {
        console.error(`[ERROR] Error adding ${column} to ${table}:`, e.message);
      }
    }
  }
}

console.log('Migration completed.');
