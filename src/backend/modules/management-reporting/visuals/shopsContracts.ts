/** Shops & routes tab of the Visuals page (see docs/VISUALS_BRIEF.md). Pure helpers here are shared by the loader, the tab and the tests. */
import type { QtyPair } from './common';

export interface ShopsDayRow {
  day: string;
  /** Accepted milk that day. */
  collected: QtyPair;
  /** Accepted milk of the top routes, keyed "r<routeId>"; the rest is collected minus these. */
  byRoute: Record<string, QtyPair>;
  accepted: number;
  rejected: number;
  planned: number;
  done: number;
}

export interface ShopsRouteRow {
  id: string;
  name: string;
  code: string;
  zmccName: string;
  journeys: number;
  planned: number;
  done: number;
  accepted: number;
  rejected: number;
  /** Shops that gave milk on this route. */
  shops: number;
  collected: QtyPair;
}

export interface ShopsShopRow {
  id: string;
  code: string;
  name: string;
  routeName: string;
  zmccName: string;
  daysWithMilk: number;
  rejected: number;
  collected: QtyPair;
}

export interface ShopConcentration {
  /** Shops that gave milk. */
  totalShops: number;
  /** How many of the biggest shops give half and four fifths of the milk. */
  shops50: number;
  shops80: number;
  /** Cumulative share: after the n biggest shops, pct of all milk. Sampled to a few dozen points. */
  curve: Array<{ shops: number; pct: number }>;
}

export interface ShopsVisuals {
  days: ShopsDayRow[];
  /** Route ids drawn as their own colour in the daily stack (up to five). */
  topRouteIds: string[];
  routes: ShopsRouteRow[];
  shops: ShopsShopRow[];
  /** How many shops gave milk in the period (all shops, not only the ones listed). */
  shopsGave: number;
  concentration: { liters: ShopConcentration; at13ts: ShopConcentration };
  routeOptions: Array<{ id: string; name: string; group: string }>;
}

/** Shops needed for 50 % and 80 % of the milk, and the cumulative curve. Zero and negative values are ignored. */
export function shopConcentration(values: number[], maxPoints = 40): ShopConcentration {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => b - a);
  const total = v.reduce((s, x) => s + x, 0);
  if (!v.length || total <= 0) return { totalShops: 0, shops50: 0, shops80: 0, curve: [] };
  let run = 0;
  let shops50 = 0;
  let shops80 = 0;
  const full: Array<{ shops: number; pct: number }> = [];
  v.forEach((x, i) => {
    run += x;
    const pct = (run / total) * 100;
    if (!shops50 && pct >= 50 - 1e-9) shops50 = i + 1;
    if (!shops80 && pct >= 80 - 1e-9) shops80 = i + 1;
    full.push({ shops: i + 1, pct: Math.round(pct * 100) / 100 });
  });
  const step = Math.max(1, Math.ceil(full.length / maxPoints));
  const curve = full.filter((p, i) => i % step === 0 || i === full.length - 1);
  return { totalShops: v.length, shops50, shops80, curve };
}

/** Route ids of the `n` largest routes by value (ties keep input order). */
export function topRouteIdsOf(rows: Array<{ id: string; value: number }>, n = 5): string[] {
  return [...rows]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
    .map((r) => r.id);
}

/** Done as a share of planned, in %, or null when nothing was planned. */
export const completionPct = (done: number, planned: number): number | null => (planned > 0 ? Math.round((done / planned) * 10000) / 100 : null);
