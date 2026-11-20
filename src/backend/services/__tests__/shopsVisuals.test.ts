import test from 'node:test';
import assert from 'node:assert/strict';
import { completionPct, shopConcentration, topRouteIdsOf } from '@/backend/modules/management-reporting/visuals/shopsContracts';

test('concentration: how many shops give 50% and 80%', () => {
  const c = shopConcentration([50, 20, 10, 10, 5, 5]);
  assert.equal(c.totalShops, 6);
  assert.equal(c.shops50, 1);
  assert.equal(c.shops80, 3);
  assert.equal(c.curve[c.curve.length - 1].pct, 100);
});

test('concentration: ignores zero and handles empty', () => {
  assert.deepEqual(shopConcentration([0, 0]), { totalShops: 0, shops50: 0, shops80: 0, curve: [] });
  assert.equal(shopConcentration([10, 0, 10]).shops50, 1);
});

test('concentration: curve is sampled but keeps the last point', () => {
  const c = shopConcentration(Array.from({ length: 500 }, () => 1), 40);
  assert.ok(c.curve.length <= 41);
  assert.equal(c.curve[c.curve.length - 1].shops, 500);
  assert.equal(c.shops50, 250);
});

test('top routes and completion', () => {
  assert.deepEqual(topRouteIdsOf([{ id: 'a', value: 1 }, { id: 'b', value: 5 }, { id: 'c', value: 0 }, { id: 'd', value: 3 }], 2), ['b', 'd']);
  assert.equal(completionPct(3, 4), 75);
  assert.equal(completionPct(0, 0), null);
});
