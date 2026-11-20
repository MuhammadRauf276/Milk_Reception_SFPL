/** HC suppliers tab of the Visuals page (see docs/VISUALS_BRIEF.md). */
import type { QtyPair } from './common';

/** One HC supplier over the chosen days. `__others` is every supplier beyond the largest ones, added up. */
export interface HcSupplierRow {
  id: string;
  name: string;
  code: string | null;
  zmccName: string;
  arrivals: number;
  accepted: number;
  rejected: number;
  /** Left without full unloading (partly or not received). */
  leftEarly: number;
  received: QtyPair;
  /** Days with at least one arrival. */
  daysSupplied: number;
}

export interface HcDay {
  day: string;
  arrivals: number;
  accepted: number;
  rejected: number;
  leftEarly: number;
  received: QtyPair;
}

export interface HcTotals {
  arrivals: number;
  accepted: number;
  rejected: number;
  leftEarly: number;
  received: QtyPair;
  /** Suppliers with at least one arrival. */
  activeSuppliers: number;
  /** Share (%) of the received milk @13 TS that came from the five biggest suppliers; null when nothing was received. */
  top5Share: number | null;
}

export interface HcVisuals {
  /** Pick box: every active HC supplier of the ZMCCs in view, grouped by ZMCC name. */
  supplierOptions: Array<{ id: string; name: string; code: string | null; group: string }>;
  totals: HcTotals;
  daily: HcDay[];
  suppliers: HcSupplierRow[];
  /** Typed rejection reasons, most frequent first (small list). */
  rejectionReasons: Array<{ reason: string; count: number }>;
}
