import { validateTimeRange } from '../../lib/validators.js';

import { db } from '../../db/index.js';
import { actionLimiter } from '../../middleware/rateLimiter.js';
import { OperationRejectError } from '../../lib/errors.js';
import crypto from 'crypto';
import { isBefore, format, isAfter } from 'date-fns';
import { validateOperatingHours, calculatePeakAccumulatedMinutes } from '../../lib/validators.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation } from '../violation/service.js';
import { notifyEvent } from '../notification/service.js';

import { ReservationService } from './service.js';
import { Router } from 'express';

// Phase 1: 纯物理路由剥离
// 业务依赖 (如 db, actionLimiter 等) 将在搬运端点时逐步按需引入

export const reservationRouter = Router();
export const reservationAdminRouter = Router();

// 4. Create reservation
reservationRouter.post('/', actionLimiter, (req, res) => {
  const { equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time } = req.body;
 
  // Input validation
  const stringFields = { student_id, student_name, supervisor, phone, email, start_time, end_time };
  for (const [key, val] of Object.entries(stringFields)) {
    if (typeof val !== 'string' || val.trim() === '') {
      return res.status(400).json({ error: `${key} 不能为空且必须为字符串` });
    }
  }
  if (student_name.length > 100 || supervisor.length > 100) {
    return res.status(400).json({ error: '姓名或导师名称过长（上限100字符）' });
  }
  if (supervisor.includes('教授') || supervisor.includes('老师')) {
    return res.status(400).json({ error: '导师姓名请直接填写真实姓名，请勿包含“教授”或“老师”等称谓' });
  }
  if (email.length > 200) {
    return res.status(400).json({ error: '邮箱地址过长（上限200字符）' });
  }
  if (equipment_id === undefined || equipment_id === null || isNaN(Number(equipment_id)) || !Number.isInteger(Number(equipment_id))) {
    return res.status(400).json({ error: 'equipment_id 必须为有效的整数' });
  }
  
  // Retrieve setting and check email suffix
  const emailSuffixesSettingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('allowed_email_suffixes') as any;
  if (emailSuffixesSettingRow && emailSuffixesSettingRow.value) {
    const allowedSuffixes = emailSuffixesSettingRow.value.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    if (allowedSuffixes.length > 0) {
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: `邮箱格式不正确，目前仅允许以下后缀: ${allowedSuffixes.join(', ')}` });
      }
      const domain = email.split('@').pop()?.toLowerCase() || '';
      if (!allowedSuffixes.includes(domain)) {
        return res.status(400).json({ error: `暂不支持该邮箱，目前仅允许以下邮箱后缀: ${allowedSuffixes.join(', ')}` });
      }
    }
  }
 
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id) as any;
  if (!equipment) return res.status(404).json({ error: '未找到该仪器' });
  
  let penaltyCheck = { isPenalized: false, penaltyMethod: 'NONE', reason: '', restrictions: { reduce_days: 0, min_retain_days: 999, fee_multiplier: 1.0 }, violation_ids: [] as number[] };
  try {
    penaltyCheck = checkUserPenalty(student_id, equipment_id) as any;
  } catch (e) {
    console.error('Error in checkUserPenalty:', e);
    return res.status(500).json({ error: '检查用户惩罚状态时发生错误' });
  }
 
  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    return res.status(403).json({ 
      error: penaltyCheck.reason, 
      violation_ids: penaltyCheck.violation_ids,
      structured_penalty: (penaltyCheck as any).structured_penalty 
    });
  }
  
  if (equipment.is_hidden) {
    return res.status(403).json({ error: '该仪器暂不开放预约' });
  }
 
  // Whitelist check
  if (equipment.whitelist_enabled) {
    const whitelist = (equipment.whitelist_data || '').split(/[\n,，]/).map((s: string) => s.trim()).filter(Boolean);
    if (!whitelist.includes(student_name.trim())) {
      return res.status(403).json({ 
        error: '您不在该仪器的预约白名单中，请先申请加入白名单。',
        needs_whitelist_application: true 
      });
    }
  }
 
  // Check if slot is in the past
  const now = new Date();
  const start = new Date(start_time);
  const end = new Date(end_time);
 
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
 
  if (isBefore(start, now)) {
    return res.status(400).json({ error: '不能预约已经开始或过去的时间' });
  }
 
  let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  try {
    if (equipment.availability_json) {
      availability = JSON.parse(equipment.availability_json);
    }
  } catch (e) {}
 
  if (end <= start) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }
 
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const minDuration = availability.minDurationMinutes || 30;
 
  if (durationMinutes < minDuration) return res.status(400).json({ error: `预约时长不能少于 ${minDuration} 分钟` });
 
  const originalAdvanceDays = availability.advanceDays || 7;
  let penalizedAdvanceDays = originalAdvanceDays;
  if (penaltyCheck.isPenalized && penaltyCheck.restrictions) {
    if (penaltyCheck.restrictions.reduce_days > 0) {
      penalizedAdvanceDays -= penaltyCheck.restrictions.reduce_days;
    }
    if (penalizedAdvanceDays < penaltyCheck.restrictions.min_retain_days) {
      penalizedAdvanceDays = penaltyCheck.restrictions.min_retain_days;
    }
  }
 
  const maxOriginalDate = new Date(now);
  maxOriginalDate.setDate(maxOriginalDate.getDate() + originalAdvanceDays);
  maxOriginalDate.setHours(23, 59, 59, 999);
 
  const maxPenalizedDate = new Date(now);
  maxPenalizedDate.setDate(maxPenalizedDate.getDate() + penalizedAdvanceDays);
  maxPenalizedDate.setHours(23, 59, 59, 999);
  
  if (start > maxOriginalDate) {
    return res.status(400).json({ error: `只能提前 ${originalAdvanceDays} 天预约` });
  } else if (start > maxPenalizedDate) {
    return res.status(403).json({ 
      error: `受惩罚规则限制，您当前只能提前 ${penalizedAdvanceDays} 天预约`, 
      structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
    });
  }
 
  const tz_offset = req.body.tz_offset || 0;
  const validResult = validateOperatingHours(start, end, availability, tz_offset);
  if (!validResult.isValid) {
    return res.status(400).json({ error: validResult.error });
  }
  let isOutOfHours = validResult.isOutOfHours;
 
  const maxDuration = availability.maxDurationMinutes || 60;
  const dailyMaxDuration = availability.dailyMaxDurationMinutes ?? 0;
  const allowExceed = !!availability.allowExceedDuration;
  const allowExceedOffPeak = availability.allowExceedDurationOffPeak || false;
  const peakHours = availability.peakHours || [];
 
  const offsetModifier = `${-tz_offset >= 0 ? '+' : ''}${-tz_offset} minutes`;
 
  const userDailyUsedRow = db.prepare(`
    SELECT COALESCE(SUM((strftime('%s', end_time) - strftime('%s', start_time)) / 60), 0) AS total_minutes
    FROM reservations
    WHERE equipment_id = ?
      AND student_id = ?
      AND DATE(start_time, ?) = DATE(?, ?)
      AND status IN ('pending', 'approved', 'active')
  `).get(equipment_id, student_id, offsetModifier, start_time, offsetModifier) as any;
  const userDailyUsed = userDailyUsedRow ? userDailyUsedRow.total_minutes : 0;
 
  if (dailyMaxDuration > 0 && userDailyUsed + durationMinutes > dailyMaxDuration) {
    return res.status(400).json({ error: `超过单日预约总时长硬性上限 (${dailyMaxDuration} 分钟)` });
  }
 
  const peakAccumulated = calculatePeakAccumulatedMinutes(start, end, peakHours, tz_offset);
  let isPeakExceeded = false;
  
  if (peakAccumulated > maxDuration) {
    if (!allowExceed) {
      return res.status(400).json({ error: `您的预约占用的忙时 (${peakAccumulated} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许忙时超额预约。` });
    }
    isPeakExceeded = true;
  } else if (durationMinutes > maxDuration) {
    if (!allowExceedOffPeak) {
      return res.status(400).json({ error: `您的预约时长 (${durationMinutes} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许闲时超额预约。` });
    }
  }
 
  const tx = db.transaction(() => {
    // Check if slot is already booked
    const existingRaw = db.prepare(`
      SELECT id, start_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
      AND start_time < ? AND end_time > ?
    `).all(equipment_id, end_time, start_time);
 
    let hasConflict = false;
    if (existingRaw.length > 0) {
      if (equipment.release_noshow_slots) {
        const nowTime = new Date().getTime();
        hasConflict = existingRaw.some((res: any) => {
          if (!res.actual_start_time) {
            const resStartTime = new Date(res.start_time).getTime();
            if (nowTime > resStartTime + 30 * 60 * 1000) {
              return false; // This is a no-show, so it's not a conflict
            }
          }
          return true;
        });
      } else {
        hasConflict = true;
      }
    }
 
    if (hasConflict) {
      return { ok: false, error: '该时间段已被预约' };
    }
 
    const booking_code = crypto.randomBytes(4).toString('hex').toUpperCase();
    let status = (isOutOfHours || isPeakExceeded || !equipment.auto_approve) ? 'pending' : 'approved';
    
    if (penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL') {
      status = 'pending';
    }
 
    const stmt = db.prepare(`
      INSERT INTO reservations (equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
 
    const info = stmt.run(equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time, status, booking_code);
    return { ok: true, info, booking_code, status };
  });
 
  let txResult;
  try {
    txResult = tx();
  } catch (e: any) {
    console.error('Create reservation transaction error:', e);
    return res.status(500).json({ error: '预约失败：服务器内部数据库错误，请重试' });
  }
 
  if (!txResult.ok) {
    return res.status(400).json({ error: txResult.error });
  }
 
  const { info, booking_code, status } = txResult;
 
  notifyEvent(db, 'booking_created', {
    booking_id: info.lastInsertRowid,
    booking_code,
    student_id,
    student_name,
    equipment_name: equipment.name,
    start_time,
    end_time,
    status
  }, email);
 
  const deliveryWeb = db.prepare('SELECT value FROM settings WHERE key = ?').get('booking_code_delivery.web') as any;
  const smtpEnabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('smtp.enabled') as any;
  const smtpEventCreated = db.prepare('SELECT value FROM settings WHERE key = ?').get('email.events.booking_created.enabled') as any;
  const smtpEventApproved = db.prepare('SELECT value FROM settings WHERE key = ?').get('email.events.booking_approved.enabled') as any;
 
  const webhookEnabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.enabled') as any;
  const webhookEventCreated = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.events.booking_created.enabled') as any;
  const webhookEventApproved = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.events.booking_approved.enabled') as any;
 
  const hasSmtp = smtpEnabled?.value === 'true' && (smtpEventCreated?.value === 'true' || smtpEventApproved?.value === 'true');
  const hasWebhook = webhookEnabled?.value === 'true' && (webhookEventCreated?.value === 'true' || webhookEventApproved?.value === 'true');
 
  const booking_code_delivery = {
    web: deliveryWeb ? deliveryWeb.value : 'true',
    email: hasSmtp ? 'true' : 'false',
    webhook: hasWebhook ? 'true' : 'false',
  };
 
  const webhookAliasObj = db.prepare('SELECT value FROM settings WHERE key = ?').get('webhook.alias') as any;
 
  res.json({ 
    id: info.lastInsertRowid, 
    booking_code: booking_code_delivery.web === 'false' ? undefined : booking_code, 
    status,
    message: penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL' ? penaltyCheck.reason : undefined,
    booking_code_delivery,
    webhook_alias: webhookAliasObj?.value || 'Webhook',
    structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
  });
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
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT r.*, e.name as equipment_name FROM reservations r LEFT JOIN equipment e ON r.equipment_id = e.id WHERE r.booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'pending' && reservation.status !== 'approved') {
        throw new OperationRejectError('无法取消进行中或已完成的预约');
      }
      
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const startTime = new Date(reservation.start_time).getTime();
      const now = Date.now();
      if (now > startTime + maxLateMinutes * 60000) {
        throw new OperationRejectError(`超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改`);
      }
 
      const nowStr = new Date(now).toISOString();
      db.prepare("UPDATE reservations SET status = 'cancelled', actual_end_time = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_code = ?").run(nowStr, booking_code);
      
      let lateCancelMinutes = 120;
      let eqAvail = null;
      try {
        const equipment = db.prepare('SELECT availability_json FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
        if (equipment && equipment.availability_json) {
          eqAvail = JSON.parse(equipment.availability_json);
        }
      } catch (e) {}
      
      if (eqAvail && eqAvail.lateCancellationMinutes !== undefined && eqAvail.lateCancellationMinutes !== '') {
        lateCancelMinutes = parseInt(eqAvail.lateCancellationMinutes, 10);
      } else {
        const lateCancelRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_cancel_minutes'").get() as any;
        lateCancelMinutes = lateCancelRow ? parseInt(lateCancelRow.value, 10) : 120;
      }
      
      let isLateCancel = false;
      if (now >= startTime - lateCancelMinutes * 60 * 1000) {
        isLateCancel = true;
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time) VALUES (?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'late_cancel', nowStr);
      }
      
      return { isLateCancel, student_id: reservation.student_id, reservation };
    })();
    
    if (result.isLateCancel) {
      evaluatePenaltiesOnViolation(result.student_id);
    }
    
    notifyEvent(db, 'booking_cancelled', {
      booking_id: result.reservation.id,
      booking_code: result.reservation.booking_code,
      student_id: result.reservation.student_id,
      student_name: result.reservation.student_name,
      equipment_id: result.reservation.equipment_id,
      equipment_name: result.reservation.equipment_name,
      start_time: result.reservation.start_time,
      end_time: result.reservation.end_time,
      status: 'cancelled',
      is_late_cancel: result.isLateCancel
    }, result.reservation.email);
 
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
  const { booking_code, start_time, end_time } = req.body;
  if (typeof booking_code !== 'string' || typeof start_time !== 'string' || typeof end_time !== 'string') {
    return res.status(400).json({ error: '参数类型错误' });
  }
  const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
  
  if (!reservation) return res.status(404).json({ error: '未找到该预约' });
  if (reservation.status !== 'pending' && reservation.status !== 'approved') {
    return res.status(400).json({ error: '无法修改进行中或已完成的预约' });
  }
  
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
  const maxLateMinutes = 30;
  
  const startTime = new Date(reservation.start_time).getTime();
  if (Date.now() > startTime + maxLateMinutes * 60000) {
    return res.status(400).json({ error: `超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改` });
  }
 
  if (reservation.modified_count >= 1) {
    return res.status(400).json({ error: '每个预约仅允许修改一次时间，请取消后重新预约' });
  }
 
  const penaltyCheck = checkUserPenalty(reservation.student_id, reservation.equipment_id);
  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    return res.status(403).json({ 
      error: penaltyCheck.reason,
      structured_penalty: penaltyCheck.structured_penalty
    });
  }
 
  const start = new Date(start_time);
  const end = new Date(end_time);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
 
  if (end <= start) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }
 
  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  
  let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  try {
    if (equipment.availability_json) {
      availability = JSON.parse(equipment.availability_json);
    }
  } catch (e) {}
 
  const minDuration = availability.minDurationMinutes || 30;
 
  if (durationMinutes < minDuration) return res.status(400).json({ error: `预约时长不能少于 ${minDuration} 分钟` });
 
  const now = new Date();
  const maxDate = new Date(now);
  
  const originalAdvanceDays = availability.advanceDays || 7;
  let penalizedAdvanceDays = originalAdvanceDays;
  if (penaltyCheck.isPenalized && penaltyCheck.restrictions) {
    if (penaltyCheck.restrictions.reduce_days > 0) {
      penalizedAdvanceDays -= penaltyCheck.restrictions.reduce_days;
    }
    if (penalizedAdvanceDays < penaltyCheck.restrictions.min_retain_days) {
      penalizedAdvanceDays = penaltyCheck.restrictions.min_retain_days;
    }
  }
 
  const maxOriginalDate = new Date(now);
  maxOriginalDate.setDate(maxOriginalDate.getDate() + originalAdvanceDays);
  maxOriginalDate.setHours(23, 59, 59, 999);
 
  const maxPenalizedDate = new Date(now);
  maxPenalizedDate.setDate(maxPenalizedDate.getDate() + penalizedAdvanceDays);
  maxPenalizedDate.setHours(23, 59, 59, 999);
  
  if (start > maxOriginalDate) {
    return res.status(400).json({ error: `只能提前 ${originalAdvanceDays} 天预约` });
  } else if (start > maxPenalizedDate) {
    return res.status(403).json({ 
      error: `受惩罚规则限制，您当前只能提前 ${penalizedAdvanceDays} 天预约`, 
      structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
    });
  }
  if (start < now) {
    return res.status(400).json({ error: '不能预约过去的时间' });
  }
 
  const tz_offset = req.body.tz_offset || 0;
  const validResult = validateOperatingHours(start, end, availability, tz_offset);
  if (!validResult.isValid) {
    return res.status(400).json({ error: validResult.error });
  }
  let isOutOfHours = validResult.isOutOfHours;
 
  const maxDuration = availability.maxDurationMinutes || 60;
  const dailyMaxDuration = availability.dailyMaxDurationMinutes ?? 0;
  const allowExceed = !!availability.allowExceedDuration;
  const allowExceedOffPeak = availability.allowExceedDurationOffPeak || false;
  const peakHours = availability.peakHours || [];
 
  const offsetModifier = `${-tz_offset >= 0 ? '+' : ''}${-tz_offset} minutes`;
 
  const userDailyUsedRow = db.prepare(`
    SELECT COALESCE(SUM((strftime('%s', end_time) - strftime('%s', start_time)) / 60), 0) AS total_minutes
    FROM reservations
    WHERE equipment_id = ?
      AND student_id = ?
      AND id != ?
      AND DATE(start_time, ?) = DATE(?, ?)
      AND status IN ('pending', 'approved', 'active')
  `).get(reservation.equipment_id, reservation.student_id, reservation.id, offsetModifier, start_time, offsetModifier) as any;
  const userDailyUsed = userDailyUsedRow ? userDailyUsedRow.total_minutes : 0;
 
  if (dailyMaxDuration > 0 && userDailyUsed + durationMinutes > dailyMaxDuration) {
    return res.status(400).json({ error: `超过单日预约总时长硬性上限 (${dailyMaxDuration} 分钟)` });
  }
 
  const peakAccumulated = calculatePeakAccumulatedMinutes(start, end, peakHours, tz_offset);
  let isPeakExceeded = false;
  
  if (peakAccumulated > maxDuration) {
    if (!allowExceed) {
      return res.status(400).json({ error: `您的预约占用的忙时 (${peakAccumulated} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许忙时超额预约。` });
    }
    isPeakExceeded = true;
  } else if (durationMinutes > maxDuration) {
    if (!allowExceedOffPeak) {
      return res.status(400).json({ error: `您的预约时长 (${durationMinutes} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许闲时超额预约。` });
    }
  }
 
  const tx = db.transaction(() => {
    // Check conflicts (excluding self)
    const conflictRaw = db.prepare(`
      SELECT id, start_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active') AND id != ?
      AND start_time < ? AND end_time > ?
    `).all(reservation.equipment_id, reservation.id, end_time, start_time);
 
    let hasConflict = false;
    if (conflictRaw.length > 0) {
      if (equipment.release_noshow_slots) {
        const nowTime = new Date().getTime();
        hasConflict = conflictRaw.some((res: any) => {
          if (!res.actual_start_time) {
            const resStartTime = new Date(res.start_time).getTime();
            if (nowTime > resStartTime + 30 * 60 * 1000) {
              return false; // This is a no-show, so it's not a conflict
            }
          }
          return true;
        });
      } else {
        hasConflict = true;
      }
    }
 
    if (hasConflict) {
      return { ok: false, error: '所选时间段已有其他预约' };
    }
 
    let newStatus = (isOutOfHours || isPeakExceeded || !equipment.auto_approve) ? 'pending' : 'approved';
    
    if (penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL') {
      newStatus = 'pending';
    }
 
    const stmt = db.prepare(`
      UPDATE reservations 
      SET start_time = ?, end_time = ?, modified_count = modified_count + 1, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(start_time, end_time, newStatus, reservation.id);
    return { ok: true };
  });
 
  let txResult;
  try {
    txResult = tx();
  } catch (e: any) {
    console.error('Update reservation transaction error:', e);
    return res.status(500).json({ error: '修改失败：服务器内部数据库错误，请重试' });
  }
 
  if (!txResult.ok) {
    return res.status(400).json({ error: txResult.error });
  }
  
  res.json({ success: true });
});
 
// 7. Check-in
reservationRouter.post('/checkin', (req, res) => {
  const { booking_code, consumable_quantity } = req.body;
  
  try {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'approved') throw new OperationRejectError('预约未通过审批或已开始');
 
      const now = new Date();
      const startTime = new Date(reservation.start_time);
      
      const scheduledStart = new Date(reservation.start_time);
      const earliestCheckin = new Date(scheduledStart.getTime() - 30 * 60 * 1000);
      if (now.getTime() < earliestCheckin.getTime()) {
        throw new OperationRejectError(`只能在预约开始前 30 分钟内上机。您的预约开始时间为 ${format(scheduledStart, 'HH:mm')}，请在 ${format(earliestCheckin, 'HH:mm')} 后重试。`);
      }
 
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
      if (diffMinutes > maxLateMinutes) {
        throw new OperationRejectError(`已超过预约开始时间${maxLateMinutes}分钟，不允许上机`);
      }
 
      const nowStr = now.toISOString();
      db.prepare("UPDATE reservations SET status = 'active', actual_start_time = ?, consumable_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_code = ?").run(nowStr, consumable_quantity || 0, booking_code);
      
      const lateGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_late_grace_minutes'").get() as any;
      const lateGraceMinutes = lateGraceRow ? parseInt(lateGraceRow.value, 10) : 15;
      
      let isLate = false;
      if (diffMinutes > lateGraceMinutes) {
        isLate = true;
        const durationMinutes = Math.round(diffMinutes);
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'late', nowStr, durationMinutes);
      }
      
      return { nowStr, isLate, student_id: reservation.student_id };
    })();
    
    if (result.isLate) {
      evaluatePenaltiesOnViolation(result.student_id);
    }
    
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
    if (consumable_quantity !== undefined) {
      const qty = Number(consumable_quantity);
      if (!Number.isInteger(qty) || qty < 0) {
        return res.status(400).json({ error: '耗材数量必须是大于等于0的整数' });
      }
    }

    const result = db.transaction(() => {
      const reservation = db.prepare(`
        SELECT r.*, e.price_type, e.price, e.consumable_fee 
        FROM reservations r
        JOIN equipment e ON r.equipment_id = e.id
        WHERE r.booking_code = ?
      `).get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'active') throw new OperationRejectError('预约未在进行中');
 
      const now = new Date();
      const nowStr = now.toISOString();
      const actualStart = new Date(reservation.actual_start_time);
      const durationHours = (now.getTime() - actualStart.getTime()) / (1000 * 60 * 60);
      
      const finalConsumableQty = consumable_quantity !== undefined ? Number(consumable_quantity) : (reservation.consumable_quantity || 0);
      
      let total_cost = finalConsumableQty * (reservation.consumable_fee || 0);
      if (reservation.price_type === 'hour') {
        total_cost += Math.ceil(durationHours) * reservation.price;
      } else {
        total_cost += reservation.price;
      }
 
      const penaltyCheck = checkUserPenalty(reservation.student_id, reservation.equipment_id);
      if (penaltyCheck.isPenalized && penaltyCheck.restrictions?.fee_multiplier > 1) {
        total_cost *= penaltyCheck.restrictions.fee_multiplier;
      }
 
      const overtimeGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_overtime_grace_minutes'").get() as any;
      const overtimeGraceMinutes = overtimeGraceRow ? parseInt(overtimeGraceRow.value, 10) : 15;
      const overtimeThreshold = overtimeGraceMinutes * 60 * 1000;
      
      const end = new Date(reservation.end_time);
      let isOvertime = false;
      if (now.getTime() > end.getTime() + overtimeThreshold) {
        // We removed the hardcoded total_cost *= 2 here because fee multiplier is handled by penalty rules now.
        // If they want overtime to double fee, they should create a penalty rule for it.
        isOvertime = true;
        const durationMinutes = Math.round((now.getTime() - end.getTime()) / (1000 * 60));
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(reservation.student_id, reservation.id, 'overdue', nowStr, durationMinutes);
      }
 
      db.prepare("UPDATE reservations SET status = 'completed', actual_end_time = ?, total_cost = ?, consumable_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_code = ?").run(nowStr, total_cost, finalConsumableQty, booking_code);
      
      return { nowStr, total_cost, finalConsumableQty, isOvertime, student_id: reservation.student_id };
    })();
    
    if (result.isOvertime) {
      evaluatePenaltiesOnViolation(result.student_id);
    }
    
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
  const updates = req.body;
  
  const oldRes = db.prepare('SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?').get(id) as any;
  if (!oldRes) return res.status(404).json({ error: '未找到该预约' });
 
  // Merge old data with incoming data (PATCH style)
  const student_id = updates.student_id !== undefined ? updates.student_id : oldRes.student_id;
  const student_name = updates.student_name !== undefined ? updates.student_name : oldRes.student_name;
  const supervisor = updates.supervisor !== undefined ? updates.supervisor : oldRes.supervisor;
  const phone = updates.phone !== undefined ? updates.phone : oldRes.phone;
  const email = updates.email !== undefined ? updates.email : oldRes.email;
  const start_time = updates.start_time !== undefined ? updates.start_time : oldRes.start_time;
  const end_time = updates.end_time !== undefined ? updates.end_time : oldRes.end_time;
  
  const actual_start_time = updates.actual_start_time !== undefined ? updates.actual_start_time : oldRes.actual_start_time;
  const actual_end_time = updates.actual_end_time !== undefined ? updates.actual_end_time : oldRes.actual_end_time;
  const consumable_quantity = updates.consumable_quantity !== undefined ? updates.consumable_quantity : oldRes.consumable_quantity;
  const notes = updates.notes !== undefined ? updates.notes : oldRes.notes;
  
  let status = updates.status !== undefined ? updates.status : oldRes.status;
  
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '无效的时间格式' });
  }
 
  // Cost and Violation Logic (from reports)
  let total_cost = oldRes.total_cost;
  if (actual_start_time && actual_end_time) {
    const aStart = new Date(actual_start_time);
    const aEnd = new Date(actual_end_time);
    const hours = (aEnd.getTime() - aStart.getTime()) / (1000 * 60 * 60);
    
    if (oldRes.price_type === 'hour') {
      total_cost = hours * oldRes.price;
    } else {
      total_cost = oldRes.price;
    }
    if (oldRes.consumable_fee > 0 && consumable_quantity > 0) {
      total_cost += oldRes.consumable_fee * consumable_quantity;
    }
  }
 
  let violationChanged = false;
  const revokedViolationIds: number[] = [];
  
  if (actual_start_time && oldRes.status === 'cancelled') {
    status = actual_end_time ? 'completed' : 'active';
    const noShowViolation = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'no-show' AND status = 'active'").get(id) as any;
    if (noShowViolation) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(noShowViolation.id);
      violationChanged = true;
      revokedViolationIds.push(noShowViolation.id);
    }
  } else if (actual_end_time && (oldRes.status === 'active' || oldRes.status === 'approved')) {
    status = 'completed';
  }
 
  const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('violation_late_grace_minutes', 'violation_overtime_grace_minutes')").all() as any[];
  const settingsMap = settingsRows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
  const lateGraceMinutes = settingsMap['violation_late_grace_minutes'] ? parseInt(settingsMap['violation_late_grace_minutes'], 10) : 15;
  const overtimeGraceMinutes = settingsMap['violation_overtime_grace_minutes'] ? parseInt(settingsMap['violation_overtime_grace_minutes'], 10) : 30;
 
  if (actual_start_time) {
    const scheduledStart = new Date(start_time);
    const actualStart = new Date(actual_start_time);
    const diffMinutes = (actualStart.getTime() - scheduledStart.getTime()) / (1000 * 60);
    const existingLate = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'late' AND status = 'active'").get(id) as any;
    
    if (diffMinutes > lateGraceMinutes) {
      if (!existingLate) {
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(student_id, id, 'late', actual_start_time, Math.round(diffMinutes));
        violationChanged = true;
      } else {
        db.prepare("UPDATE violation_records SET duration_minutes = ?, violation_time = ? WHERE id = ?").run(Math.round(diffMinutes), actual_start_time, existingLate.id);
      }
    } else if (existingLate) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(existingLate.id);
      violationChanged = true;
      revokedViolationIds.push(existingLate.id);
    }
  } else {
    const existingLate = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'late' AND status = 'active'").get(id) as any;
    if (existingLate) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Auto-revoked: actual_start_time cleared' WHERE id = ?").run(existingLate.id);
      violationChanged = true;
      revokedViolationIds.push(existingLate.id);
    }
  }
 
  if (actual_end_time) {
    const scheduledEnd = new Date(end_time);
    const actualEnd = new Date(actual_end_time);
    const diffMinutes = (actualEnd.getTime() - scheduledEnd.getTime()) / (1000 * 60);
    const existingOverdue = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'overdue' AND status = 'active'").get(id) as any;
    if (diffMinutes > overtimeGraceMinutes) {
      if (!existingOverdue) {
        db.prepare("INSERT INTO violation_records (student_id, reservation_id, violation_type, violation_time, duration_minutes) VALUES (?, ?, ?, ?, ?)").run(student_id, id, 'overdue', actual_end_time, Math.round(diffMinutes));
        violationChanged = true;
      } else {
        db.prepare("UPDATE violation_records SET duration_minutes = ?, violation_time = ? WHERE id = ?").run(Math.round(diffMinutes), actual_end_time, existingOverdue.id);
      }
    } else if (existingOverdue) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(existingOverdue.id);
      violationChanged = true;
      revokedViolationIds.push(existingOverdue.id);
    }
  } else {
    const existingOverdue = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'overdue' AND status = 'active'").get(id) as any;
    if (existingOverdue) {
      db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Auto-revoked: actual_end_time cleared' WHERE id = ?").run(existingOverdue.id);
      violationChanged = true;
      revokedViolationIds.push(existingOverdue.id);
    }
  }
 
  const stmt = db.prepare(`
    UPDATE reservations 
    SET student_id = ?, student_name = ?, supervisor = ?, phone = ?, email = ?, 
        start_time = ?, end_time = ?, actual_start_time = ?, actual_end_time = ?, 
        consumable_quantity = ?, total_cost = ?, notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(student_id, student_name, supervisor, phone, email, start_time, end_time, actual_start_time, actual_end_time, consumable_quantity, total_cost, notes, status, id);
  
  if (oldRes.status === 'pending' && status === 'approved') {
    notifyEvent(db, 'booking_approved', {
      booking_code: oldRes.booking_code,
      student_id,
      student_name,
      equipment_name: oldRes.equipment_name,
      start_time,
      end_time
    }, email || undefined);
  } else if (oldRes.status === 'pending' && (status === 'cancelled' || status === 'rejected')) {
    notifyEvent(db, 'booking_rejected', {
      booking_code: oldRes.booking_code,
      student_id,
      student_name,
      equipment_name: oldRes.equipment_name,
      start_time,
      end_time
    }, email || undefined);
  }
 
  if (revokedViolationIds.length > 0) {
    for (const rid of revokedViolationIds) {
      db.prepare(`
        UPDATE user_penalties 
        SET status = 'revoked' 
        WHERE status = 'active' AND contributing_violation_ids LIKE ?
      `).run(`%,${rid},%`);
    }
  }
  
  if (violationChanged) {
    evaluatePenaltiesOnViolation(student_id);
  }
 
  res.json({ success: true, total_cost });
});
 
// Admin delete reservation
reservationAdminRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM reservations WHERE id = ?").run(id);
  res.json({ success: true });
});
 

 
