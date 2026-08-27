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
