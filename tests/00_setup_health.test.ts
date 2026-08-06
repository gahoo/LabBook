import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { getAdminToken } from './utils/auth-helper.js';

describe('Test Infrastructure Health', () => {
  it('should be able to reach public endpoints', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('app_name');
  });

  it('should block unauthorized access to admin endpoints', async () => {
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(401);
  });

  it('should allow authorized access to admin endpoints', async () => {
    const token = getAdminToken();
    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
