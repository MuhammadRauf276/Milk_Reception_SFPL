export type TankCorrectionRow = {
  kind: 'PHYSICAL' | 'COMMERCIAL' | 'COMMERCIAL_OFFSET';
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  quantityLiters: number;
  at13Liters: number;
};

const SMALLEST_CHANGE = 0.01;

/**
 * Ledger rows for a correction, from how the tank stock changes: positive adds stock, negative removes it.
 * One row has one direction, so when litres and @13 TS move opposite ways they need separate rows. A change in
 * @13 TS alone (a corrected Fat, say) also needs rows, or the @13 TS stock would drift away from the receipts.
 *
 * The database refuses a row with zero litres. So a change in @13 TS alone is a pair: 0.01 L each way, which adds up
 * to no change in litres, with the @13 TS change on one of them.
 */
export function planTankCorrectionRows(stockChangeLiters: number, stockChangeAt13: number): TankCorrectionRow[] {
  const liters = Math.abs(stockChangeLiters) >= SMALLEST_CHANGE ? stockChangeLiters : 0;
  const at13 = Math.abs(stockChangeAt13) >= SMALLEST_CHANGE ? stockChangeAt13 : 0;
  const typeOf = (change: number): TankCorrectionRow['type'] => (change > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT');

  const at13Pair = (): TankCorrectionRow[] => [
    { kind: 'COMMERCIAL', type: typeOf(at13), quantityLiters: SMALLEST_CHANGE, at13Liters: Math.abs(at13) },
    { kind: 'COMMERCIAL_OFFSET', type: typeOf(-at13), quantityLiters: SMALLEST_CHANGE, at13Liters: 0 },
  ];

  if (liters === 0 && at13 === 0) return [];
  if (liters === 0) return at13Pair();
  if (at13 === 0 || liters > 0 === at13 > 0) {
    return [{ kind: 'PHYSICAL', type: typeOf(liters), quantityLiters: Math.abs(liters), at13Liters: Math.abs(at13) }];
  }
  return [{ kind: 'PHYSICAL', type: typeOf(liters), quantityLiters: Math.abs(liters), at13Liters: 0 }, ...at13Pair()];
}
