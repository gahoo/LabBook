import { db } from '../../db/index.js';
import { format, parseISO, isAfter, startOfDay, addDays } from 'date-fns';

export function getAllEquipment(isAdmin: boolean) {
  let equipment = db.prepare('SELECT * FROM equipment').all() as any[];
  
  if (!isAdmin) {
    equipment = equipment
      .filter((eq) => !eq.is_hidden)
      .map((eq) => {
        const { whitelist_data, ...rest } = eq;
        return rest;
      });
  }
  return equipment;
}

export function createEquipment(data: any) {
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots } = data;
  
  const stmt = db.prepare(`
    INSERT INTO equipment (name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const info = stmt.run(name, description, image_url || '', location, availability_json, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0, whitelist_enabled ? 1 : 0, whitelist_data || '', is_hidden ? 1 : 0, release_noshow_slots ? 1 : 0);
  
  return info.lastInsertRowid;
}

export function updateEquipment(id: number | string, data: any) {
  const { name, description, image_url, location, availability_json, auto_approve, price_type, price, consumable_fee, whitelist_enabled, whitelist_data, is_hidden, release_noshow_slots } = data;
  
  const stmt = db.prepare(`
    UPDATE equipment 
    SET name = ?, description = ?, image_url = ?, location = ?, availability_json = ?, auto_approve = ?, price_type = ?, price = ?, consumable_fee = ?, whitelist_enabled = ?, whitelist_data = ?, is_hidden = ?, release_noshow_slots = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(name, description, image_url || '', location, availability_json, auto_approve ? 1 : 0, price_type, price, consumable_fee || 0, whitelist_enabled ? 1 : 0, whitelist_data || '', is_hidden ? 1 : 0, release_noshow_slots ? 1 : 0, id);
}

export function batchUpdateEquipment(ids: (number | string)[], updates: any) {
  const updateEquipmentTx = db.transaction((idsToUpdate: (number | string)[], updateData: any) => {
    for (const id of idsToUpdate) {
      const currentEq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as any;
      if (!currentEq) continue;

      let avail: any = {};
      try {
        avail = JSON.parse(currentEq.availability_json || '{}');
      } catch (e) {}

      let availChanged = false;
      if (updateData.advanceDays !== undefined) {
        avail.advanceDays = updateData.advanceDays;
        availChanged = true;
      }
      if (updateData.allowOutOfHours !== undefined) {
        avail.allowOutOfHours = updateData.allowOutOfHours;
        availChanged = true;
      }
      if (updateData.minDurationMinutes !== undefined) {
        avail.minDurationMinutes = updateData.minDurationMinutes;
        availChanged = true;
      }
      if (updateData.maxDurationMinutes !== undefined) {
        avail.maxDurationMinutes = updateData.maxDurationMinutes;
        availChanged = true;
      }
      if (updateData.lateCancellationMinutes !== undefined) {
        if (updateData.lateCancellationMinutes === null) {
          delete avail.lateCancellationMinutes;
        } else {
          avail.lateCancellationMinutes = updateData.lateCancellationMinutes;
        }
        availChanged = true;
      }
      if (updateData.rules !== undefined) {
        avail.rules = updateData.rules;
        availChanged = true;
      }

      const updateFields = [];
      const updateValues = [];

      if (availChanged) {
        updateFields.push('availability_json = ?');
        updateValues.push(JSON.stringify(avail));
      }

      if (updateData.is_hidden !== undefined) {
        updateFields.push('is_hidden = ?');
        updateValues.push(updateData.is_hidden ? 1 : 0);
      }

      if (updateData.release_noshow_slots !== undefined) {
        updateFields.push('release_noshow_slots = ?');
        updateValues.push(updateData.release_noshow_slots ? 1 : 0);
      }

      if (updateData.whitelist_enabled !== undefined) {
        updateFields.push('whitelist_enabled = ?');
        updateValues.push(updateData.whitelist_enabled ? 1 : 0);
      }

      if (updateData.whitelist_data !== undefined) {
        updateFields.push('whitelist_data = ?');
        updateValues.push(updateData.whitelist_data);
      }

      if (updateData.auto_approve !== undefined) {
        updateFields.push('auto_approve = ?');
        updateValues.push(updateData.auto_approve ? 1 : 0);
      }

      if (updateFields.length > 0) {
        updateValues.push(id);
        const stmt = db.prepare(`
          UPDATE equipment 
          SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        stmt.run(...updateValues);
      }
    }
  });

  updateEquipmentTx(ids, updates);
}

export function deleteEquipment(id: number | string) {
  const stmt = db.prepare('DELETE FROM equipment WHERE id = ?');
  stmt.run(id);
}

export function getEquipmentAvailabilityToday(dateStr: string) {
  const targetDate = parseISO(dateStr);
  const dayOfWeek = targetDate.getDay();

  const equipmentList = db.prepare('SELECT * FROM equipment').all() as any[];
  
  const results = equipmentList.map(eq => {
    let availability;
    try {
      availability = JSON.parse(eq.availability_json || '{"rules":[], "advanceDays": 7, "maxDurationMinutes": 60, "minDurationMinutes": 30}');
    } catch (e) {
      availability = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
    }

    const dayRules = availability.rules?.filter((r: any) => r.day === dayOfWeek) || [];
    
    const availableSlots = dayRules.map((rule: any) => {
      return {
        start: `${dateStr}T${rule.start}:00`,
        end: `${dateStr}T${rule.end}:00`
      };
    });

    const windowStart = new Date(`${dateStr}T00:00:00`);
    windowStart.setDate(windowStart.getDate() - 1);
    const windowEnd = new Date(`${dateStr}T00:00:00`);
    windowEnd.setDate(windowEnd.getDate() + 2);

    const reservationsRaw = db.prepare(`
      SELECT start_time, end_time, actual_start_time FROM reservations 
      WHERE equipment_id = ? 
      AND status IN ('pending', 'approved', 'active')
      AND start_time < ? AND end_time > ?
    `).all(eq.id, windowEnd.toISOString(), windowStart.toISOString()) as any[];

    let reservations = reservationsRaw;
    if (eq.release_noshow_slots) {
      const now = new Date().getTime();
      reservations = reservationsRaw.filter((res: any) => {
        if (!res.actual_start_time) {
          const startTime = new Date(res.start_time).getTime();
          if (now > startTime + 30 * 60 * 1000) {
            return false; // Filter out no-shows
          }
        }
        return true;
      });
    }

    return {
      equipment_id: eq.id,
      equipment_name: eq.name,
      availableSlots,
      reservations: reservations.map(r => ({ start_time: r.start_time, end_time: r.end_time })),
      maxDurationMinutes: availability.maxDurationMinutes || 60,
      minDurationMinutes: availability.minDurationMinutes || 30
    };
  });

  return results;
}

export function getEquipmentAvailability(id: number | string, isRange: boolean, params: { date?: string, start_date?: string, end_date?: string }) {
  const equipment = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as any;
  if (!equipment) {
    return null;
  }

  let availability;
  try {
    availability = JSON.parse(equipment.availability_json || '{"rules":[], "advanceDays": 7, "maxDurationMinutes": 60, "minDurationMinutes": 30}');
  } catch (e) {
    availability = { rules: [], advanceDays: 7, maxDurationMinutes: 60, minDurationMinutes: 30 };
  }

  const today = startOfDay(new Date());
  const maxDate = addDays(today, availability.advanceDays || 7);
  const now = new Date().getTime();
  
  const datesToProcess = [];
  if (isRange && params.start_date && params.end_date) {
    const s = parseISO(params.start_date);
    const e = parseISO(params.end_date);
    let curr = s;
    while (curr <= e && datesToProcess.length < 100) {
      datesToProcess.push(format(curr, 'yyyy-MM-dd'));
      curr = addDays(curr, 1);
    }
  } else if (params.date) {
    datesToProcess.push(params.date);
  }

  if (datesToProcess.length === 0) return { error: 'Invalid dates', results: [] };

  const minDateStr = datesToProcess[0];
  const maxDateStr = datesToProcess[datesToProcess.length - 1];

  const windowStart = new Date(`${minDateStr}T00:00:00`);
  windowStart.setDate(windowStart.getDate() - 1);
  const windowEnd = new Date(`${maxDateStr}T00:00:00`);
  windowEnd.setDate(windowEnd.getDate() + 2);

  const reservationsRaw = db.prepare(`
    SELECT id, start_time, end_time, actual_start_time FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active')
    AND start_time < ? AND end_time > ?
  `).all(id, windowEnd.toISOString(), windowStart.toISOString()) as any[];

  let rangeReservations = reservationsRaw;
  if (equipment.release_noshow_slots) {
    rangeReservations = reservationsRaw.filter((res: any) => {
      if (!res.actual_start_time) {
        const startTime = new Date(res.start_time).getTime();
        if (now > startTime + 30 * 60 * 1000) {
          return false;
        }
      }
      return true;
    });
  }

  const results = datesToProcess.map(dStr => {
    const targetDate = parseISO(dStr);
    const dayOfWeek = targetDate.getDay();

    if (isAfter(targetDate, maxDate)) {
      return { 
        date: dStr,
        availableSlots: [], 
        reservations: [], 
        maxDurationMinutes: availability.maxDurationMinutes, 
        minDurationMinutes: availability.minDurationMinutes || 30,
        message: `仅支持提前 ${availability.advanceDays} 天预约` 
      };
    }

    const rules = (availability.rules || []).filter((r: any) => r.day === dayOfWeek);
    const availableSlots: { start: string, end: string }[] = [];
    rules.forEach((rule: any) => {
      availableSlots.push({
        start: `${dStr}T${rule.start}:00`,
        end: `${dStr}T${rule.end}:00`
      });
    });

    const dStrStart = new Date(`${dStr}T00:00:00`);
    const dStrStartMs = dStrStart.getTime();

    const dStrEnd = new Date(`${dStr}T00:00:00`);
    dStrEnd.setDate(dStrEnd.getDate() + 1);
    const dStrEndMs = dStrEnd.getTime();

    const localReservations = rangeReservations.filter((r: any) => {
      const sMs = new Date(r.start_time).getTime();
      const eMs = new Date(r.end_time).getTime();
      return sMs < dStrEndMs && eMs > dStrStartMs;
    });

    return {
      date: dStr,
      availableSlots,
      reservations: localReservations,
      maxDurationMinutes: availability.maxDurationMinutes,
      minDurationMinutes: availability.minDurationMinutes || 30,
      dailyMaxDurationMinutes: availability.dailyMaxDurationMinutes,
      allowExceedDuration: availability.allowExceedDuration,
      allowExceedDurationOffPeak: availability.allowExceedDurationOffPeak || false,
      peakHours: availability.peakHours || []
    };
  });

  return { results, isRange };
}

export function getEquipmentReservations(id: number | string, start: string, end: string) {
  return db.prepare(`
    SELECT start_time, end_time, student_name, status FROM reservations 
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'active', 'completed')
    AND start_time >= ? AND end_time <= ?
  `).all(id, start, end);
}
