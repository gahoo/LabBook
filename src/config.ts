import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = crypto.randomBytes(16).toString('hex');
  if (process.env.NODE_ENV !== 'test') {
    console.warn('\n===================================================================');
    console.warn('WARNING: No ADMIN_PASSWORD provided in environment variables.');
    console.warn('A resilient temporary password has been generated for this session:');
    console.warn(`=> ${adminPassword} <=`);
    console.warn('Please set ADMIN_PASSWORD in your .env file for production use.');
    console.warn('===================================================================\n');
  }
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  isProduction: process.env.NODE_ENV === 'production',
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  dbPath: process.env.NODE_ENV === 'test' ? ':memory:' : 'lab_equipment.db',
  adminPassword: adminPassword,
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  port: Number(process.env.PORT) || 3000,
};
