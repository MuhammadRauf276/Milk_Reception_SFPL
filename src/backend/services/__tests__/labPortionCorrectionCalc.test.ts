import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedPortionFigures, receiptTotals } from '../zmcc/labPortionCorrectionCalc';
import { planTankCorrectionRows } from '../tankCorrectionLedger';

test('Fat corrected from 4.4 to 4.6 on 154 kg at LR 27: worked out by hand', () => {
  // Density 1.027, litres 149.95. TS 4.6 + 6.75 + 1.012 + 0.72 = 13.082. @13 TS 149.95 x 13.082 / 13 = 150.90.
  const after = correctedPortionFigures({ netWeightKg: 154, lr: 27, fat: 4.6 })!;
  assert.equal(after.grossLiters, 149.95);
  assert.equal(after.at13tsLiters, 150.9);
  assert.equal(Number(after.ts.toFixed(3)), 13.082);
  const before = correctedPortionFigures({ netWeightKg: 154, lr: 27, fat: 4.4 })!;
  assert.equal(before.at13tsLiters, 148.08);
});

test('a Fat correction moves @13 TS only, so litres in the tank stay the same', () => {
  const rows = planTankCorrectionRows(149.95 - 149.95, 150.9 - 148.08);
  const net = rows.reduce((n, r) => n + (r.type === 'ADJUSTMENT_IN' ? r.quantityLiters : -r.quantityLiters), 0);
  assert.equal(Number(net.toFixed(2)), 0);
});

test('an LR correction changes litres as well', () => {
  const after = correctedPortionFigures({ netWeightKg: 154, lr: 28, fat: 4.4 })!;
  assert.equal(after.grossLiters, 149.81);
});

test('a net weight correction changes litres and @13 TS', () => {
  const after = correctedPortionFigures({ netWeightKg: 160, lr: 27, fat: 4.4 })!;
  assert.equal(after.grossLiters, 155.79);
});

test('a portion not yet weighed has readings but no litres', () => {
  const after = correctedPortionFigures({ netWeightKg: null, lr: 27, fat: 4.6 })!;
  assert.equal(after.grossLiters, null);
  assert.equal(after.at13tsLiters, null);
  assert.equal(after.density, 1.027);
});

test('invalid readings are refused', () => {
  assert.equal(correctedPortionFigures({ netWeightKg: 100, lr: 0, fat: 4 }), null);
  assert.equal(correctedPortionFigures({ netWeightKg: 100, lr: 27, fat: -1 }), null);
});

test('receipt totals add litres and weight the readings by net weight', () => {
  const t = receiptTotals([
    { netWeightKg: 100, grossLiters: 97.37, at13tsLiters: 96, density: 1.027, lr: 27, fat: 4, snf: 8.35, ts: 12.35 },
    { netWeightKg: 300, grossLiters: 291.26, at13tsLiters: 290, density: 1.03, lr: 30, fat: 5, snf: 9, ts: 14 },
  ]);
  assert.equal(t.netWeightKg, 400);
  assert.equal(t.grossLiters, 388.63);
  assert.equal(t.at13tsLiters, 386);
  assert.equal(t.fat, 4.75);
  assert.equal(t.lr, 29.25);
});

test('no portions gives zeros, not a divide by zero', () => {
  const t = receiptTotals([]);
  assert.equal(t.netWeightKg, 0);
  assert.equal(t.fat, 0);
});
