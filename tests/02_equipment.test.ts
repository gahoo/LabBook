import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';

describe('Equipment Module (02_equipment.test.ts)', () => {
  let adminToken: string;
  let eqId: number;

  beforeAll(async () => {
    // Clear equipment table for clean state
    db.prepare('DELETE FROM equipment').run();
    db.prepare('DELETE FROM reservations').run();

    const pwd = process.env.ADMIN_PASSWORD || 'admin';
    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({ password: pwd });
    adminToken = loginRes.body.token;
  });

  describe('CRUD Operations', () => {
    it('POST /api/admin/equipment - should create equipment', async () => {
      const payload = {
        name: 'Test Microscope',
        description: 'A very nice microscope',
        image_url: '',
        location: 'Room 101',
        availability_json: JSON.stringify({
          rules: [{ day: 1, start: '09:00', end: '17:00' }], // Monday
          advanceDays: 7,
          maxDurationMinutes: 120,
          minDurationMinutes: 30
        }),
        auto_approve: true,
        price_type: 'hourly',
        price: 50,
        consumable_fee: 10,
        whitelist_enabled: false
      };

      const res = await request(app)
        .post('/api/admin/equipment')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      eqId = res.body.id;
    });

    it('GET /api/equipment - should list equipment', async () => {
      const res = await request(app).get('/api/equipment');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].name).toBe('Test Microscope');
    });

    it('PUT /api/admin/equipment/:id - should update equipment', async () => {
      const payload = {
        name: 'Updated Microscope',
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
      };

      const res = await request(app)
        .put(`/api/admin/equipment/${eqId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbEq = db.prepare('SELECT name, release_noshow_slots, auto_approve FROM equipment WHERE id = ?').get(eqId) as any;
      expect(dbEq.name).toBe('Updated Microscope');
      expect(dbEq.release_noshow_slots).toBe(1);
      expect(dbEq.auto_approve).toBe(0);
    });

    it('PUT /api/admin/equipment-batch - should update multiple equipment', async () => {
      const res = await request(app)
        .put('/api/admin/equipment-batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ids: [eqId],
          updates: {
            advanceDays: 20,
            auto_approve: true,
            allowOutOfHours: true
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbEq = db.prepare('SELECT auto_approve, availability_json FROM equipment WHERE id = ?').get(eqId) as any;
      expect(dbEq.auto_approve).toBe(1);
      const avail = JSON.parse(dbEq.availability_json);
      expect(avail.advanceDays).toBe(20);
      expect(avail.allowOutOfHours).toBe(true);
    });
  });

  describe('Availability & Reservations API', () => {
    beforeAll(() => {
      // Set fixed rules so it works any day
      db.prepare(`UPDATE equipment SET availability_json = ? WHERE id = ?`).run(
        JSON.stringify({
          rules: Array.from({length: 7}).map((_, i) => ({ day: i, start: '00:00', end: '23:59' })),
          advanceDays: 7
        }),
        eqId
      );
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

    it('GET /api/equipment/:id/availability - should return availability for range', async () => {
      const d1 = new Date().toISOString().split('T')[0];
      const res = await request(app).get(`/api/equipment/${eqId}/availability?date=${d1}`);
      expect(res.status).toBe(200);
      expect(res.body.reservations).toBeDefined();
    });

    it('GET /api/equipment/:id/reservations - should return reservations within range', async () => {
      // Insert a dummy reservation
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
});
