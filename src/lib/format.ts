/** One date and number format for the whole interface: 8 Nov 2026, 09:34. */

type DateInput = string | number | Date | null | undefined;

const PLACEHOLDER = '—';

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? DATE.format(d) : PLACEHOLDER;
}

export function formatTime(value: DateInput): string {
  const d = toDate(value);
  return d ? TIME.format(d) : PLACEHOLDER;
}

export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? `${DATE.format(d)}, ${TIME.format(d)}` : PLACEHOLDER;
}

/** 12,450 or 12,450.5. Never rounds a figure beyond `maxDecimals`. */
export function formatNumber(value: number | string | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || value === '') return PLACEHOLDER;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return PLACEHOLDER;
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}
