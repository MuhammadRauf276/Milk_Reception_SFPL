import test from 'node:test';
import assert from 'node:assert/strict';
import { tripOf, tripPct, tsOfLiters } from '@/backend/modules/management-reporting/visuals/testersContracts';

test('trip loss is negative, gain positive', () => {
  assert.deepEqual(tripOf({ liters: 980, at13ts: 1000 }, { liters: 1000, at13ts: 1010 }), { liters: -20, at13ts: -10 });
  assert.equal(tripOf({ liters: 105, at13ts: 0 }, { liters: 100, at13ts: 0 }).liters, 5);
});

test('trip percent of collected, null when nothing collected', () => {
  assert.equal(tripPct(-20, 1000), -2);
  assert.equal(tripPct(5, 0), null);
});

test('ts from litres and @13 litres', () => {
  assert.equal(tsOfLiters(100, 100), 13);
  assert.equal(tsOfLiters(0, 10), null);
});
