/**
 * Tankers tab of the Visuals page (see docs/VISUALS_BRIEF.md). The shapes sent to the browser, and the small pure
 * helpers that work out the flags of one tanker (no server imports, so the browser and the tests use them too).
 * Pakistan time is UTC+5 all year, so dates are worked out by shifting the instant.
 */

export const LATE_STEPS = ['dispatch', 'gate', 'weight'] as const;
export type LateStep = (typeof LATE_STEPS)[number];
export const LATE_STEP_LABELS: Record<LateStep, string> = { dispatch: 'Dispatch', gate: 'Gate entry', weight: 'First weight' };

/** A step entered this many minutes after it happened counts as a late entry. */
export const LATE_ENTRY_MINUTES = 60;
/** Enough for a year of ZMCC dispatches, so counts and charts cover every one; the table draws far fewer. */
export const TANKERS_MAX_ROWS = 5000;
/** The table shows at most this many matching rows (newest first); counts and charts use all of them. */
export const TANKERS_TABLE_ROWS = 300;

const HOUR_MS = 3_600_000;
const PK_OFFSET_MS = 5 * HOUR_MS;
const DAY_MS = 24 * HOUR_MS;

/** Pakistan calendar date (YYYY-MM-DD) of an instant. */
export function pkDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + PK_OFFSET_MS).toISOString().slice(0, 10) : null;
}

/** Business day (08:00 to 08:00 Pakistan time) of an instant. */
export function businessDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + PK_OFFSET_MS - 8 * HOUR_MS).toISOString().slice(0, 10) : null;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The time the tanker reached the plant: gate entry, else first weight. */
export const arrivalOf = (gateIn: string | null, firstWeight: string | null): string | null => gateIn ?? firstWeight ?? null;

/** Reached the plant on a later Pakistan calendar date than it was dispatched, and by how many days. */
export function plantNextDay(dispatchAt: string | null, gateIn: string | null, firstWeight: string | null): { next: boolean; days: number } {
  const d = pkDate(dispatchAt);
  const a = pkDate(arrivalOf(gateIn, firstWeight));
  if (!d || !a) return { next: false, days: 0 };
  const days = dayDiff(d, a);
  return { next: days > 0, days: Math.max(0, days) };
}

/** The business day of plant arrival differs from the business day of dispatch. */
export function crossesBusinessDay(dispatchAt: string | null, gateIn: string | null, firstWeight: string | null): boolean {
  const d = businessDate(dispatchAt);
  const a = businessDate(arrivalOf(gateIn, firstWeight));
  return !!d && !!a && d !== a;
}

/** The ZMCC tank fill had two or more tankers. */
export const sharedFill = (fillCount: number | null | undefined): boolean => (fillCount ?? 0) >= 2;

/** No gate entry yet. */
export const notAtPlantYet = (gateIn: string | null): boolean => !gateIn;

/** Minutes from dispatch to gate entry (null when either is missing or the entry is before the dispatch). */
export function transitMinutes(dispatchAt: string | null, gateIn: string | null): number | null {
  if (!dispatchAt || !gateIn) return null;
  const m = (Date.parse(gateIn) - Date.parse(dispatchAt)) / 60_000;
  return Number.isFinite(m) && m >= 0 ? Math.round(m * 10) / 10 : null;
}

/** The worst step entered {@link LATE_ENTRY_MINUTES} or more after it happened. */
export function lateEntry(
  delays: Partial<Record<LateStep, number | null>>,
  threshold = LATE_ENTRY_MINUTES
): { late: boolean; step: LateStep | null; minutes: number | null } {
  let step: LateStep | null = null;
  let minutes: number | null = null;
  for (const s of LATE_STEPS) {
    const m = delays[s];
    if (m != null && Number.isFinite(m) && m >= threshold && (minutes == null || m > minutes)) {
      step = s;
      minutes = m;
    }
  }
  return { late: step != null, step, minutes };
}

/** Median of a list (null when empty). */
export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Transit time buckets in hours. */
export const TRANSIT_BUCKET_LABELS = ['0-2 h', '2-4 h', '4-8 h', '8-12 h', '12-24 h', '24 h+'] as const;
export function transitBucket(minutes: number): number {
  const h = minutes / 60;
  return h < 2 ? 0 : h < 4 ? 1 : h < 8 ? 2 : h < 12 ? 3 : h < 24 ? 4 : 5;
}

export interface TankerRow {
  visitId: string;
  visitNumber: string;
  vehicle: string;
  zmccId: string;
  zmcc: string;
  /** ISO instants. */
  dispatchAt: string | null;
  gateIn: string | null;
  gateOut: string | null;
  firstWeightAt: string | null;
  receiptAt: string | null;
  decision: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  /** Day keys in the chosen basis (calendar or business), so the browser can regroup. */
  dispatchDay: string;
  plantDay: string | null;
  /** Tank fill: id, tankers in it, and the place of this tanker (1-based). Null when no ledger row was found. */
  fillId: string | null;
  fillCount: number;
  fillPos: number;
  slipLiters: number | null;
  slip13: number | null;
  plantLiters: number | null;
  plant13: number | null;
  /** Minutes between when each step happened and when it was entered. */
  delays: Record<LateStep, number | null>;
  transit: number | null;
  nextDay: boolean;
  daysLater: number;
  crosses: boolean;
  shared: boolean;
  late: boolean;
  lateStep: LateStep | null;
  lateMinutes: number | null;
  notYet: boolean;
}

export interface TankersVisuals {
  /** Newest dispatch first, at most {@link TANKERS_MAX_ROWS}. */
  rows: TankerRow[];
  /** Dispatches in the range, before the cut. */
  total: number;
  cut: boolean;
}

/** Everything the flags need, as read from the database. */
export interface TankerFlagInput {
  dispatchAt: string | null;
  gateIn: string | null;
  firstWeightAt: string | null;
  fillCount: number;
  delays: Record<LateStep, number | null>;
}

export function tankerFlags(i: TankerFlagInput) {
  const nd = plantNextDay(i.dispatchAt, i.gateIn, i.firstWeightAt);
  const le = lateEntry(i.delays);
  return {
    transit: transitMinutes(i.dispatchAt, i.gateIn),
    nextDay: nd.next,
    daysLater: nd.days,
    crosses: crossesBusinessDay(i.dispatchAt, i.gateIn, i.firstWeightAt),
    shared: sharedFill(i.fillCount),
    late: le.late,
    lateStep: le.step,
    lateMinutes: le.minutes,
    notYet: notAtPlantYet(i.gateIn),
  };
}
