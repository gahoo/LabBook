import { formatInTimeZone, toDate } from 'date-fns-tz';

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Shanghai';

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
