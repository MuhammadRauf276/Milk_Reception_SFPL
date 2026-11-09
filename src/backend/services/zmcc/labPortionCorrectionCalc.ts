import { calculateDensity, calculateSNF, exactTsFromLrFat } from '@/backend/utils/milkFormulas';

export type CorrectedPortionFigures = {
  density: number;
  snf: number;
  ts: number;
  /** Null until the portion has been weighed. */
  grossLiters: number | null;
  at13tsLiters: number | null;
};

/** The figures of a portion from its readings. Litres round first, as at unloading, so tank and report agree. */
export function correctedPortionFigures(i: { netWeightKg: number | null; lr: number; fat: number }): CorrectedPortionFigures | null {
  const ts = exactTsFromLrFat(i.lr, i.fat);
  if (ts === null) return null;
  const density = calculateDensity(i.lr);
  const snf = calculateSNF(i.lr, i.fat);
  if (i.netWeightKg === null) return { density, snf, ts, grossLiters: null, at13tsLiters: null };
  const grossLiters = Number((i.netWeightKg / density).toFixed(2));
  const at13tsLiters = Number(((grossLiters * ts) / 13).toFixed(2));
  return { density, snf, ts, grossLiters, at13tsLiters };
}

export type ReceiptPortion = { netWeightKg: number; grossLiters: number; at13tsLiters: number; density: number; lr: number; fat: number; snf: number; ts: number };

/** A tank receipt covers a whole vehicle: litres add up and the readings are weighted by weight. */
export function receiptTotals(portions: ReceiptPortion[]) {
  const netWeightKg = portions.reduce((n, p) => n + p.netWeightKg, 0);
  const weighted = (pick: (p: ReceiptPortion) => number) =>
    netWeightKg > 0 ? portions.reduce((n, p) => n + pick(p) * p.netWeightKg, 0) / netWeightKg : 0;
  return {
    netWeightKg,
    grossLiters: Number(portions.reduce((n, p) => n + p.grossLiters, 0).toFixed(3)),
    at13tsLiters: Number(portions.reduce((n, p) => n + p.at13tsLiters, 0).toFixed(3)),
    density: weighted((p) => p.density),
    lr: weighted((p) => p.lr),
    fat: weighted((p) => p.fat),
    snf: weighted((p) => p.snf),
    ts: weighted((p) => p.ts),
  };
}
