import crypto from 'crypto';

import { OperationRejectError } from '../../lib/errors.js';
import { checkUserPenalty, evaluatePenaltiesOnViolation } from '../violation/evaluator.js';
import { notifyEvent } from '../notification/service.js';
import { validateReservationInput, validateReservationRules, validateReservationConflict } from './validation.js';
import { validateTimeRange } from '../../lib/validators.js';
import { db } from '../../db/index.js';
import { isAfter, isBefore, format } from 'date-fns';

export class ReservationService {

  static getBatch(codesArray: string[]) {
    const validCodes = [...new Set(codesArray.map(c => String(c).trim()).filter(Boolean))];
    if (validCodes.length === 0) {
      return [];
    }
   
    if (validCodes.length > 200) {
      throw new Error('Too many codes');
    }
   
    const placeholders = validCodes.map(() => '?').join(',');
    const reservations = db.prepare(`
      SELECT 
        r.id, r.equipment_id, r.student_name, r.student_id, r.supervisor, 
        r.start_time, r.end_time, r.status, r.booking_code,
        r.total_cost, r.consumable_quantity, r.modified_count, r.created_at,
        e.name as equipment_name, e.price_type, e.price, e.consumable_fee
      FROM reservations r
      JOIN equipment e ON r.equipment_id = e.id
      WHERE r.booking_code IN (${placeholders})
    `).all(...validCodes);
   
    return reservations;
  }

  static cancel(booking_code: string) {
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
  }

  static update(booking_code: string, start_time: string, end_time: string, tz_offset: number = 0) {
    const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
    
    if (!reservation) throw new OperationRejectError('未找到该预约', 404);
    if (reservation.status !== 'pending' && reservation.status !== 'approved') {
      throw new OperationRejectError('无法修改进行中或已完成的预约', 400);
    }
    
    const maxLateMinutes = 30;
    const startTimeTime = new Date(reservation.start_time).getTime();
    if (Date.now() > startTimeTime + maxLateMinutes * 60000) {
      throw new OperationRejectError(`超过上机时间${maxLateMinutes}分钟未上机的预约，不允许取消或者修改`, 400);
    }

    if (reservation.modified_count >= 1) {
      throw new OperationRejectError('每个预约仅允许修改一次时间，请取消后重新预约', 400);
    }

    const { start, end } = validateReservationInput({ start_time, end_time }, true);
    
    const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(reservation.equipment_id) as any;
    
    const { isOutOfHours, isPeakExceeded, penaltyCheck } = validateReservationRules(start, end, equipment, reservation.student_id, reservation.student_name, tz_offset, reservation.id);

    const tx = db.transaction(() => {
      validateReservationConflict(equipment, start_time, end_time, reservation.id);
      

      
 
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
    });
    
    tx();
  }

  static checkin(booking_code: string, consumable_quantity?: number) {
    const result = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM reservations WHERE booking_code = ?').get(booking_code) as any;
      
      if (!reservation) throw new OperationRejectError('未找到该预约', 404);
      if (reservation.status !== 'approved') throw new OperationRejectError('预约未通过审批或已开始', 400);
 
      const now = new Date();
      const startTime = new Date(reservation.start_time);
      
      const scheduledStart = new Date(reservation.start_time);
      const earliestCheckin = new Date(scheduledStart.getTime() - 30 * 60 * 1000);
      if (now.getTime() < earliestCheckin.getTime()) {
        throw new OperationRejectError(`只能在预约开始前 30 分钟内上机。您的预约开始时间为 ${format(scheduledStart, 'HH:mm')}，请在 ${format(earliestCheckin, 'HH:mm')} 后重试。`, 400);
      }
 
      const noShowGraceRow = db.prepare("SELECT value FROM settings WHERE key = 'violation_no_show_grace_minutes'").get() as any;
      const maxLateMinutes = noShowGraceRow ? parseInt(noShowGraceRow.value, 10) : 30;
      
      const diffMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
      if (diffMinutes > maxLateMinutes) {
        throw new OperationRejectError(`已超过预约开始时间${maxLateMinutes}分钟，不允许上机`, 400);
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
    
    return result;
  }

  static checkout(booking_code: string, consumable_quantity?: number) {
    if (consumable_quantity !== undefined) {
      const qty = Number(consumable_quantity);
      if (!Number.isInteger(qty) || qty < 0) {
        throw new OperationRejectError('耗材数量必须是大于等于0的整数', 400);
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
      if (reservation.status !== 'active') throw new OperationRejectError('预约未在进行中', 400);
 
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
    
    return result;
  }

  static create(data: any, tz_offset: number = 0) {
    const { equipment_id, student_id, student_name, supervisor, phone, email, start_time, end_time } = data;
    
    if (equipment_id === undefined || equipment_id === null || isNaN(Number(equipment_id)) || !Number.isInteger(Number(equipment_id))) {
      throw new OperationRejectError('equipment_id 必须为有效的整数', 400);
    }

    const { start, end } = validateReservationInput(data, false);
    
    const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id) as any;
    if (!equipment) throw new OperationRejectError('未找到该仪器', 404);

    const { isOutOfHours, isPeakExceeded, penaltyCheck } = validateReservationRules(start, end, equipment, student_id, student_name, tz_offset);

    const tx = db.transaction(() => {
      validateReservationConflict(equipment, start_time, end_time);
      
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
      return { info, booking_code, status };
    });
   
    const { info, booking_code, status } = tx();
   
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
   
    return { 
      id: info.lastInsertRowid, 
      booking_code: booking_code_delivery.web === 'false' ? undefined : booking_code, 
      status,
      message: penaltyCheck.penaltyMethod === 'REQUIRE_APPROVAL' ? penaltyCheck.reason : undefined,
      booking_code_delivery,
      webhook_alias: webhookAliasObj?.value || 'Webhook',
      structured_penalty: (penaltyCheck as any).structured_penalty || penaltyCheck
    };
  }

  static adminUpdate(id: string | number, updates: any) {
    const oldRes = db.prepare('SELECT r.*, e.name as equipment_name, e.price_type, e.price, e.consumable_fee FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?').get(id) as any;
    if (!oldRes) throw new OperationRejectError('未找到该预约', 404);
   
    // Merge old data with incoming data (PATCH style)
    const student_id = updates.student_id !== undefined ? updates.student_id : oldRes.student_id;
    const student_name = updates.student_name !== undefined ? updates.student_name : oldRes.student_name;
    const supervisor = updates.supervisor !== undefined ? updates.supervisor : oldRes.supervisor;
    const start_time = updates.start_time !== undefined ? updates.start_time : oldRes.start_time;
    const end_time = updates.end_time !== undefined ? updates.end_time : oldRes.end_time;
    let status = updates.status !== undefined ? updates.status : oldRes.status;
    const consumable_quantity = updates.consumable_quantity !== undefined ? updates.consumable_quantity : oldRes.consumable_quantity;
    const actual_start_time = updates.actual_start_time !== undefined ? updates.actual_start_time : oldRes.actual_start_time;
    const actual_end_time = updates.actual_end_time !== undefined ? updates.actual_end_time : oldRes.actual_end_time;

    let total_cost = updates.total_cost;
    if (total_cost === undefined) {
      if (actual_start_time && actual_end_time) {
        const aStart = new Date(actual_start_time);
        const aEnd = new Date(actual_end_time);
        const hours = Math.max(0, (aEnd.getTime() - aStart.getTime()) / (1000 * 60 * 60));
        
        if (oldRes.price_type === 'hour') {
          total_cost = hours * oldRes.price;
        } else {
          total_cost = oldRes.price;
        }
        if (oldRes.consumable_fee > 0 && consumable_quantity > 0) {
          total_cost += oldRes.consumable_fee * consumable_quantity;
        }
      } else {
        total_cost = oldRes.total_cost;
      }
    }
    const notes = updates.notes !== undefined ? updates.notes : oldRes.notes;

    const txResult = db.transaction(() => {
      let violationChanged = false;

      if (actual_start_time && oldRes.status === 'cancelled') {
        status = actual_end_time ? 'completed' : 'active';
        const noShowViolation = db.prepare("SELECT id FROM violation_records WHERE reservation_id = ? AND violation_type = 'no-show' AND status = 'active'").get(id) as any;
        if (noShowViolation) {
          db.prepare("UPDATE violation_records SET status = 'revoked', remark = 'Administratively revoked' WHERE id = ?").run(noShowViolation.id);
          violationChanged = true;
        }
      } else if (actual_end_time && (oldRes.status === 'active' || oldRes.status === 'approved')) {
        if (updates.status === undefined) {
          status = 'completed';
        }
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
        }
      }

      db.prepare(`
        UPDATE reservations 
        SET student_id = ?, student_name = ?, supervisor = ?, start_time = ?, end_time = ?, status = ?, total_cost = ?, consumable_quantity = ?, actual_start_time = ?, actual_end_time = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(student_id, student_name, supervisor, start_time, end_time, status, total_cost, consumable_quantity, actual_start_time, actual_end_time, notes, id);

      return { violationChanged };
    })();

    if (txResult.violationChanged) {
      evaluatePenaltiesOnViolation(student_id);
    }
    
    if (oldRes.status === 'pending' && status === 'approved') {
      notifyEvent(db, 'booking_approved', {
        booking_id: oldRes.id,
        booking_code: oldRes.booking_code,
        student_name,
        equipment_name: oldRes.equipment_name,
        start_time,
        end_time
      }, oldRes.email);
    }
  }

  static adminDelete(id: string | number, reason: string = '') {
    const reservation = db.prepare('SELECT r.*, e.name as equipment_name FROM reservations r JOIN equipment e ON r.equipment_id = e.id WHERE r.id = ?').get(id) as any;
    if (!reservation) throw new OperationRejectError('未找到该预约', 404);
 
    db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
 
    if (reservation.status === 'pending' || reservation.status === 'approved') {
      notifyEvent(db, 'booking_rejected', {
        booking_id: reservation.id,
        booking_code: reservation.booking_code,
        student_name: reservation.student_name,
        equipment_name: reservation.equipment_name,
        start_time: reservation.start_time,
        end_time: reservation.end_time,
        reject_reason: reason
      }, reservation.email);
    }
  }
}
