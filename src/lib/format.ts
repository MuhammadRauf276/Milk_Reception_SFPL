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

const KEEP_CAPS = new Set(['ZMCC', 'QA', 'HC', 'MC', 'PHE', 'MDO', 'MPD', 'SOP', 'GPS', 'SMS', 'LR', 'SNF', 'TS', 'ERP', 'MTD']);

/** Turns a status code such as AT_ZMCC_WAITING_UNLOAD into words: At ZMCC waiting unload. */
export function formatLabel(code: string | null | undefined): string {
  if (!code) return PLACEHOLDER;
  return code
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (KEEP_CAPS.has(upper)) return upper;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
