import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';
import jwt from 'jsonwebtoken';

describe('Equipment Module (02_equipment.test.ts)', () => {
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    // Generate valid admin token via login
    const pwd = process.env.ADMIN_PASSWORD || 'admin';
    const adminLoginRes = await request(app)
      .post('/api/admin/login')
      .send({ password: pwd });
    adminToken = adminLoginRes.body.token;

    // Generate a fake user token for 401 testing (since there is no user login system)
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_tests';
    userToken = jwt.sign({ role: 'user' }, secret);
  });

  // Helper to create an equipment for tests
  const createTestEquipment = (overrides: any = {}) => {
    const info = db.prepare(`
      INSERT INTO equipment (name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      overrides.name || 'Test Equipment',
      overrides.description || 'Desc',
      '',
      'Room 1',
      overrides.availability_json || JSON.stringify({ advanceDays: 7, rules: [{ day: 1, start: '09:00', end: '17:00' }] }),
      1,
      'hourly',
      50,
      0,
      0,
      '',
      0,
      0
    );
    return info.lastInsertRowid as number;
  };

  describe('Auth Negative Tests', () => {
    it('should reject unauthorized access (401) for admin endpoints', async () => {
      // 1. No token
      await request(app).post('/api/admin/equipment').send({}).expect(401);
      await request(app).put('/api/admin/equipment/1').send({}).expect(401);
      await request(app).put('/api/admin/equipment-batch').send({}).expect(401);
      await request(app).delete('/api/admin/equipment/1').expect(401);

      // 2. User token
      await request(app).post('/api/admin/equipment').set('Authorization', `Bearer ${userToken}`).send({}).expect(401);
      await request(app).put('/api/admin/equipment/1').set('Authorization', `Bearer ${userToken}`).send({}).expect(401);
      await request(app).put('/api/admin/equipment-batch').set('Authorization', `Bearer ${userToken}`).send({}).expect(401);
      await request(app).delete('/api/admin/equipment/1').set('Authorization', `Bearer ${userToken}`).expect(401);
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM reservations').run();
      db.prepare('DELETE FROM whitelist_applications').run();
      db.prepare('DELETE FROM equipment').run();
    });

    it('POST /api/admin/equipment - should create equipment', async () => {
      const payload = {
        name: 'Test Microscope',
        description: 'A very nice microscope',
        location: 'Room 101',
        availability_json: JSON.stringify({ advanceDays: 7 }),
        auto_approve: true,
        price_type: 'hourly',
        price: 50,
      };

      const res = await request(app)
        .post('/api/admin/equipment')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
    });

    it('GET /api/equipment - should list equipment', async () => {
      createTestEquipment({ name: 'Test Microscope' });
      const res = await request(app).get('/api/equipment');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].name).toBe('Test Microscope');
    });

    it('PUT /api/admin/equipment/:id - should update equipment', async () => {
      const eqId = createTestEquipment({ name: 'Old Name' });
      const res = await request(app)
        .put(`/api/admin/equipment/${eqId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Updated Name',
          description: 'Updated desc',
          image_url: '',
          location: 'Room 102',
          availability_json: JSON.stringify({ advanceDays: 14 }),
          auto_approve: false,
          price_type: 'hourly',
          price: 60,
          consumable_fee: 15,
          whitelist_enabled: true,
          release_noshow_slots: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbEq = db.prepare('SELECT name, auto_approve FROM equipment WHERE id = ?').get(eqId) as any;
      expect(dbEq.name).toBe('Updated Name');
      expect(dbEq.auto_approve).toBe(0);
    });

    it('DELETE /api/admin/equipment/:id - should delete equipment', async () => {
      const eqId = createTestEquipment();
      const res = await request(app)
        .delete(`/api/admin/equipment/${eqId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(res.status).toBe(200);
      
      const check = db.prepare('SELECT * FROM equipment WHERE id = ?').get(eqId);
      expect(check).toBeUndefined();
    });

    it('PUT /api/admin/equipment-batch - should intercept invalid ids', async () => {
      const res = await request(app)
        .put('/api/admin/equipment-batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [], updates: {} });
      expect(res.status).toBe(400);
      
      const res2 = await request(app)
        .put('/api/admin/equipment-batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ updates: {} });
      expect(res2.status).toBe(400);
    });

    it('PUT /api/admin/equipment-batch - should update multiple equipment', async () => {
      const eqId1 = createTestEquipment();
      const eqId2 = createTestEquipment();

      const res = await request(app)
        .put('/api/admin/equipment-batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ids: [eqId1, eqId2],
          updates: { advanceDays: 20 }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbEq1 = db.prepare('SELECT availability_json FROM equipment WHERE id = ?').get(eqId1) as any;
      const dbEq2 = db.prepare('SELECT availability_json FROM equipment WHERE id = ?').get(eqId2) as any;
      
      expect(JSON.parse(dbEq1.availability_json).advanceDays).toBe(20);
      expect(JSON.parse(dbEq2.availability_json).advanceDays).toBe(20);
    });
  });

  describe('Availability & Reservations API', () => {
    let eqId: number;
    beforeEach(() => {
      db.prepare('DELETE FROM reservations').run();
      db.prepare('DELETE FROM whitelist_applications').run();
      db.prepare('DELETE FROM equipment').run();
      eqId = createTestEquipment({
        availability_json: JSON.stringify({
          rules: Array.from({length: 7}).map((_, i) => ({ day: i, start: '00:00', end: '23:59' })),
          advanceDays: 7,
          minDurationMinutes: 30,
          maxDurationMinutes: 120
        })
      });
    });

    it('GET /api/equipment/availability/today - should return today availability', async () => {
      const res = await request(app).get('/api/equipment/availability/today');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const eq = res.body.find((e: any) => e.equipment_id == eqId);
      expect(eq).toBeDefined();
      expect(eq.availableSlots).toBeDefined();
      expect(eq.reservations).toBeDefined();
    });

    it('GET /api/equipment/:id/availability - should return 400 if date is missing', async () => {
      const res = await request(app).get(`/api/equipment/${eqId}/availability`);
      expect(res.status).toBe(400);
    });

    it('GET /api/equipment/:id/availability - should return 404 if eq not found', async () => {
      const res = await request(app).get(`/api/equipment/99999/availability?date=2026-01-01`);
      expect(res.status).toBe(404);
    });

    it('GET /api/equipment/:id/availability - should intercept out of advanceDays limit', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10); // advanceDays is 7
      const dStr = futureDate.toISOString().split('T')[0];
      const res = await request(app).get(`/api/equipment/${eqId}/availability?date=${dStr}`);
      
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('仅支持提前');
      expect(res.body.availableSlots.length).toBe(0);
    });

    it('GET /api/equipment/:id/availability - should return availability for range', async () => {
      const d1 = new Date().toISOString().split('T')[0];
      const res = await request(app).get(`/api/equipment/${eqId}/availability?date=${d1}`);
      expect(res.status).toBe(200);
      expect(res.body.reservations).toBeDefined();
    });

    it('GET /api/equipment/:id/reservations - should return reservations within range', async () => {
      db.prepare(`
        INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, start_time, end_time, status, phone, email, booking_code)
        VALUES (?, 'S1', 'Tester', 'Sup', datetime('now'), datetime('now', '+1 hour'), 'approved', '123456', 'test@test.com', 'AABB11')
      `).run(eqId);

      const start = new Date(Date.now() - 86400000).toISOString();
      const end = new Date(Date.now() + 86400000).toISOString();

      const res = await request(app).get(`/api/equipment/${eqId}/reservations?start=${start}&end=${end}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].student_name).toBe('Tester');
    });
  });

  describe('Regression Tests (P0 Bug)', () => {
    let eqId: number;
    beforeEach(() => {
      db.prepare('DELETE FROM reservations').run();
      db.prepare('DELETE FROM whitelist_applications').run();
      db.prepare('DELETE FROM equipment').run();
      
      // 1. Manually create equipment without 'rules' in availability_json
      const info = db.prepare(`
        INSERT INTO equipment (name, price_type, price, availability_json)
        VALUES (?, 'hourly', 0, ?)
      `).run('P0 Test Eq', JSON.stringify({ advanceDays: 14 }));
      eqId = info.lastInsertRowid as number;
    });

    it('should not crash with 500 when availability.rules is missing', async () => {
      // 2. Call the availability endpoint
      const d1 = new Date().toISOString().split('T')[0];
      const res = await request(app).get(`/api/equipment/${eqId}/availability?date=${d1}`);
      
      // 3. Should return 200 instead of 500
      expect(res.status).toBe(200);
    });
  });
});
