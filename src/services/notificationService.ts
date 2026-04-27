import { Database } from 'better-sqlite3';
import nodemailer from 'nodemailer';
import { marked } from 'marked';

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
      processNotificationQueue(db).catch(console.error);
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

    const subjectTemplate = settings[`email.events.${event}.subject`] || '通知';
    const markdownTemplate = settings[`email.events.${event}.template`] || '';

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
  dispatchWebhook(db, event, data);
  dispatchEmail(db, event, userEmail, data);
}

// Queue Processor
let isProcessing = false;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoff(retryCount: number): number {
  // 1m, 5m, 15m, 30m, 60m...
  const intervals = [1, 5, 15, 30, 60];
  const idx = Math.min(retryCount, intervals.length - 1);
  return intervals[idx] * 60 * 1000;
}

export async function processNotificationQueue(db: Database) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const settings = getSettingsMap(db);
    const intervalSeconds = parseInt(settings['notification_interval_seconds'] || '1', 10);
    const maxRetries = 5;

    while (true) {
      db.transaction(() => {})(); // ping DB / start logical block

      const pendingRow = db.prepare(`
        SELECT * FROM notifications 
        WHERE status IN ('pending', 'retrying') 
        AND next_retry_time <= CURRENT_TIMESTAMP
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
          const backoffTime = calculateBackoff(newRetryCount);
          const nextRetry = new Date(Date.now() + backoffTime).toISOString();
          db.prepare(`UPDATE notifications SET status = 'retrying', retry_count = ?, next_retry_time = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(newRetryCount, nextRetry, errorMsg, pendingRow.id);
        }
      }

      // Rate limit based on global settings
      await sleep(intervalSeconds * 1000);
    }
  } catch (err) {
    console.error('[NotificationProcessor] Error:', err);
  } finally {
    isProcessing = false;
  }
}
