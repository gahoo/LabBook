import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../src/db/index.js';

describe('Whitelist Module (10_whitelist.test.ts)', () => {
  let equipmentId: number;

  beforeEach(() => {
    // Clean up tables
    db.prepare('DELETE FROM whitelist_applications').run();
    db.prepare('DELETE FROM equipment').run();
    
    // Insert a test equipment with whitelist enabled
    const stmt = db.prepare(`
      INSERT INTO equipment (name, description, price_type, price, auto_approve, whitelist_enabled, whitelist_data) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run('Whitelist Test Equipment', 'Desc', 'hourly', 10, 1, 1, '');
    equipmentId = info.lastInsertRowid as number;
  });

  describe('User Apply Whitelist', () => {
    it('POST /api/whitelist/apply - should submit successfully', async () => {
      const payload = {
        equipment_id: equipmentId,
        student_id: 'S123',
        student_name: 'Test Student',
        supervisor: 'John Doe',
        phone: '1234567890',
        email: 'test@example.com'
      };

      const res = await request(app).post('/api/whitelist/apply').send(payload);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const apps = db.prepare('SELECT * FROM whitelist_applications').all() as any[];
      expect(apps.length).toBe(1);
      expect(apps[0].student_name).toBe('Test Student');
      expect(apps[0].status).toBe('pending');
    });

    it('POST /api/whitelist/apply - should reject invalid data', async () => {
      const invalidPayload = {
        equipment_id: equipmentId,
        student_id: '',
        student_name: 'Test Student',
        supervisor: 'John Doe 老师', // invalid keyword
        phone: '1234567890',
        email: 'test@example.com'
      };

      const res = await request(app).post('/api/whitelist/apply').send(invalidPayload);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('student_id 不能为空');

      const res2 = await request(app)
        .post('/api/whitelist/apply')
        .send({ ...invalidPayload, student_id: 'S123' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('导师姓名请直接填写真实姓名');
    });
  });

  describe('Admin Manage Whitelist', () => {
    let appId: number;
    let token: string;

    beforeEach(async () => {
      // Login admin to get token
      const loginRes = await request(app)
        .post('/api/admin/login')
        .send({ password: 'test-password' });
      
      // If login failed, it might be using default ADMIN_PASSWORD=admin
      const pwd = process.env.ADMIN_PASSWORD || 'admin';
      const loginRes2 = await request(app)
        .post('/api/admin/login')
        .send({ password: pwd });
      token = loginRes2.body.token || loginRes.body.token;

      // Insert an application
      const info = db.prepare(`
        INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(equipmentId, 'S999', 'Jane Doe', 'Dr. Smith', '0987654321', 'jane@example.com');
      appId = info.lastInsertRowid as number;
    });

    it('GET /api/admin/whitelist/applications - should list applications', async () => {
      const res = await request(app)
        .get('/api/admin/whitelist/applications')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].student_name).toBe('Jane Doe');
      expect(res.body[0].equipment_name).toBe('Whitelist Test Equipment');
    });

    it('GET /api/admin/whitelist/applications?status=pending - should filter by status', async () => {
      db.prepare(`
        INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email, status)
        VALUES (?, ?, ?, ?, ?, ?, 'approved')
      `).run(equipmentId, 'S888', 'Approved Student', 'Dr. Smith', '111', 'a@a.com');

      const res = await request(app)
        .get('/api/admin/whitelist/applications?status=pending')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('pending');
    });

    it('POST /api/admin/whitelist/applications/:id/approve - should approve and update equipment', async () => {
      const res = await request(app)
        .post(`/api/admin/whitelist/applications/${appId}/approve`)
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbApp = db.prepare('SELECT status FROM whitelist_applications WHERE id = ?').get(appId) as any;
      expect(dbApp.status).toBe('approved');

      const eq = db.prepare('SELECT whitelist_data FROM equipment WHERE id = ?').get(equipmentId) as any;
      expect(eq.whitelist_data).toContain('Jane Doe');
    });

    it('POST /api/admin/whitelist/applications/:id/reject - should reject', async () => {
      const res = await request(app)
        .post(`/api/admin/whitelist/applications/${appId}/reject`)
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbApp = db.prepare('SELECT status FROM whitelist_applications WHERE id = ?').get(appId) as any;
      expect(dbApp.status).toBe('rejected');
    });
  });
});
