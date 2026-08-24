import { formatInTimeZone, toDate } from 'date-fns-tz';

export const SHANGHAI_TZ = 'Asia/Shanghai';

/**
 * Ensures a date is formatted as a Shanghai timezone ISO string (YYYY-MM-DDTHH:mm:ss.SSSZ)
 * If the input is already a string, it parses it correctly considering it might be UTC or Local.
 */
export function toShanghaiString(dateInput: string | Date | number): string {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : toDate(dateInput);
    if (isNaN(d.getTime())) {
        throw new Error('Invalid date input: ' + dateInput);
    }
    // formatInTimeZone formats the given date instance into the target timezone string
    return formatInTimeZone(d, SHANGHAI_TZ, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
}
