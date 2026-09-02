import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';

describe('Reservation Cost Recalculation', () => {
  let equipmentId: number;
  let reservationId: number;
  let token: string;

  beforeAll(async () => {
    db.prepare('DELETE FROM equipment').run();
        db.prepare('DELETE FROM reservations').run();

    // Create an hourly equipment with consumable fees
    const info = db.prepare(`
      INSERT INTO equipment (name, description, price_type, price, consumable_fee, auto_approve, whitelist_enabled, availability_json)
      VALUES (?, ?, ?, ?, ?, 1, 0, '[]')
    `).run('Cost Eq', 'Test', 'hour', 10.0, 5.0);
    equipmentId = info.lastInsertRowid as number;

        const pwd = process.env.ADMIN_PASSWORD || 'admin';
    const loginRes = await request(app).post('/api/admin/login').send({ password: pwd });
    token = loginRes.body.token;
  });

  afterAll(() => {
    db.prepare('DELETE FROM reservations').run();
    db.prepare('DELETE FROM equipment').run();
      });

  it('should auto-recalculate total_cost when actual_times are updated by admin', async () => {
    // 1. Create a reservation initially scheduled for 2 hours (10:00 to 12:00) with 1 consumable
    // total_cost should originally be 2 * 10 + 5 * 1 = 25
    const resInfo = db.prepare(`
      INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, total_cost, consumable_quantity, booking_code)
      VALUES (?, 'S001', 'Test', 'Sup', '123', 'a@b.com', '2027-10-10T10:00:00.000Z', '2027-10-10T12:00:00.000Z', 'active', 25.0, 1, 'B001')
    `).run(equipmentId);
    reservationId = resInfo.lastInsertRowid as number;

    // 2. Admin updates the reservation to reflect actual usage of 3 hours (10:00 to 13:00) and 2 consumables
    // New cost should be: 3 * 10 + 5 * 2 = 40
    const updateRes = await request(app)
      .put(`/api/admin/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        actual_start_time: '2027-10-10T10:00:00.000Z',
        actual_end_time: '2027-10-10T13:00:00.000Z',
        consumable_quantity: 2
      });
    
    expect(updateRes.status).toBe(200);

    // 3. Verify in database
    const updated = db.prepare('SELECT total_cost FROM reservations WHERE id = ?').get(reservationId) as any;
    expect(updated.total_cost).toBe(40.0);
  });

  it('should respect explicitly provided total_cost by admin over recalculation', async () => {
    // 1. Create another reservation
    const resInfo = db.prepare(`
      INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, total_cost, consumable_quantity, booking_code)
      VALUES (?, 'S002', 'Test2', 'Sup', '123', 'a@b.com', '2027-10-11T10:00:00.000Z', '2027-10-11T12:00:00.000Z', 'active', 25.0, 1, 'B002')
    `).run(equipmentId);
    const rId = resInfo.lastInsertRowid as number;

    // 2. Admin updates actual usage to 3 hours but explicitly sets total_cost to 999
    const updateRes = await request(app)
      .put(`/api/admin/reservations/${rId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        actual_start_time: '2027-10-11T10:00:00.000Z',
        actual_end_time: '2027-10-11T13:00:00.000Z',
        total_cost: 999.0
      });
    
    expect(updateRes.status).toBe(200);

    const updated = db.prepare('SELECT total_cost FROM reservations WHERE id = ?').get(rId) as any;
    expect(updated.total_cost).toBe(999.0); // Should override!
  });
});
