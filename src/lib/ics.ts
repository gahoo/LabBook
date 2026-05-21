export interface ICSReservation {
  id: number;
  booking_code?: string;
  equipment_name: string;
  location?: string;
  start_time: string; // 'YYYY-MM-DD HH:mm:ss' or ISO string
  end_time: string;
  status: string; // 'pending', 'approved', 'rejected', 'cancelled', 'completed'
  student_name?: string;
  student_id?: string;
  email?: string;
  phone?: string;
  supervisor?: string;
  notes?: string;
}

/**
 * 针对数值型 ID 生成简易 Hash，用于脱敏呈现
 */
function hashId(id: number): string {
  let hash = 5381;
  const str = `res_${id}_salt`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * 将本地时间字符串 (例如 "2026-05-19 14:00:00") 转换为 ICS 的 UTC 时间格式 "YYYYMMDDTHHmmSSZ"
 */
function formatICSDate(dateStr: string): string {
  // Safely handle missing dates
  if (!dateStr) return '';
  
  // iOS Safari is notoriously strict with date parsing. 
  // It returns Invalid Date for "YYYY-MM-DD HH:mm:ss" and "YYYY-MM-DDTHH:mm:ss" (without Z)
  // The universal safely-parsed local time format is "YYYY/MM/DD HH:mm:ss"
  let safeDateStr = dateStr;
  if (!safeDateStr.includes('Z') && !safeDateStr.match(/[+-]\d{2}:\d{2}$/)) {
    // Replace T with space and dashes with slashes
    safeDateStr = safeDateStr.replace('T', ' ').replace(/-/g, '/');
  }
  
  let d = new Date(safeDateStr);
  
  // Fallback if parsing still fails
  if (isNaN(d.getTime())) {
    d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      console.warn('Failed to parse date for ICS:', dateStr);
      return '';
    }
  }
  
  return `${d.getUTCFullYear()}${(d.getUTCMonth() + 1).toString().padStart(2, '0')}${d.getUTCDate().toString().padStart(2, '0')}T${d.getUTCHours().toString().padStart(2, '0')}${d.getUTCMinutes().toString().padStart(2, '0')}${d.getUTCSeconds().toString().padStart(2, '0')}Z`;
}

/**
 * 按照 RFC 5545 对长行进行折叠 (每行不超过 75 字符)
 * 为避免在描述文本中折行引起奇怪的换行，暂不进行字符数折叠，使用标准换行避免内容断开。
 */
function foldLine(line: string): string {
  return line;
}

/**
 * 根据预约列表生成 .ics 内容
 * @param reservations 预约记录列表
 * @param viewMode 'user' 为用户视图，'admin' 为仪器日历视角
 * @param advanceReminderMinutes 提前多少分钟提醒 (默认 30 分钟)
 */
export function generateICS(
  reservations: ICSReservation[],
  viewMode: 'user' | 'admin' = 'user',
  advanceReminderMinutes: number = 30
): string {
  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//LabBook//CN\r\n';
  ics += 'CALSCALE:GREGORIAN\r\n';

  for (const res of reservations) {
    if (res.status !== 'approved' && res.status !== 'cancelled') {
      continue;
    }

    ics += 'BEGIN:VEVENT\r\n';
    ics += `UID:${hashId(res.id)}@labbook\r\n`;

    const dtstart = formatICSDate(res.start_time);
    const dtend = formatICSDate(res.end_time);
    const dtstamp = formatICSDate(new Date().toISOString());

    if (dtstart && dtend) {
      ics += `DTSTART:${dtstart}\r\n`;
      ics += `DTEND:${dtend}\r\n`;
    }
    ics += `DTSTAMP:${dtstamp}\r\n`;

    // 状态映射
    if (res.status === 'cancelled') {
      ics += 'STATUS:CANCELLED\r\n';
    } else {
      ics += 'STATUS:CONFIRMED\r\n';
    }

    // 地点
    if (res.location) {
      const loc = res.location.replace(/,/g, '\\,').replace(/;/g, '\\;');
      ics += `LOCATION:${loc}\r\n`;
    }

    // SUMMARY 和 DESCRIPTION
    let summary = '';
    let description = '';
    const displayCode = res.booking_code || '请查看邮箱/相关通知群组';

    if (viewMode === 'user') {
      summary = `[仪器预约] ${res.equipment_name}`;
      description = res.status === 'cancelled'
        ? `您的预约已取消。\\n预约码: ${displayCode}`
        : `请准时在 ${res.location || '实验室'} 使用 ${res.equipment_name}。\\n预约码: ${displayCode}`;
    } else {
      summary = `${res.student_name} - ${res.equipment_name}`;
      description = `预约人: ${res.student_name} (${res.student_id})\\n电话: ${res.phone || '-'}\\n预约码: ${displayCode}`;
    }

    ics += foldLine(`SUMMARY:${summary}`) + '\r\n';
    ics += foldLine(`DESCRIPTION:${description}`) + '\r\n';

    // 提醒策略 (未取消项)
    if (res.status !== 'cancelled') {
      ics += 'BEGIN:VALARM\r\n';
      ics += 'ACTION:DISPLAY\r\n';
      ics += `DESCRIPTION:${summary}\r\n`;
      ics += `TRIGGER:-PT${advanceReminderMinutes}M\r\n`;
      ics += 'END:VALARM\r\n';
    }

    ics += 'END:VEVENT\r\n';
  }

  ics += 'END:VCALENDAR\r\n';
  return ics;
}
