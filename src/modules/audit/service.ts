import { db } from '../../db/index.js';

export function recordAuditLog(action: string, newData: any, reservationId: number = 0) {
  db.prepare(`
    INSERT INTO audit_logs (reservation_id, action, new_data, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(reservationId, action, typeof newData === 'string' ? newData : JSON.stringify(newData));
}

export function getAuditLogs(startDate?: string, endDate?: string) {
  let query = `
    SELECT a.*, strftime('%Y-%m-%dT%H:%M:%fZ', a.created_at) AS created_at, r.booking_code 
    FROM audit_logs a
    LEFT JOIN reservations r ON a.reservation_id = r.id
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (startDate) {
    query += ` AND a.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    query += ` AND a.created_at <= ?`;
    params.push(endDate);
  }
  
  query += ` ORDER BY a.created_at DESC`;
  
  return db.prepare(query).all(...params) as any[];
}
