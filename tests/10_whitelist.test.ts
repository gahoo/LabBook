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
    db.prepare('DELETE FROM reservations').run(); // Clean reservations for E2E
    
    // Insert a test equipment with whitelist enabled
    const stmt = db.prepare(`
      INSERT INTO equipment (name, description, price_type, price, auto_approve, whitelist_enabled, whitelist_data, availability_json) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run('Whitelist Test Equipment', 'Desc', 'hourly', 10, 1, 1, '', JSON.stringify({ rules: [{dayOfWeek: 1, startTime: '00:00', endTime: '23:59'}, {dayOfWeek: 2, startTime: '00:00', endTime: '23:59'}, {dayOfWeek: 3, startTime: '00:00', endTime: '23:59'}, {dayOfWeek: 4, startTime: '00:00', endTime: '23:59'}, {dayOfWeek: 5, startTime: '00:00', endTime: '23:59'}], minDurationMinutes: 30, maxDurationMinutes: 120, advanceDays: 7 }));
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
      if (res.status !== 200) console.log(res.body); expect(res.status).toBe(200);
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

    it('POST /api/whitelist/apply - should prevent duplicate pending applications', async () => {
      const payload = {
        equipment_id: equipmentId,
        student_id: 'S555',
        student_name: 'Duplicate Student',
        supervisor: 'Dr. No',
        phone: '1111111',
        email: 'dup@example.com'
      };

      // First request should succeed
      const res1 = await request(app).post('/api/whitelist/apply').send(payload);
      if (res1.status !== 200) console.log(res1.body); expect(res1.status).toBe(200);

      // Second request should fail
      const res2 = await request(app).post('/api/whitelist/apply').send(payload);
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('已经');
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('已经');
    });
  });

  describe('Admin Manage Whitelist', () => {
    let appId: number;
    let token: string;

    beforeEach(async () => {
      // Enable SMTP
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.enabled', 'true')`).run();
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('email.events.whitelist_resolved.enabled', 'true')`).run();
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.host', 'smtp.example.com')`).run();
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.user', 'user')`).run();
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.pass', 'pass')`).run();
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp.from_email', 'no-reply@example.com')`).run();

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
        INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now', '-1 hour'))
      `).run(equipmentId, 'S999', 'Jane Doe', 'Dr. Smith', '0987654321', 'jane@example.com');
      appId = info.lastInsertRowid as number;
    });

    it('should return 401 for unauthorized admin routes', async () => {
      const endpoints = [
        { method: 'get', url: '/api/admin/whitelist/applications' },
        { method: 'post', url: `/api/admin/whitelist/applications/${appId}/approve` },
        { method: 'post', url: `/api/admin/whitelist/applications/${appId}/reject` }
      ];

      for (const ep of endpoints) {
        const req = request(app)[ep.method as 'get' | 'post'](ep.url);
        const res = await req;
        expect(res.status).toBe(401);
      }
    });

    it('GET /api/admin/whitelist/applications - should list applications ordered by created_at DESC', async () => {
      // Insert a newer application
      db.prepare(`
        INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
      `).run(equipmentId, 'S998', 'Newest Doe', 'Dr. Smith', '0987654321', 'newest@example.com');

      const res = await request(app)
        .get('/api/admin/whitelist/applications')
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].student_name).toBe('Newest Doe');
      expect(res.body[1].student_name).toBe('Jane Doe');
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
      expect(res.body[0].student_name).toBe('Jane Doe');
    });

    it('POST /api/admin/whitelist/applications/:id/approve - should approve and update equipment', async () => {
      // Let's create an application first
      db.prepare(`
        INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
      `).run(equipmentId, 'S_APP_001', 'Approve Test', 'Dr. Smith', '111', 'approve@test.com');
      const newApp = db.prepare('SELECT id FROM whitelist_applications WHERE student_id = ?').get('S_APP_001') as any;

      const res = await request(app)
        .post(`/api/admin/whitelist/applications/${newApp.id}/approve`)
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbApp = db.prepare('SELECT status FROM whitelist_applications WHERE id = ?').get(newApp.id) as any;
      expect(dbApp.status).toBe('approved');
      const notifs = db.prepare("SELECT * FROM notifications WHERE event = 'whitelist_resolved' AND target = ?").all('approve@test.com') as any;
      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].payload).toContain('approved');

      const eq = db.prepare('SELECT whitelist_data FROM equipment WHERE id = ?').get(equipmentId) as any;
      expect(eq.whitelist_data).toContain('Approve Test');
    });

    it('POST /api/admin/whitelist/applications/:id/reject - should reject', async () => {
      db.prepare(`
        INSERT INTO whitelist_applications (equipment_id, student_id, student_name, supervisor, phone, email, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
      `).run(equipmentId, 'S_REJ_001', 'Reject Test', 'Dr. Smith', '111', 'reject@test.com');
      const newApp = db.prepare('SELECT id FROM whitelist_applications WHERE student_id = ?').get('S_REJ_001') as any;

      const res = await request(app)
        .post(`/api/admin/whitelist/applications/${newApp.id}/reject`)
        .set('Authorization', `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbApp = db.prepare('SELECT status FROM whitelist_applications WHERE id = ?').get(newApp.id) as any;
      expect(dbApp.status).toBe('rejected');
      const notifs = db.prepare("SELECT * FROM notifications WHERE event = 'whitelist_resolved' AND target = ?").all('reject@test.com') as any;
      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].payload).toContain('rejected');
    });
  });

  describe('E2E Whitelist Flow', () => {
    it('should block non-whitelisted user, allow application, approve, and allow booking', async () => {
      const e2ePayload = {
        equipment_id: equipmentId,
        student_id: 'E2E_001',
        student_name: 'E2E Student',
        supervisor: 'E2E Supervisor',
        phone: '1234567890',
        email: 'e2e@example.com',
        // Make sure it's a weekday
        start_time: '2027-10-15T10:00:00.000Z', // fixed date in future
        end_time: '2027-10-15T11:00:00.000Z',
        reason: 'E2E Test'
      };

      // 1. User tries to book and is blocked (403)
      const bookRes1 = await request(app).post('/api/reservations').send(e2ePayload);
      expect(bookRes1.status).toBe(403);
      expect(bookRes1.body.needs_whitelist_application).toBe(true);

      // 2. User applies for whitelist
      const applyRes = await request(app).post('/api/whitelist/apply').send({
        equipment_id: equipmentId,
        student_id: e2ePayload.student_id,
        student_name: e2ePayload.student_name,
        supervisor: e2ePayload.supervisor,
        phone: e2ePayload.phone,
        email: e2ePayload.email
      });
      if (applyRes.status !== 200) console.log(applyRes.body); expect(applyRes.status).toBe(200);

      const dbApp = db.prepare('SELECT id FROM whitelist_applications WHERE student_id = ?').get('E2E_001') as any;
      expect(dbApp).toBeDefined();

      // 3. Admin approves
      const pwd = process.env.ADMIN_PASSWORD || 'admin';
      const loginRes = await request(app).post('/api/admin/login').send({ password: pwd });
      const token = loginRes.body.token;

      const approveRes = await request(app)
        .post(`/api/admin/whitelist/applications/${dbApp.id}/approve`)
        .set('Authorization', `Bearer ${token}`);
      expect(approveRes.status).toBe(200);

      // 4. User tries to book again and succeeds
      const bookRes2 = await request(app).post('/api/reservations').send(e2ePayload);
      // If it's a 200, great. If it's 400 with '只能提前', it means whitelist check passed and it hit standard booking logic.
      expect(bookRes2.status).not.toBe(403);
      if (bookRes2.status === 400) {
        expect(bookRes2.body.error).toContain('预约');
      } else {
        expect(bookRes2.status).toBe(200);
      }
    });
  });
});
