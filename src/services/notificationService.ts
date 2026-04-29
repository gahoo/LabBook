import { Database } from 'better-sqlite3';
import nodemailer from 'nodemailer';
import { marked } from 'marked';
import { format } from 'date-fns';

export function renderTemplate(template: string, data: Record<string, any>): string {
  if (!template) return '';
  return template.replace(/\{\{\s*(.*?)\s*\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}

function getSettingsMap(db: Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string, value: string }[];
  return rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {} as Record<string, string>);
}

function enqueueNotification(db: Database, event: string, channel: string, target: string, referenceCode: string, payload: string) {
  try {
    db.prepare(`
      INSERT INTO notifications (event, channel, target, reference_code, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(event, channel, target, referenceCode, payload);
    
    // Asynchronously trigger the processor
    setTimeout(() => {
      scheduleNextRun(db);
    }, 100);
  } catch (err) {
    console.error(`[Enqueue] Failed to enqueue ${channel} notification for ${event}:`, err);
  }
}

export async function dispatchWebhook(db: Database, event: string, data: Record<string, any>) {
  try {
    const settings = getSettingsMap(db);
    const webhookEnabled = settings['webhook.enabled'] === 'true';
    const eventEnabled = settings[`webhook.events.${event}.enabled`] === 'true';
    const url = settings['webhook.url'];
    
    if (!webhookEnabled || !eventEnabled || !url) return;

    const template = settings[`webhook.events.${event}.template`];
    if (!template) return;

    const payloadString = renderTemplate(template, data);
    let payload;
    try {
      payload = JSON.parse(payloadString);
    } catch (e) {
      console.error(`[Webhook Enqueue] Failed to parse payload for event ${event}:`, e);
      return;
    }
    
    const referenceCode = data.booking_code || data.reservation_id || '';
    
    const queuePayload = JSON.stringify({
       url,
       method: 'POST',
       headers: settings['webhook.headers'] ? JSON.parse(settings['webhook.headers']) : { 'Content-Type': 'application/json' },
       body: payload
    });

    enqueueNotification(db, event, 'webhook', url, referenceCode, queuePayload);

  } catch (err) {
    console.error(`[Webhook Enqueue] Error dispatching webhook for event ${event}:`, err);
  }
}

const DEFAULT_EMAIL_TEMPLATES: Record<string, {subject: string, template: string}> = {
  booking_created: {
    subject: '[通知] 预约成功：{{ equipment_name }}',
    template: '## 预约成功\n\n您好，您已成功预约 **{{ equipment_name }}**。\n\n**预约详情：**\n- 预约码：{{ booking_code }}\n- 开始时间：{{ start_time }}\n- 结束时间：{{ end_time }}\n\n您可以使用预约码在网页端或设备端进行上机。\n[点击查看您的预约详情]({{ BASE_URL }}/my-reservations?code={{ booking_code }})'
  },
  booking_approved: {
    subject: '[通知] 您的预约已通过审批',
    template: '## 审批通过\n\n您好，您对 **{{ equipment_name }}** 的预约申请已通过。\n\n- 预约码：{{ booking_code }}\n- 开始时间：{{ start_time }}\n- 结束时间：{{ end_time }}\n\n[点击查看预约]({{ BASE_URL }}/my-reservations?code={{ booking_code }})'
  },
  booking_rejected: {
    subject: '[通知] 您的预约被驳回',
    template: '## 预约被驳回\n\n非常抱歉，您对 **{{ equipment_name }}** 的预约申请未通过审批。'
  },
  booking_cancelled: {
    subject: '[通知] 预约取消',
    template: '## 预约已取消\n\n您的预约已取消。\n\n- 设备：{{ equipment_name }}\n- 预约码：{{ booking_code }}'
  },
  violation_created: {
    subject: '[警告] 新的违规记录',
    template: '## 违规记录\n\n您好，系统检测到您存在一条新的违规记录。\n\n- 违规类型：{{ violation_type }}\n- 关联设备：{{ equipment_name }}\n\n如有异议，请在系统内提交申诉。'
  },
  appeal_resolved: {
    subject: '[通知] 违规申诉结果',
    template: '## 申诉处理结果\n\n您的违规记录申诉已由管理员处理。\n\n- 处理结果：{{ resolution }}\n- 管理员回复：{{ reply }}'
  },
  whitelist_resolved: {
    subject: '[通知] 白名单申请结果',
    template: '## 白名单申请处理完毕\n\n您对 **{{ equipment_name }}** 的白名单准入申请已出结果。\n\n- 状态：{{ resolution }}\n- 备注：{{ reason }}'
  },
  penalty_triggered: {
    subject: '[警告] 处罚生效',
    template: '## 处罚触发通知\n\n由于累计多次违规，您已触发系统限制。\n\n- 限制方式：{{ penalty_method }}\n- 原因：{{ reason }}'
  }
};

export async function dispatchEmail(db: Database, event: string, userEmail: string | undefined, data: Record<string, any>) {
  try {
    const settings = getSettingsMap(db);
    const smtpEnabled = settings['smtp.enabled'] === 'true';
    if (!smtpEnabled) return;

    const eventEnabled = settings[`email.events.${event}.enabled`] === 'true';
    if (!eventEnabled) return;
    
    const notifyUser = settings[`email.events.${event}.notify_user`] !== 'false'; // default true for backward compat
    const notifyAdmin = settings[`email.events.${event}.notify_admin`] === 'true';

    const adminEmailsStr = settings['smtp.admin_emails'] || '';
    const adminEmails = adminEmailsStr.split(',').map(e => e.trim()).filter(Boolean);

    const targetEmails = new Set<string>();
    
    if (notifyUser && userEmail) {
      targetEmails.add(userEmail);
    }
    
    if (notifyAdmin && adminEmails.length > 0) {
      for (const ae of adminEmails) {
        targetEmails.add(ae);
      }
    }

    if (targetEmails.size === 0) return;

    const host = settings['smtp.host'];
    const port = parseInt(settings['smtp.port'] || '465', 10);
    const user = settings['smtp.user'];
    const pass = settings['smtp.pass'];
    const fromEmail = settings['smtp.from_email'];
    const fromName = settings['smtp.from_name'] || 'System';

    if (!host || !user || !pass || !fromEmail) {
      console.warn('[Email Enqueue] SMTP configuration is incomplete');
      return;
    }

    const subjectTemplate = settings[`email.events.${event}.subject`] ?? DEFAULT_EMAIL_TEMPLATES[event]?.subject ?? '通知';
    const markdownTemplate = settings[`email.events.${event}.template`] ?? DEFAULT_EMAIL_TEMPLATES[event]?.template ?? '';

    const subject = renderTemplate(subjectTemplate, data);
    const renderedMarkdown = renderTemplate(markdownTemplate, data);
    
    // Parse markdown to HTML
    const html = await marked.parse(renderedMarkdown);

    const referenceCode = data.booking_code || data.reservation_id || '';

    for (const target of targetEmails) {
      const queuePayload = JSON.stringify({
        smtp: { host, port, user, pass, fromEmail, fromName },
        message: {
          to: target,
          subject,
          html
        }
      });
      enqueueNotification(db, event, 'email', target, referenceCode, queuePayload);
    }

  } catch (err) {
    console.error(`[Email Enqueue] Error dispatching email for event ${event}:`, err);
  }
}

export function notifyEvent(db: Database, event: string, data: Record<string, any>, userEmail?: string) {
  const enhancedData: Record<string, any> = {
      BASE_URL: GLOBAL_BASE_URL,
      ...data
  };

  // Format dates for humans if they exist
  if (enhancedData.start_time) {
      try {
          enhancedData.start_time = format(new Date(enhancedData.start_time), 'yyyy-MM-dd HH:mm');
      } catch (e) {}
  }
  if (enhancedData.end_time) {
      try {
          enhancedData.end_time = format(new Date(enhancedData.end_time), 'yyyy-MM-dd HH:mm');
      } catch (e) {}
  }

  dispatchWebhook(db, event, enhancedData);
  dispatchEmail(db, event, userEmail, enhancedData);
}

// Queue Processor
let isProcessing = false;
let nextRunTimer: NodeJS.Timeout | null = null;
let GLOBAL_BASE_URL = 'http://localhost:3000';

export function setBaseUrl(url: string) {
  GLOBAL_BASE_URL = url;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoff(retryCount: number): number {
  // 1m, 5m, 15m, 30m, 60m...
  const intervals = [1, 5, 15, 30, 60];
  const idx = Math.min(retryCount, intervals.length - 1);
  return intervals[idx] * 60 * 1000;
}

export function scheduleNextRun(db: Database) {
  if (nextRunTimer) {
    clearTimeout(nextRunTimer);
    nextRunTimer = null;
  }
  
  if (isProcessing) return; // processNotificationQueue will call this again in its finally block

  try {
    const nextRow = db.prepare(`
      SELECT strftime('%s', next_retry_time) AS next_sec 
      FROM notifications 
      WHERE status IN ('pending', 'retrying') 
      ORDER BY strftime('%s', next_retry_time) ASC LIMIT 1
    `).get() as any;

    if (nextRow && nextRow.next_sec) {
      const delay = (parseInt(nextRow.next_sec, 10) * 1000) - Date.now();
      if (delay <= 0) {
        processNotificationQueue(db).catch(console.error);
      } else {
        nextRunTimer = setTimeout(() => {
          processNotificationQueue(db).catch(console.error);
        }, delay);
      }
    }
  } catch (err) {
    console.error('[NotificationProcessor] Failed to schedule next run:', err);
  }
}

export async function processNotificationQueue(db: Database) {
  if (isProcessing) return;
  isProcessing = true;

  if (nextRunTimer) {
    clearTimeout(nextRunTimer);
    nextRunTimer = null;
  }

  try {
    const settings = getSettingsMap(db);
    const intervalSeconds = parseInt(settings['notification_interval_seconds'] || '1', 10);
    const maxRetries = 5;

    while (true) {
      db.transaction(() => {})(); // ping DB / start logical block

      const pendingRow = db.prepare(`
        SELECT * FROM notifications 
        WHERE status IN ('pending', 'retrying') 
        AND strftime('%s', next_retry_time) <= strftime('%s', 'now')
        ORDER BY id ASC LIMIT 1
      `).get() as any;

      if (!pendingRow) {
        break; // No more tasks
      }

      // Mark as retrying
      db.prepare(`UPDATE notifications SET status = 'retrying', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(pendingRow.id);

      let success = false;
      let errorMsg = '';

      try {
        const payloadData = JSON.parse(pendingRow.payload);

        if (pendingRow.channel === 'webhook') {
          const res = await fetch(payloadData.url, {
            method: payloadData.method,
            headers: payloadData.headers,
            body: JSON.stringify(payloadData.body)
          });
          
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`HTTP Error ${res.status}: ${body}`);
          }
          success = true;
        } else if (pendingRow.channel === 'email') {
          const { smtp, message } = payloadData;
          const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            auth: {
              user: smtp.user,
              pass: smtp.pass
            }
          });

          await transporter.sendMail({
            from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
            to: message.to,
            subject: message.subject,
            html: message.html
          });
          success = true;
        }
      } catch (err: any) {
        success = false;
        errorMsg = err.message || String(err);
      }

      if (success) {
        db.prepare(`UPDATE notifications SET status = 'success', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(pendingRow.id);
      } else {
        const newRetryCount = pendingRow.retry_count + 1;
        if (newRetryCount >= maxRetries) {
          db.prepare(`UPDATE notifications SET status = 'failed', retry_count = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(newRetryCount, errorMsg, pendingRow.id);
        } else {
          const backoffTimeMs = calculateBackoff(newRetryCount);
          db.prepare(`UPDATE notifications SET status = 'retrying', retry_count = ?, next_retry_time = datetime('now', '+' || ? || ' seconds'), error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(newRetryCount, Math.floor(backoffTimeMs / 1000), errorMsg, pendingRow.id);
        }
      }

      // Rate limit based on global settings
      await sleep(intervalSeconds * 1000);
    }
  } catch (err) {
    console.error('[NotificationProcessor] Error:', err);
  } finally {
    isProcessing = false;
    scheduleNextRun(db);
  }
}
