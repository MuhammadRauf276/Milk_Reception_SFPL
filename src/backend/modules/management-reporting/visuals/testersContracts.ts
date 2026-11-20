/** Mobile Testers tab of the Visuals page (see docs/VISUALS_BRIEF.md). Pure helpers here are shared by the loader, the tab and the tests. */
import type { QtyPair } from './common';

export interface TestersDayRow {
  day: string;
  collected: QtyPair;
  /** Collected on journeys that arrived at the ZMCC: the fair base for trip loss/gain. */
  collectedArrived: QtyPair;
  received: QtyPair;
  journeys: number;
  notArrived: number;
  shops: number;
  rejected: number;
  /** Collected per picked Mobile Tester (only when 2 to 5 are picked), keyed "t<id>". */
  byTester: Record<string, QtyPair>;
}

export interface TesterRow {
  id: string;
  name: string;
  code: string;
  zmccName: string;
  journeys: number;
  notArrived: number;
  shops: number;
  rejected: number;
  collected: QtyPair;
  collectedArrived: QtyPair;
  received: QtyPair;
}

export interface TestersVisuals {
  days: TestersDayRow[];
  testers: TesterRow[];
  /** Picked Mobile Testers drawn as lines (2 to 5), in pick order. */
  lineTesters: Array<{ id: string; name: string }>;
  testerOptions: Array<{ id: string; name: string; group: string }>;
}

/** Trip loss/gain: received minus collected, loss negative. */
export const tripOf = (received: QtyPair, collectedArrived: QtyPair): QtyPair => ({
  liters: Math.round((received.liters - collectedArrived.liters) * 100) / 100,
  at13ts: Math.round((received.at13ts - collectedArrived.at13ts) * 100) / 100,
});

/** Trip loss/gain in % of what was collected, or null when nothing was collected. */
export const tripPct = (trip: number, collectedArrived: number): number | null =>
  collectedArrived > 0 ? Math.round((trip / collectedArrived) * 10000) / 100 : null;

/** TS from litres and litres @13 TS. */
export const tsOfLiters = (liters: number, at13: number): number | null => (liters > 0 ? Math.round(((at13 * 13) / liters) * 100) / 100 : null);
