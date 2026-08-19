import { validateTimeRange } from '../../lib/validators.js';
import { db } from '../../db/index.js';
import { actionLimiter } from '../../middleware/rateLimiter.js';
import { OperationRejectError } from '../../lib/errors.js';
import { ReservationService } from './service.js';
import { Router } from 'express';

// Phase 1: 纯物理路由剥离
// 业务依赖 (如 db, actionLimiter 等) 将在搬运端点时逐步按需引入

export const reservationRouter = Router();
export const reservationAdminRouter = Router();

// 4. Create reservation
reservationRouter.post('/', actionLimiter, (req, res) => {
  const tz_offset = req.body.tz_offset || 0;
  try {
    const result = ReservationService.create(req.body, tz_offset);
    res.json(result);
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      const payload: any = { error: error.message };
      if ((error as any).violation_ids) payload.violation_ids = (error as any).violation_ids;
      if ((error as any).structured_penalty) payload.structured_penalty = (error as any).structured_penalty;
      if ((error as any).needs_whitelist_application) payload.needs_whitelist_application = (error as any).needs_whitelist_application;
      res.status(error.statusCode).json(payload);
    } else {
      console.error('Create reservation error:', error);
      res.status(500).json({ error: '预约失败：服务器内部错误，请重试' });
    }
  }
});

// 5. Get reservations by code (batch)
reservationRouter.post('/batch', (req, res) => {
  const codesArray = req.body.codes as string[];
  if (!Array.isArray(codesArray)) {
    return res.status(400).json({ error: 'codes must be an array' });
  }
  try {
    const reservations = ReservationService.getBatch(codesArray);
    res.json(reservations);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});
// 5. Get reservation by code
 
reservationRouter.get('/:code', (req, res) => {
  const { code } = req.params;
  const reservation = db.prepare(`
    SELECT 
      r.id, r.equipment_id, r.student_name, r.student_id, r.supervisor, 
      r.start_time, r.end_time, r.status, r.booking_code,
      r.total_cost, r.consumable_quantity, r.modified_count, r.created_at,
      e.name as equipment_name, e.price_type, e.price, e.consumable_fee
    FROM reservations r
    JOIN equipment e ON r.equipment_id = e.id
    WHERE r.booking_code = ?
  `).get(code);
 
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  res.json(reservation);
});
 
// 6. Cancel reservation
reservationRouter.post('/cancel', actionLimiter, (req, res) => {
  const { booking_code } = req.body;
  try {
    ReservationService.cancel(booking_code);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Cancel reservation error:', error);
      res.status(500).json({ error: '取消预约失败，请重试' });
    }
  }
});

// Update reservation (User)
reservationRouter.post('/update', actionLimiter, (req, res) => {
  const { booking_code, start_time, end_time, tz_offset } = req.body;
  if (typeof booking_code !== 'string' || typeof start_time !== 'string' || typeof end_time !== 'string') {
    return res.status(400).json({ error: '参数类型错误' });
  }
  
  try {
    ReservationService.update(booking_code, start_time, end_time, tz_offset || 0);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      const payload: any = { error: error.message };
      if ((error as any).structured_penalty) {
        payload.structured_penalty = (error as any).structured_penalty;
      }
      res.status(error.statusCode).json(payload);
    } else {
      console.error('Update reservation error:', error);
      res.status(500).json({ error: '修改失败：服务器内部数据库错误，请重试' });
    }
  }
});

// 7. Check-in
reservationRouter.post('/checkin', (req, res) => {
  const { booking_code, consumable_quantity } = req.body;
  
  try {
    const result = ReservationService.checkin(booking_code, consumable_quantity);
    res.json({ success: true, actual_start_time: result.nowStr });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Checkin error:', error);
      res.status(500).json({ error: '上机失败，请重试' });
    }
  }
});

// 8. Check-out
reservationRouter.post('/checkout', (req, res) => {
  const { booking_code, consumable_quantity } = req.body;
  
  try {
    const result = ReservationService.checkout(booking_code, consumable_quantity);
    res.json({ success: true, actual_end_time: result.nowStr, total_cost: result.total_cost, consumable_quantity: result.finalConsumableQty });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Checkout error:', error);
      res.status(500).json({ error: '下机失败，请重试' });
    }
  }
});

// Admin get all reservations
 
 
reservationAdminRouter.get('/', (req, res) => {
  const { student_name, supervisor, startDate, endDate } = req.query;
  const enrichedReservations = ReservationService.getAdminList({ 
    student_name: student_name as string, 
    supervisor: supervisor as string, 
    startDate: startDate as string, 
    endDate: endDate as string 
  });
  res.json(enrichedReservations);
});

reservationAdminRouter.get('/stats', (req, res) => {
  if (!validateTimeRange(req, res)) return;
 
  const { period, student_name, supervisor, startDate, endDate } = req.query;
  const stats = ReservationService.getStats({
    period: period as string,
    student_name: student_name as string,
    supervisor: supervisor as string,
    startDate: startDate as string,
    endDate: endDate as string
  });
  res.json(stats);
});

// Admin update reservation
reservationAdminRouter.put('/:id', (req, res) => {
  const { id } = req.params;
  try {
    ReservationService.adminUpdate(id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Admin update reservation error:', error);
      res.status(500).json({ error: '修改失败' });
    }
  }
});

reservationAdminRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const reason = (req.query.reason as string) || '';
  try {
    ReservationService.adminDelete(id, reason);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof OperationRejectError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error('Admin delete reservation error:', error);
      res.status(500).json({ error: '删除失败' });
    }
  }
});
