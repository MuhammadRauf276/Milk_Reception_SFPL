import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { tankDispatchAllowance } from '@/backend/services/dispatch/dispatchDecisionService';
import { getTankVarianceWatch } from '@/backend/services/zmccTankVarianceWatch';
import { getWeighingPolicyDb, MAX_TANK_VARIANCE_PERCENT, updateWeighingPolicy } from '@/backend/services/zmccWeighingPolicyService';

test('a dispatch fits when its @13 TS is within the book plus the variance of the dispatch', () => {
  // 10,000 L @13 TS in the tank, 0.5% of a 10,040 L dispatch is 50.2 L, so up to 10,050.2 L passes.
  assert.equal(tankDispatchAllowance(10_000, 10_040, 0.5).ok, true);
  assert.equal(tankDispatchAllowance(10_000, 10_000, 0.5).ok, true);
  assert.equal(tankDispatchAllowance(10_000, 10_060, 0.5).ok, false);
  // No allowance: the book is the limit.
  assert.equal(tankDispatchAllowance(10_000, 10_000.01, 0).ok, false);
  // A negative setting can never widen the check.
  assert.equal(tankDispatchAllowance(10_000, 10_001, -3).ok, false);
});

test('gross litres play no part: only @13 TS litres reach the check', () => {
  // The function takes no gross figure; a dispatch with more gross than the book but less @13 TS passes.
  assert.equal(tankDispatchAllowance(9_000, 8_990, 0.5).ok, true);
});

test('the variance setting is read with a 0.5 default and refused outside 0 to the maximum', async () => {
  const policy = await getWeighingPolicyDb(prisma);
  assert.equal(typeof policy.tank_variance_percent, 'number');
  const acting = { userId: BigInt(1) } as never;
  const base = { manual_entry_enabled: policy.manual_entry_enabled, allowed_units: policy.allowed_units };
  assert.equal((await updateWeighingPolicy(acting, { ...base, tank_variance_percent: -1 })).status, 400);
  assert.equal((await updateWeighingPolicy(acting, { ...base, tank_variance_percent: MAX_TANK_VARIANCE_PERCENT + 1 })).status, 400);
  assert.equal((await updateWeighingPolicy(acting, { ...base, tank_variance_percent: 'x' })).status, 400);
});

test('the variance watch reads the ledger and the audit log without error', async () => {
  const watch = await getTankVarianceWatch(30);
  assert.equal(watch.days, 30);
  assert.ok(Array.isArray(watch.overBook) && Array.isArray(watch.blocked));
  for (const r of watch.overBook) assert.ok(r.bookAfterAt13ts < 0, 'only dispatches that took the book below zero');
});

test.after(async () => {
  await prisma.$disconnect();
});
