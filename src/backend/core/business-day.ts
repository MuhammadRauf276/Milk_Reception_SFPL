/**
 * Canonical 08:00 AM Plant Business Day Helper
 * Company operates on a 24-hour business day starting at 08:00:00.000 AM plant local time
 * and running through 07:59:59.999 AM the next calendar day.
 * 
 * The Business Date is named by the calendar date on which the business day STARTS.
 */

export const PLANT_TIMEZONE = 'Asia/Karachi';

/**
 * Returns YYYY-MM-DD string representing the official Plant Business Date for a given timestamp.
 * Evaluated in plant local timezone (Asia/Karachi / UTC+5 PKT).
 */
export function getOperationalBusinessDate(timestamp: Date | string | number | null | undefined): string {
  if (!timestamp) return '';

  const dateObj = new Date(timestamp);
  if (isNaN(dateObj.getTime())) return '';

  // Get date parts in plant local timezone (Asia/Karachi)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PLANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  let year = parseInt(partMap.year, 10);
  let month = parseInt(partMap.month, 10);
  let day = parseInt(partMap.day, 10);
  const parsedHour = parseInt(partMap.hour, 10);
  const hour = parsedHour === 24 ? 0 : parsedHour;

  // 08:00 AM cutoff: If local time is before 08:00:00 AM, the business day started on the PREVIOUS calendar day
  if (hour < 8) {
    const tempDate = new Date(Date.UTC(year, month - 1, day));
    tempDate.setUTCDate(tempDate.getUTCDate() - 1);
    year = tempDate.getUTCFullYear();
    month = tempDate.getUTCMonth() + 1;
    day = tempDate.getUTCDate();
  }

  const yyyy = year.toString().padStart(4, '0');
  const mm = month.toString().padStart(2, '0');
  const dd = day.toString().padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Helper to calculate data-entry submission delay in milliseconds.
 * Delay = submittedAt (server timestamp) - operationalTimestamp
 */
export function calculateSubmissionDelayMs(
  operationalTimestamp: Date | string,
  submittedAt: Date | string = new Date()
): number {
  const opMs = new Date(operationalTimestamp).getTime();
  const subMs = new Date(submittedAt).getTime();
  if (isNaN(opMs) || isNaN(subMs)) return 0;
  return Math.max(0, subMs - opMs);
}

/**
 * Returns YYYY-MM-DD string representing ordinary Pakistan Calendar Date (Asia/Karachi UTC+5).
 * Does NOT apply 08:00 AM plant rollover cutoff. Used by MOT, ZMCC, and upstream operations.
 */
export function getPakistanCalendarDate(timestamp: Date | string | number = new Date()): string {
  const dateObj = new Date(timestamp);
  if (isNaN(dateObj.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(dateObj);
}

/**
 * One Pakistan calendar day (midnight to midnight), in the two forms the database needs. This is the day people see.
 * - dateStart / dateEnd: for @db.Date columns (operational_date, arrival_date), which hold the date itself.
 * - start / end: for timestamp columns (created_at, received_at, ...), which hold real instants.
 */
export function getPakistanDayWindow(date: string = getPakistanCalendarDate()): {
  calendarDate: string;
  dateStart: Date;
  dateEnd: Date;
  start: Date;
  end: Date;
} {
  return {
    calendarDate: date,
    dateStart: new Date(`${date}T00:00:00.000Z`),
    dateEnd: new Date(`${date}T23:59:59.999Z`),
    start: new Date(`${date}T00:00:00.000+05:00`),
    end: new Date(`${date}T23:59:59.999+05:00`),
  };
}

/** One plant business day as real instants: 08:00 Pakistan time on `date` to 07:59:59.999 the next morning. Plant reports only. */
export function getBusinessDayWindow(date: string = getOperationalBusinessDate(new Date())): { start: Date; end: Date } {
  const start = new Date(`${date}T08:00:00.000+05:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

/**
 * How a plant report places a vehicle on a day.
 * - calendar: the Pakistan date of its plant business-date time (business_date_set_at), as people read it.
 * - business: its plant business date (operational_date), the 08:00 to 08:00 day.
 */
export type DateBasis = 'calendar' | 'business';

export function parseDateBasis(value: string | null | undefined): DateBasis {
  return value === 'business' ? 'business' : 'calendar';
}

/** Filter for plant vehicle visits dated from `fromDate` to `toDate` (YYYY-MM-DD) on the chosen basis. */
export function plantVisitDateWhere(basis: DateBasis, fromDate: string, toDate: string = fromDate) {
  if (basis === 'business') {
    return { operational_date: { gte: new Date(`${fromDate}T00:00:00.000Z`), lte: new Date(`${toDate}T23:59:59.999Z`) } };
  }
  return { business_date_set_at: { gte: getPakistanDayWindow(fromDate).start, lte: getPakistanDayWindow(toDate).end } };
}
