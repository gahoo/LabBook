import { Database } from 'better-sqlite3';
import nodemailer from 'nodemailer';

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

export async function dispatchWebhook(db: Database, event: string, data: Record<string, any>) {
  try {
    const settings = getSettingsMap(db);
    const webhookEnabled = settings['webhook.enabled'] === 'true';
    const eventEnabled = settings[`webhook.events.${event}.enabled`] === 'true';
    const url = settings['webhook.url'];
    
    if (!webhookEnabled || !eventEnabled || !url) {
      return;
    }

    const template = settings[`webhook.events.${event}.template`];
    if (!template) return;

    const payloadString = renderTemplate(template, data);
    let payload;
    try {
      payload = JSON.parse(payloadString);
    } catch (e) {
      console.error(`[Webhook] Failed to parse payload for event ${event}:`, e);
      return;
    }

    const headersStr = settings['webhook.headers'];
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (headersStr) {
      try {
        const customHeaders = JSON.parse(headersStr);
        headers = { ...headers, ...customHeaders };
      } catch (e) {
        console.warn('[Webhook] Invalid headers JSON');
      }
    }

    const secret = settings['webhook.secret'];
    if (secret) {
        // Optional signature logic could be added here in the future
    }

    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }).catch(err => {
      console.error(`[Webhook] Execution failed for event ${event}:`, err);
    });

  } catch (err) {
    console.error(`[Webhook] Error dispatching webhook for event ${event}:`, err);
  }
}

export async function dispatchEmail(db: Database, event: string, userEmail: string, data: Record<string, any>) {
  try {
    if (!userEmail) return;

    const settings = getSettingsMap(db);
    const smtpEnabled = settings['smtp.enabled'] === 'true';
    const eventEnabled = settings[`email.events.${event}.enabled`] === 'true';

    if (!smtpEnabled || !eventEnabled) {
      return;
    }

    const host = settings['smtp.host'];
    const port = parseInt(settings['smtp.port'] || '465', 10);
    const user = settings['smtp.user'];
    const pass = settings['smtp.pass'];
    const fromEmail = settings['smtp.from_email'];
    const fromName = settings['smtp.from_name'] || 'System';

    if (!host || !user || !pass || !fromEmail) {
      console.warn('[Email] SMTP configuration is incomplete');
      return;
    }

    const subjectTemplate = settings[`email.events.${event}.subject`] || 'Notification';
    const htmlTemplate = settings[`email.events.${event}.template`] || '';

    const subject = renderTemplate(subjectTemplate, data);
    const html = renderTemplate(htmlTemplate, data);

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      }
    });

    transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: userEmail,
      subject,
      html
    }).catch(err => {
      console.error(`[Email] Failed to send email to ${userEmail} for event ${event}:`, err);
    });
  } catch (err) {
    console.error(`[Email] Error dispatching email for event ${event}:`, err);
  }
}

export function notifyEvent(db: Database, event: string, data: Record<string, any>, userEmail?: string) {
  // Fire and forget
  dispatchWebhook(db, event, data);
  if (userEmail) {
    dispatchEmail(db, event, userEmail, data);
  }
}
