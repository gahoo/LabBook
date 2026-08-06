import jwt from 'jsonwebtoken';

export function getAdminToken(): string {
  const secret = process.env.JWT_SECRET || 'test-secret';
  // Payload based on server.ts POST /api/admin/login
  return jwt.sign({ role: 'admin' }, secret, { expiresIn: '1h' });
}
