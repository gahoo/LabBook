import fs from 'fs';
import path from 'path';
import { format } from 'date-fns';
import { db } from '../../db/index.js';

const backupDir = path.join(process.cwd(), 'backups');

export async function executeBackup(targetDir?: string) {
  const dirToUse = targetDir || backupDir;
  if (!fs.existsSync(dirToUse)) {
    fs.mkdirSync(dirToUse, { recursive: true });
  }

  const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
  const backupPath = path.join(dirToUse, `lab_equipment_backup_${timestamp}.db`);

  try {
    await db.backup(backupPath);
    console.log(`Database backup successful: ${backupPath}`);
    
    // Clean up old backups
    const files = fs.readdirSync(dirToUse)
      .filter(f => f.startsWith('lab_equipment_backup_') && f.endsWith('.db'))
      .sort()
      .reverse();
      
    const retentionRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup_retention'").get() as any;
    const keepCount = retentionRow && !isNaN(parseInt(retentionRow.value, 10)) ? parseInt(retentionRow.value, 10) : 7;
    
    if (files.length > keepCount) {
      const filesToDelete = files.slice(keepCount);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(dirToUse, file));
        console.log(`Deleted old backup: ${file}`);
      }
    }
  } catch (err) {
    console.error('Database backup failed:', err);
  }
}
