import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortionReceived } from '../lossCalculationService';

// The weighing screen stores litres as net kg (litres x density). The tank then gets litres = net kg / density.
const typedLitres = (litres: number, density: number) => Number((litres * density).toFixed(3));

test('typed litres reach the tank as the same litres', () => {
  for (const [litres, lr] of [[2875, 26], [2905, 26.5], [1234.56, 28.8], [50, 30]] as const) {
    const density = 1 + lr / 1000;
    const m = calculatePortionReceived({ netWeightKg: typedLitres(litres, density), density, lr, ts: 13 });
    assert.equal(m.grossLiters, litres);
    assert.equal(m.at13tsLiters, litres);
  }
});

test('typed kilograms become litres through the density', () => {
  const m = calculatePortionReceived({ netWeightKg: 2949.75, density: 1.026, lr: 26, ts: 13.44 });
  assert.equal(m.grossLiters, 2875);
  assert.equal(m.at13tsLiters, 2972.31);
});

test('the same milk gives the same result in litres or kilograms', () => {
  const density = 1.0285;
  const inLitres = calculatePortionReceived({ netWeightKg: typedLitres(1000, density), density, lr: 28.5, ts: 12.8 });
  const inKg = calculatePortionReceived({ netWeightKg: 1028.5, density, lr: 28.5, ts: 12.8 });
  assert.deepEqual(inLitres, inKg);
});
