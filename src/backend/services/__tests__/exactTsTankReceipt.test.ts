import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortionReceived } from '../lossCalculationService';
import { exactTsFromLrFat } from '../../utils/milkFormulas';

test('exact TS keeps the decimals that rounding drops', () => {
  assert.equal(Number(exactTsFromLrFat(27, 4.4)!.toFixed(3)), 12.838);
});

test('tank @13 TS uses exact TS: 5,240 kg at LR 27, Fat 4.4', () => {
  const m = calculatePortionReceived({ netWeightKg: 5240, lr: 27, ts: exactTsFromLrFat(27, 4.4)! });
  assert.equal(m.grossLiters, 5102.24);
  assert.equal(m.at13tsLiters, 5038.66);
});

test('exact TS is null when a reading is missing or invalid, so stored TS is used', () => {
  assert.equal(exactTsFromLrFat(null, 4.4), null);
  assert.equal(exactTsFromLrFat(27, null), null);
  assert.equal(exactTsFromLrFat(undefined, undefined), null);
  assert.equal(exactTsFromLrFat(0, 4.4), null);
  assert.equal(exactTsFromLrFat(27, -1), null);
  assert.equal(exactTsFromLrFat(Number.NaN, 4.4), null);
});
