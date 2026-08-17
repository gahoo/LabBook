import jwt from 'jsonwebtoken';
import { db } from '../../db/index.js';
import { config } from '../../config.js';

export function loginAdmin(password: string): string | null {
  if (password === config.adminPassword) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_expires_in_hours'").get() as any;
    const expiresHours = row && !isNaN(parseInt(row.value, 10)) ? parseInt(row.value, 10) : 168;
    const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: `${expiresHours}h` });
    return token;
  }
  return null;
}
