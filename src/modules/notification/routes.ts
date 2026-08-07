import { Router } from 'express';
import { db } from '../../db/index.js';
import { adminAuth } from '../../middleware/auth.js';
import { OperationRejectError } from '../../lib/errors.js';
import { scheduleNextRun } from './service.js';
import { marked } from 'marked';

export const notificationRoutes = Router();

notificationRoutes.post('/notifications/test-connection', adminAuth, async (req, res) => {
  const { type, config } = req.body;
  
  try {
    if (type === 'smtp') {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port || '465', 10),
        secure: parseInt(config.port || '465', 10) === 465,
        auth: { user: config.user, pass: config.pass }
      });
      await transporter.verify();
      res.json({ success: true, message: 'SMTP 连接成功' });
    } else if (type === 'webhook') {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers ? JSON.parse(config.headers) : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, message: 'Ping from booking system' }),
      });
      if (response.ok) {
        res.json({ success: true, message: `Webhook 测试成功, 状态码: ${response.status}` });
      } else {
        throw new OperationRejectError(`Webhook 响应异常, 状态码: ${response.status}`);
      }
    } else {
      res.status(400).json({ error: '不支持的类型' });
    }
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Test connection error:', error);
      res.status(500).json({ error: '连接测试失败: ' + (error.message || String(error)) });
    }
  }
});

notificationRoutes.post('/notifications/test-event', adminAuth, async (req, res) => {
  const { event, type, config, eventConfig } = req.body;
  
  // Mock Data
  const mockData: Record<string, string> = {
    booking_code: 'TEST-1234',
    student_id: '12345678',
    student_name: '测试用户',
    equipment_name: '蔡司LSM980激光共聚焦显微镜',
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 3600000).toISOString(),
    action: 'test_action',
    reason: '测试原因',
    resolution: 'approved',
    reply: '测试回复',
    advance_minutes: '30',
    calendar_url: 'webcal://example.com/api/calendar/user/TEST_TOKEN.ics'
  };

  try {
    const { renderTemplate } = await import('./service.js');
    
    if (type === 'webhook') {
      const payloadString = renderTemplate(eventConfig.template || '', mockData);
      let payload;
      try {
        payload = JSON.parse(payloadString);
      } catch(e) {
        throw new OperationRejectError('解析Webhook模板JSON失败');
      }
      
      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers ? JSON.parse(config.headers) : { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new OperationRejectError(`服务端返回 HTTP ${response.status}`);

      res.json({ success: true, message: 'Webhook 推送成功' });
      
    } else if (type === 'smtp') {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port || '465', 10),
        secure: parseInt(config.port || '465', 10) === 465,
        auth: { user: config.user, pass: config.pass }
      });
      
      const subject = renderTemplate(eventConfig.subject || '测试通知', mockData);
      const markdown = renderTemplate(eventConfig.template || '', mockData);
      const html = await marked.parse(markdown);
      
      const toEmail = req.body.to_email || config.user; // Send to themselves for testing if not provided

      await transporter.sendMail({
        from: `"${config.from_name || 'System'}" <${config.from_email || config.user}>`,
        to: toEmail,
        subject,
        html
      });

      res.json({ success: true, message: '邮件推送测试成功' });
    }
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Test event error:', error);
      res.status(500).json({ error: '测试推送失败: ' + (error.message || String(error)) });
    }
  }
});

notificationRoutes.get('/delivery-logs', adminAuth, (req, res) => {
  const { status, reference_code, target, events, startDate, endDate, page = '1', limit = '50' } = req.query;

  try {
    const rawLimit = parseInt(limit as string) || 50;
    const safeLimit = Math.min(rawLimit, 500);
    let query = `SELECT id, event, channel, target, reference_code, status, retry_count, next_retry_time, error_message, created_at, updated_at FROM notifications WHERE 1=1`;
    const params: any[] = [];
    
    if (status && status !== '全部' && status !== 'All') {
      const statusList = (status as string).split(',');
      const statusMap: Record<string, string> = {
        '待发送': 'pending',
        '重试中': 'retrying',
        '发送成功': 'success',
        '发送失败': 'failed'
      };
      
      const dbStatuses = statusList
        .map(s => statusMap[s] || s)
        .filter(s => ['pending', 'retrying', 'success', 'failed'].includes(s));
        
      if (dbStatuses.length > 0) {
        query += ` AND status IN (${dbStatuses.map(() => '?').join(',')})`;
        params.push(...dbStatuses);
      }
    }

    if (events && events !== '全部' && events !== 'All') {
      const eventList = (events as string).split(',').filter(Boolean);
      if (eventList.length > 0) {
        query += ` AND event IN (${eventList.map(() => '?').join(',')})`;
        params.push(...eventList);
      }
    }
    
    if (reference_code) {
      query += ` AND reference_code LIKE ?`;
      params.push(`%${reference_code}%`);
    }

    if (target) {
      query += ` AND target LIKE ?`;
      params.push(`%${target}%`);
    }

    if (startDate) {
      query += ` AND created_at >= ?`;
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query += ` AND created_at <= ?`;
      params.push(`${endDate}T23:59:59.999Z`);
    }

    const countQuery = query.replace('id, event, channel, target, reference_code, status, retry_count, next_retry_time, error_message, created_at, updated_at', 'count(*) as total');
    const totalRow = db.prepare(countQuery).get(...params) as any;
    const total = totalRow ? totalRow.total : 0;

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const offset = (Math.max(1, parseInt(page as string) || 1) - 1) * safeLimit;
    params.push(safeLimit, offset);

    const logs = db.prepare(query).all(...params) as any[];
    
    // Process webhook alias
    const webhookAliasRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.alias') as any;
    const webhookAlias = webhookAliasRow ? webhookAliasRow.value : 'Webhook';

    const processedLogs = logs.map(log => ({
        ...log,
        channel: log.channel === 'webhook' ? webhookAlias : log.channel
    }));

    res.json({ logs: processedLogs, total });
  } catch (error) {
    console.error('Error fetching delivery logs', error);
    res.status(500).json({ error: 'Failed to fetch delivery logs' });
  }
});

notificationRoutes.post('/delivery-logs/:id/retry', adminAuth, (req, res) => {
  try {
      db.prepare(`UPDATE notifications SET status = 'pending', retry_count = 0, next_retry_time = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
      setTimeout(() => { scheduleNextRun(db); }, 100);
      res.json({ success: true });
  } catch(e) {
      res.status(500).json({ error: 'Failed to retry' });
  }
});
