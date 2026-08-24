import { db } from '../../db/index.js';
import { isBefore } from 'date-fns';
import { checkUserPenalty } from '../violation/evaluator.js';
import { OperationRejectError } from '../../lib/errors.js';

export function validateOperatingHours(start: Date, end: Date, availability: any, tzOffset: number): { isValid: boolean, error?: string, isOutOfHours: boolean } {
  const allowOutOfHours = !!availability.allowOutOfHours;

  const startMs = start.getTime();
  const endMs = end.getTime();
  
  const localStartMs = startMs - tzOffset * 60000;
  const localEndMs = endMs - tzOffset * 60000;

  let currentMs = localStartMs;

  while (currentMs < localEndMs) {
    const currentLocal = new Date(currentMs);
    const nextMidnightLocal = new Date(currentLocal);
    nextMidnightLocal.setUTCHours(24, 0, 0, 0);
    
    const chunkEndMs = Math.min(localEndMs, nextMidnightLocal.getTime());
    
    const dayOfWeek = currentLocal.getUTCDay();
    
    const dayRules = (availability.rules || []).filter((r: any) => r.day === dayOfWeek);
    
    if (dayRules.length === 0) {
      if (allowOutOfHours) return { isValid: true, isOutOfHours: true };
      return { isValid: false, error: '所选时间包含了仪器不开放的日期', isOutOfHours: true };
    }
    
    const startLocalMinutes = currentLocal.getUTCHours() * 60 + currentLocal.getUTCMinutes();
    
    const endDatesLocal = new Date(chunkEndMs);
    let endLocalMinutes = endDatesLocal.getUTCHours() * 60 + endDatesLocal.getUTCMinutes();
    if (endLocalMinutes === 0 && chunkEndMs > currentMs) { 
      endLocalMinutes = 24 * 60;
    }
    
    const fallsWithinAnyRule = dayRules.some((rule: any) => {
      const rsMins = parseInt(rule.start.split(':')[0]) * 60 + parseInt(rule.start.split(':')[1]);
      let reMins = parseInt(rule.end.split(':')[0]) * 60 + parseInt(rule.end.split(':')[1]);
      if (reMins === 1439) reMins = 1440; // 23:59 inclusive of midnight
      return startLocalMinutes >= rsMins && endLocalMinutes <= reMins;
    });

    if (!fallsWithinAnyRule) {
      if (allowOutOfHours) return { isValid: true, isOutOfHours: true };
      const validRanges = dayRules.map((r: any) => `${r.start}-${r.end}`).join(', ');
      return { isValid: false, error: `部分所选时间不在仪器开放范围内 (该日开放: ${validRanges})`, isOutOfHours: true };
    }
    
    currentMs = chunkEndMs;
  }
  
  return { isValid: true, isOutOfHours: false };
}

export function calculatePeakAccumulatedMinutes(start: Date, end: Date, peakHours: any[], tzOffset: number): number {
  if (!peakHours || peakHours.length === 0) return 0;
  
  const startMs = start.getTime();
  const endMs = end.getTime();
  
  const localStartMs = startMs - tzOffset * 60000;
  const localEndMs = endMs - tzOffset * 60000;
  
  let currentMs = localStartMs;
  let accumulated = 0;
  
  while (currentMs < localEndMs) {
    const currentLocal = new Date(currentMs);
    const nextMidnightLocal = new Date(currentLocal);
    nextMidnightLocal.setUTCHours(24, 0, 0, 0);
    
    const chunkEndMs = Math.min(localEndMs, nextMidnightLocal.getTime());
    
    const startLocalMinutes = currentLocal.getUTCHours() * 60 + currentLocal.getUTCMinutes();
    
    const endDatesLocal = new Date(chunkEndMs);
    let endLocalMinutes = endDatesLocal.getUTCHours() * 60 + endDatesLocal.getUTCMinutes();
    if (endLocalMinutes === 0 && chunkEndMs > currentMs) { 
      endLocalMinutes = 24 * 60;
    }
    
    for (const peak of peakHours) {
      const psMins = parseInt(peak.start.split(':')[0]) * 60 + parseInt(peak.start.split(':')[1]);
      let peMins = parseInt(peak.end.split(':')[0]) * 60 + parseInt(peak.end.split(':')[1]);
      if (peMins === 1439) peMins = 1440;
      
      const overlapStart = Math.max(startLocalMinutes, psMins);
      const overlapEnd = Math.min(endLocalMinutes, peMins);
      
      if (overlapEnd > overlapStart) {
        accumulated += overlapEnd - overlapStart;
      }
    }
    
    currentMs = chunkEndMs;
  }
  
  return accumulated;
}

export function validateReservationInput(data: any, isUpdate: boolean) {
  const { student_id, student_name, supervisor, phone, email, start_time, end_time } = data;
  if (!isUpdate) {
    const stringFields = { student_id, student_name, supervisor, phone, email, start_time, end_time };
    for (const [key, val] of Object.entries(stringFields)) {
      if (typeof val !== 'string' || val.trim() === '') {
        throw new OperationRejectError(`${key} 不能为空且必须为字符串`, 400);
      }
    }
    if (student_name.length > 100 || supervisor.length > 100) {
      throw new OperationRejectError('姓名或导师名称过长（上限100字符）', 400);
    }
    if (supervisor.includes('教授') || supervisor.includes('老师')) {
      throw new OperationRejectError('导师姓名请直接填写真实姓名，请勿包含“教授”或“老师”等称谓', 400);
    }
    if (email.length > 200) {
      throw new OperationRejectError('邮箱地址过长（上限200字符）', 400);
    }

    const emailSuffixesSettingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('allowed_email_suffixes') as any;
    if (emailSuffixesSettingRow && emailSuffixesSettingRow.value) {
      const allowedSuffixes = emailSuffixesSettingRow.value.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      if (allowedSuffixes.length > 0) {
        if (!email || !email.includes('@')) {
          throw new OperationRejectError(`邮箱格式不正确，目前仅允许以下后缀: ${allowedSuffixes.join(', ')}`, 400);
        }
        const domain = email.split('@').pop()?.toLowerCase() || '';
        if (!allowedSuffixes.includes(domain)) {
          throw new OperationRejectError(`暂不支持该邮箱，目前仅允许以下邮箱后缀: ${allowedSuffixes.join(', ')}`, 400);
        }
      }
    }
  }

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new OperationRejectError('无效的时间格式', 400);
  }

  if (end <= start) {
    throw new OperationRejectError('结束时间必须晚于开始时间', 400);
  }

  return { start, end };
}

export function validateReservationRules(
  start: Date, 
  end: Date, 
  equipment: any, 
  student_id: string, 
  student_name: string, 
  tz_offset: number, 
  reservationId: number | null = null
) {
  let penaltyCheck = { isPenalized: false, penaltyMethod: 'NONE', reason: '', restrictions: { reduce_days: 0, min_retain_days: 999, fee_multiplier: 1.0 }, violation_ids: [] as number[], structured_penalty: null };
  try {
    penaltyCheck = checkUserPenalty(student_id, equipment.id) as any;
  } catch (e) {
    console.error('Error in checkUserPenalty:', e);
    throw new OperationRejectError('检查用户惩罚状态时发生错误', 500);
  }

  if (penaltyCheck.isPenalized && penaltyCheck.penaltyMethod === 'BAN') {
    const err = new OperationRejectError(penaltyCheck.reason, 403);
    (err as any).violation_ids = penaltyCheck.violation_ids;
    (err as any).structured_penalty = penaltyCheck.structured_penalty;
    throw err;
  }

  if (equipment.is_hidden && reservationId === null) {
    throw new OperationRejectError('该仪器暂不开放预约', 403);
  }

  if (equipment.whitelist_enabled && reservationId === null) {
    const whitelist = (equipment.whitelist_data || '').split(/[\n,，]/).map((s: string) => s.trim()).filter(Boolean);
    if (!whitelist.includes(student_name.trim())) {
      const err = new OperationRejectError('您不在该仪器的预约白名单中，请先申请加入白名单。', 403);
      (err as any).needs_whitelist_application = true;
      throw err;
    }
  }

  const now = new Date();
  if (reservationId === null ? isBefore(start, now) : start < now) {
    throw new OperationRejectError(reservationId === null ? '不能预约已经开始或过去的时间' : '不能预约过去的时间', 400);
  }

  let availability: any = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  try {
    if (equipment.availability_json) {
      availability = JSON.parse(equipment.availability_json);
    }
  } catch (e) {}

  const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const minDuration = availability.minDurationMinutes || 30;

  if (durationMinutes < minDuration) throw new OperationRejectError(`预约时长不能少于 ${minDuration} 分钟`, 400);

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
    throw new OperationRejectError(`只能提前 ${originalAdvanceDays} 天预约`, 400);
  } else if (start > maxPenalizedDate) {
    const err = new OperationRejectError(`受惩罚规则限制，您当前只能提前 ${penalizedAdvanceDays} 天预约`, 403);
    (err as any).structured_penalty = penaltyCheck.structured_penalty || penaltyCheck;
    throw err;
  }

  const validResult = validateOperatingHours(start, end, availability, tz_offset);
  if (!validResult.isValid) {
    throw new OperationRejectError(validResult.error, 400);
  }
  let isOutOfHours = validResult.isOutOfHours;

  const maxDuration = availability.maxDurationMinutes || 60;
  const dailyMaxDuration = availability.dailyMaxDurationMinutes ?? 0;
  const allowExceed = !!availability.allowExceedDuration;
  const allowExceedOffPeak = availability.allowExceedDurationOffPeak || false;
  const peakHours = availability.peakHours || [];

  const offsetModifier = `${-tz_offset >= 0 ? '+' : ''}${-tz_offset} minutes`;

  let userDailyUsedRow;
  if (reservationId === null) {
    userDailyUsedRow = db.prepare(`
      SELECT COALESCE(SUM((strftime('%s', end_time) - strftime('%s', start_time)) / 60), 0) AS total_minutes
      FROM reservations
      WHERE equipment_id = ?
        AND student_id = ?
        AND DATE(start_time, ?) = DATE(?, ?)
        AND status IN ('pending', 'approved', 'active')
    `).get(equipment.id, student_id, offsetModifier, start.toISOString(), offsetModifier) as any;
  } else {
    userDailyUsedRow = db.prepare(`
      SELECT COALESCE(SUM((strftime('%s', end_time) - strftime('%s', start_time)) / 60), 0) AS total_minutes
      FROM reservations
      WHERE equipment_id = ?
        AND student_id = ?
        AND id != ?
        AND DATE(start_time, ?) = DATE(?, ?)
        AND status IN ('pending', 'approved', 'active')
    `).get(equipment.id, student_id, reservationId, offsetModifier, start.toISOString(), offsetModifier) as any;
  }
  
  const userDailyUsed = userDailyUsedRow ? userDailyUsedRow.total_minutes : 0;

  if (dailyMaxDuration > 0 && userDailyUsed + durationMinutes > dailyMaxDuration) {
    throw new OperationRejectError(`超过单日预约总时长硬性上限 (${dailyMaxDuration} 分钟)`, 400);
  }

  const peakAccumulated = calculatePeakAccumulatedMinutes(start, end, peakHours, tz_offset);
  let isPeakExceeded = false;
  
  if (peakAccumulated > maxDuration) {
    if (!allowExceed) {
      throw new OperationRejectError(`您的预约占用的忙时 (${peakAccumulated} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许忙时超额预约。`, 400);
    }
    isPeakExceeded = true;
  } else if (durationMinutes > maxDuration) {
    if (!allowExceedOffPeak) {
      throw new OperationRejectError(`您的预约时长 (${durationMinutes} 分钟) 超过了单次时长上限 (${maxDuration} 分钟)，且该仪器不允许闲时超额预约。`, 400);
    }
  }

  return { isOutOfHours, isPeakExceeded, penaltyCheck };
}

export function validateReservationConflict(equipment: any, start_time: string, end_time: string, reservationId: number | null = null) {
  let conflictRaw;
  if (reservationId === null) {
    conflictRaw = db.prepare(`
      SELECT id, start_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
      AND start_time < ? AND end_time > ?
    `).all(equipment.id, end_time, start_time);
  } else {
    conflictRaw = db.prepare(`
      SELECT id, start_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active') AND id != ?
      AND start_time < ? AND end_time > ?
    `).all(equipment.id, reservationId, end_time, start_time);
  }

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
    throw new OperationRejectError(reservationId === null ? '该时间段已被预约' : '所选时间段已有其他预约', 400);
  }
}
