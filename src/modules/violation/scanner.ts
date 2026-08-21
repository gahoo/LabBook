import { db } from '../../db/index.js';
import { evaluatePenaltiesOnViolation } from './evaluator.js';

export function scanForNoShows() {
  try {
    const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
    const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
    
    const now = new Date();
    
    const pendingReservations = db.prepare(`
      SELECT * FROM reservations 
      WHERE status = 'approved'
    `).all() as any[];
    
    for (const res of pendingReservations) {
      const startTime = new Date(res.start_time);
      const limitTime = new Date(startTime.getTime() + maxLateMinutes * 60000);
      
      if (now > limitTime) {
        db.transaction(() => {
          const currentRes = db.prepare('SELECT status FROM reservations WHERE id = ?').get(res.id) as any;
          if (currentRes && currentRes.status === 'approved') {
            const nowStr = now.toISOString();
            db.prepare("UPDATE reservations SET status = 'cancelled', actual_end_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nowStr, res.id);
            db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(res.student_id, res.id, 'no-show', nowStr);
            
            evaluatePenaltiesOnViolation(res.student_id);
          }
        })();
      }
    }
  } catch (error) {
    console.error("Error scanning for no-shows:", error);
  }
}
