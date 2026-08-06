import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import jwt from 'jsonwebtoken';

describe('Auth Module (01_auth.test.ts)', () => {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const jwtSecret = process.env.JWT_SECRET || 'test-secret';

  describe('POST /api/admin/login', () => {
    it('should return 200 and a token when correct password is provided', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ password: adminPassword });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      
      // Verify token payload
      const decoded = jwt.verify(res.body.token, jwtSecret) as any;
      expect(decoded.role).toBe('admin');
    });

    it('should return 401 when incorrect password is provided', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: '密码错误' });
    });

    it('should return 401 when no password is provided', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: '密码错误' });
    });
  });

  describe('adminAuth Middleware', () => {
    // We use GET /api/admin/settings as a probe for the adminAuth middleware
    const probeRoute = '/api/admin/settings';

    it('should block requests without Authorization header', async () => {
      const res = await request(app).get(probeRoute);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('should block requests with malformed Authorization header', async () => {
      const res = await request(app)
        .get(probeRoute)
        .set('Authorization', 'Basic sometoken');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('should block requests with invalid token signature', async () => {
      const invalidToken = jwt.sign({ role: 'admin' }, 'wrong-secret');
      const res = await request(app)
        .get(probeRoute)
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('should block requests with valid token but incorrect role', async () => {
      const userToken = jwt.sign({ role: 'user' }, jwtSecret);
      const res = await request(app)
        .get(probeRoute)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    });

    it('should allow requests with valid admin token', async () => {
      const adminToken = jwt.sign({ role: 'admin' }, jwtSecret);
      const res = await request(app)
        .get(probeRoute)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // As long as it's not 401, the middleware passed. 
      // GET /api/admin/settings usually returns 200 with settings object.
    });
  });
});
