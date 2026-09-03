import { formatInTimeZone, toDate } from 'date-fns-tz';

export const APP_TIMEZONE =
    (typeof process !== 'undefined' && process.env?.APP_TIMEZONE) || 'Asia/Shanghai';

/**
 * Safely parses UTC date strings that may come from SQLite (e.g., "YYYY-MM-DD HH:mm:ss")
 * or standard ISO 8601 strings (e.g., "YYYY-MM-DDTHH:mm:ss.sssZ").
 * 
 * Specifically prevents Safari/WebKit "RangeError: Invalid time value" caused by space-separated
 * timestamps or double-Z suffixes.
 */
export function parseUTCDate(dateStr?: string | null): Date | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    let s = dateStr.trim();
    if (!s) return null;
    if (s.includes(' ')) {
        s = s.replace(' ', 'T');
    }
    if (!s.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(s)) {
        s += 'Z';
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Ensures a date is formatted as an ISO string with the configured application timezone (YYYY-MM-DDTHH:mm:ss.SSSZ or equivalent offset)
 * If the input is already a string, it parses it correctly considering it might be UTC or Local.
 */
export function toAppTimezoneString(dateInput: string | Date | number): string {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : toDate(dateInput);
    if (isNaN(d.getTime())) {
        throw new Error('Invalid date input: ' + dateInput);
    }
    // formatInTimeZone formats the given date instance into the target timezone string
    return formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
}

