import Database from 'better-sqlite3';
import path from 'path';

// Define the absolute path to the SQLite database file
const dbPath = 'lab_equipment.db';

// Open the database in read-write mode
const db = new Database(dbPath, { fileMustExist: true });

console.log('Connected to the database.');

try {
  // Begin transaction
  db.exec('BEGIN TRANSACTION');

  // Find all active/inactive penalties with uppercase methods
  const rows = db.prepare(`SELECT id, penalty_method, restrictions FROM user_penalties WHERE penalty_method IN ('BAN', 'REQUIRE_APPROVAL', 'RESTRICTED')`).all() as any[];
  let updatedCount = 0;

  for (const row of rows) {
    let newMethod = row.penalty_method.toLowerCase();
    
    if (row.penalty_method === 'RESTRICTED') {
      try {
        const restrictions = JSON.parse(row.restrictions);
        if (restrictions.multiplier !== undefined) {
          newMethod = 'double_fee';
        } else if (restrictions.reduce_days !== undefined || restrictions.min_retain_days !== undefined) {
          newMethod = 'reduce_advance_days';
        } else {
          // If we can't tell, leave it as restricted (lowercase or uppercase? The requirement says lowercase concrete action. So fallback to restricted)
          newMethod = 'restricted';
        }
      } catch (e) {
        newMethod = 'restricted';
      }
    }

    if (newMethod !== row.penalty_method) {
      db.prepare(`UPDATE user_penalties SET penalty_method = ? WHERE id = ?`).run(newMethod, row.id);
      updatedCount++;
    }
  }

  // Commit transaction
  db.exec('COMMIT');
  console.log(`Successfully migrated ${updatedCount} penalty records.`);

} catch (error) {
  // Rollback on error
  db.exec('ROLLBACK');
  console.error('Error during migration:', error);
} finally {
  db.close();
}
