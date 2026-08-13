/**
 * Datetime Utility for Plant Local Time (Asia/Karachi / UTC+5 PKT)
 * Standardized conversion between Date objects, ISO strings, and <input type="datetime-local"> values.
 */

export const PLANT_TIMEZONE = 'Asia/Karachi';

/**
 * Formats a Date object or ISO timestamp string into `YYYY-MM-DDTHH:mm` format
 * for HTML `<input type="datetime-local">` in plant local time.
 */
export function toDatetimeLocalInput(dateInput?: Date | string | number | null): string {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(date.getTime())) {
    const now = new Date();
    return toDatetimeLocalInput(now);
  }

  // Format parts in plant local timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PLANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const yyyy = map.year;
  const mm = map.month;
  const dd = map.day;
  const hh = map.hour === '24' ? '00' : map.hour.padStart(2, '0');
  const min = map.minute.padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/**
 * Converts a `datetime-local` input string (`YYYY-MM-DDTHH:mm`) back into a valid ISO string.
 * Assumes the input string represents plant local time (Asia/Karachi, UTC+5).
 */
export function datetimeLocalToIso(localStr: string): string | null {
  if (!localStr || !localStr.trim()) return null;
  
  // Format: YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss
  const match = localStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const [_, yyyy, mm, dd, hh, min, ss] = match;
  const sec = ss || '00';

  // Construct ISO string with +05:00 timezone offset for PKT
  const isoWithOffset = `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}+05:00`;
  const parsedDate = new Date(isoWithOffset);
  
  if (isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString();
}

/**
 * Formats an operational timestamp into human-readable plant local time string for UI display.
 */
export function formatOperationalDatetime(dateInput?: Date | string | null): string {
  if (!dateInput) return '—';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PLANT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
