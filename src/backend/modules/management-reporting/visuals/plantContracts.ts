/**
 * Plant tab of the Visuals page (see docs/VISUALS_BRIEF.md). The shapes sent to the browser, and the small pure
 * helpers for duration statistics that both server and browser use (no server imports here).
 */

/** Stage keys in the order a vehicle goes through the plant. `total` is gate entry to gate exit. */
export const PLANT_STAGE_KEYS = ['gate_qa', 'qa', 'qa_weight', 'weight_unload', 'unloading', 'unload_weight2', 'weight2_receipt', 'receipt_exit'] as const;
export type PlantStageKey = (typeof PLANT_STAGE_KEYS)[number];
export type PlantDurationKey = PlantStageKey | 'total';

export const PLANT_STAGE_LABELS: Record<PlantDurationKey, string> = {
  gate_qa: 'Gate to QA start',
  qa: 'QA testing',
  qa_weight: 'QA done to 1st weight',
  weight_unload: '1st weight to unloading',
  unloading: 'Unloading',
  unload_weight2: 'Unloading to 2nd weight',
  weight2_receipt: '2nd weight to receipt',
  receipt_exit: 'Receipt to gate exit',
  total: 'Total in plant',
};

export type PlantType = 'ALL' | 'ZMCC' | 'CONTRACTOR';

/** Count, median, 90th percentile and average of a duration in minutes. */
export interface PlantStat {
  n: number;
  median: number | null;
  p90: number | null;
  avg: number | null;
}

export interface PlantDayRow {
  day: string;
  /** Vehicles that entered the gate. */
  vehicles: number;
  accepted: number;
  rejected: number;
  /** Vehicles with a full gate-to-gate time, and their median and p90 times those vehicles (so weeks and months can be averaged fairly). */
  n: number;
  medW: number;
  p90W: number;
  liters: number;
  at13ts: number;
}

export interface PlantView {
  vehicles: number;
  insideNow: number;
  accepted: number;
  rejected: number;
  liters: number;
  at13ts: number;
  total: PlantStat;
  stages: Record<PlantStageKey, PlantStat>;
  days: PlantDayRow[];
  /** Vehicles per time-in-plant bucket: 0-1 h, 1-2 h … 7-8 h, 8 h+. */
  histogram: number[];
  /** Gate entries per hour of the day (Pakistan time), 24 values. */
  hours: number[];
  /** Rejection reasons, top 10 and "Others". */
  reasons: Array<{ reason: string; count: number }>;
}

export interface PlantSourceRow {
  id: string;
  name: string;
  type: 'ZMCC' | 'CONTRACTOR' | 'UNKNOWN';
  vehicles: number;
  accepted: number;
  rejected: number;
  total: PlantStat;
  /** Median minutes per stage. */
  stages: Record<PlantStageKey, number | null>;
}

export interface PlantVehicleRow {
  visitId: string;
  vehicle: string;
  source: string;
  type: 'ZMCC' | 'CONTRACTOR' | 'UNKNOWN';
  entry: string;
  exit: string;
  totalMin: number;
  longestStage: PlantStageKey | null;
  longestMin: number | null;
}

export interface PlantInsideRow {
  visitId: string;
  vehicle: string;
  source: string;
  type: 'ZMCC' | 'CONTRACTOR' | 'UNKNOWN';
  entry: string;
  hours: number;
}

export interface PlantVisuals {
  views: Record<PlantType, PlantView>;
  /** Top 50 sources by vehicles. */
  sources: PlantSourceRow[];
  /** The 15 slowest of each type (the browser picks by type). */
  slowest: PlantVehicleRow[];
  /** Vehicles inside for more than 12 h (up to 15, longest first). */
  longInside: PlantInsideRow[];
}

/* ------------------------------ Pure helpers ------------------------------ */

export const HISTOGRAM_LABELS = ['0-1 h', '1-2 h', '2-3 h', '3-4 h', '4-5 h', '5-6 h', '6-7 h', '7-8 h', '8 h+'] as const;
export const HISTOGRAM_BUCKETS = HISTOGRAM_LABELS.length;

/** Percentile with linear interpolation (the same as PostgreSQL percentile_cont). Null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = Math.min(1, Math.max(0, p)) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** The bucket (0-8) of a time in minutes: whole hours, with 8 h and more in the last. Null for a missing or negative time. */
export function hourBucketIndex(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  return Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(minutes / 60));
}

/** Counts of times per hour bucket. */
export function histogramBuckets(minutesList: Array<number | null | undefined>): number[] {
  const out = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  for (const m of minutesList) {
    const i = hourBucketIndex(m);
    if (i != null) out[i] += 1;
  }
  return out;
}

/** A reason as typed, cleaned for grouping: trimmed, spaces collapsed, lower case. Empty becomes "(no reason)". */
export function normaliseReason(raw: string | null | undefined): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return t || '(no reason)';
}

/** The `keep` most frequent reasons; the rest is added up as "Others". Equal reasons (after cleaning) are merged. */
export function topReasons(rows: Array<{ reason: string; count: number }>, keep = 10): Array<{ reason: string; count: number }> {
  const merged = new Map<string, number>();
  for (const r of rows) {
    if (r.count <= 0) continue;
    const k = normaliseReason(r.reason);
    merged.set(k, (merged.get(k) ?? 0) + r.count);
  }
  const sorted = [...merged.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const head = sorted.slice(0, keep);
  const rest = sorted.slice(keep).reduce((s, r) => s + r.count, 0);
  return rest > 0 ? [...head, { reason: 'Others', count: rest }] : head;
}

/** The stage with the largest median, or null when none has one. */
export function slowestStage(medians: Partial<Record<PlantStageKey, number | null>>): PlantStageKey | null {
  let best: PlantStageKey | null = null;
  let bestV = -Infinity;
  for (const k of PLANT_STAGE_KEYS) {
    const v = medians[k];
    if (v != null && Number.isFinite(v) && v > bestV) {
      best = k;
      bestV = v;
    }
  }
  return best;
}

/** Share of decided portions that were rejected, in %. Null when nothing was decided. */
export function rejectionRate(accepted: number, rejected: number): number | null {
  const t = accepted + rejected;
  return t > 0 ? (rejected / t) * 100 : null;
}

/** A week or month median worked out as the average of the daily medians, weighted by the vehicles of each day. */
export function weightedMedian(weighted: number, n: number): number | null {
  return n > 0 ? weighted / n : null;
}
