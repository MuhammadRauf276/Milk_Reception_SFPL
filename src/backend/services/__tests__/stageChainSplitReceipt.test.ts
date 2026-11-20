import test from 'node:test';
import assert from 'node:assert/strict';
import { splitReceiptsAcrossTanks, type StageLedgerRow } from '@/backend/services/zmccStageChainService';

const row = (over: Partial<StageLedgerRow>): StageLedgerRow => ({
  tankId: '1', tankCode: 'T1', zmccId: '9', type: 'RECEIPT', referenceType: null, day: '2026-11-01',
  quantityLiters: 0, at13tsLiters: null, receiptLiters: null, receiptTs: null, receiptKind: 'HC', receiptId: null,
  visitId: null, visitNumber: null, vehicleNumber: null, dispatchLiters: null, dispatchAt13ts: null,
  plantNetKg: null, plantLr: null, plantTs: null, ...over,
});

test('a receipt poured into two tanks is counted once, each tank getting its own part', () => {
  const out = splitReceiptsAcrossTanks([
    row({ tankId: '1', receiptId: '46', quantityLiters: 3000, receiptLiters: 3800 }),
    row({ tankId: '2', receiptId: '46', quantityLiters: 800, receiptLiters: 3800 }),
  ]);
  assert.equal(out[0].receiptLiters! + out[1].receiptLiters!, 3800);
  assert.equal(out[0].receiptLiters, 3000);
  assert.equal(out[1].receiptLiters, 800);
});

test('a receipt in one tank, and dispatch rows, stay as they are', () => {
  const one = row({ receiptId: '42', quantityLiters: 2139.04, receiptLiters: 2140 });
  const issue = row({ type: 'ISSUE', quantityLiters: 500 });
  assert.deepEqual(splitReceiptsAcrossTanks([one, issue]), [one, issue]);
});

test('an overstated slip does not make the next fill look poorer (no compounding)', async () => {
  const { buildTankCycles } = await import('@/backend/services/zmccStageChainService');
  // Fill 1: 1000 L at TS 13 (1000 @13). Slip says 600 L at 700 @13 (overstated by 100). 400 L stay at TS 13.
  // Fill 2: 600 L more at TS 13. Tank is 1000 L at TS 13 again; a slip of 1000 L at 1000 @13 is exact.
  const rows: StageLedgerRow[] = [
    row({ receiptId: '1', quantityLiters: 1000, receiptLiters: 1000, receiptTs: 13 }),
    row({ type: 'ISSUE', quantityLiters: 600, dispatchLiters: 600, dispatchAt13ts: 700 }),
    row({ receiptId: '2', quantityLiters: 600, receiptLiters: 600, receiptTs: 13 }),
    row({ type: 'ISSUE', quantityLiters: 1000, dispatchLiters: 1000, dispatchAt13ts: 1000 }),
  ];
  const cycles = buildTankCycles(rows);
  assert.equal(cycles.length, 2);
  assert.ok(Math.abs(cycles[0].slipOver13ts - 100) < 1e-9);
  assert.ok(Math.abs(cycles[1].slipOver13ts) < 1e-9, `second fill overstated ${cycles[1].slipOver13ts}`);
  assert.ok(Math.abs((cycles[1].ts.tank ?? 0) - 13) < 1e-9);
});

test('an admin adjustment without @13 TS keeps the tank quality instead of watering it down', async () => {
  const { buildTankCycles } = await import('@/backend/services/zmccStageChainService');
  const rows: StageLedgerRow[] = [
    row({ receiptId: '1', quantityLiters: 1000, receiptLiters: 1000, receiptTs: 13 }),
    row({ type: 'ISSUE', quantityLiters: 500, dispatchLiters: 500, dispatchAt13ts: 500 }),
    row({ type: 'ADJUSTMENT_IN', referenceType: 'ADMIN', quantityLiters: 200, at13tsLiters: null }),
    row({ type: 'ISSUE', quantityLiters: 700, dispatchLiters: 700, dispatchAt13ts: 700 }),
  ];
  const cycles = buildTankCycles(rows);
  assert.ok(Math.abs(cycles[1].slipOver13ts) < 1e-9, `overstated ${cycles[1].slipOver13ts}`);
});

test('a receipt entered after its dispatch joins that fill instead of the next one', async () => {
  const { buildTankCycles } = await import('@/backend/services/zmccStageChainService');
  // 300 L in the tank at TS 13. A tanker of 1000 L leaves (slip exact at TS 12: 923.08 @13)... the 700 L it needed
  // (TS 11.857) is entered afterwards. Fill TS = (300×13 + 700×11.857)/1000 = 12; slip TS 12 → not overstated.
  const rows: StageLedgerRow[] = [
    row({ receiptId: '1', quantityLiters: 300, receiptLiters: 300, receiptTs: 13 }),
    row({ type: 'ISSUE', quantityLiters: 1000, dispatchLiters: 1000, dispatchAt13ts: (1000 * 12) / 13 }),
    row({ receiptId: '2', quantityLiters: 700, receiptLiters: 700, receiptTs: (12000 - 3900) / 700 }),
    row({ receiptId: '3', quantityLiters: 500, receiptLiters: 500, receiptTs: 13 }),
    row({ type: 'ISSUE', quantityLiters: 500, dispatchLiters: 500, dispatchAt13ts: 500 }),
  ];
  const cycles = buildTankCycles(rows);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].lateIntake?.liters, 700);
  assert.equal(cycles[0].overdrawn, false);
  assert.ok(Math.abs(cycles[0].slipOver13ts) < 1e-6, `first fill overstated ${cycles[0].slipOver13ts}`);
  assert.ok(Math.abs(cycles[1].slipOver13ts) < 1e-6, `second fill overstated ${cycles[1].slipOver13ts}`);
});

test('a fill that sends out more than it ever held is marked', async () => {
  const { buildTankCycles } = await import('@/backend/services/zmccStageChainService');
  const cycles = buildTankCycles([
    row({ receiptId: '1', quantityLiters: 300, receiptLiters: 300, receiptTs: 13 }),
    row({ type: 'ISSUE', quantityLiters: 1000, dispatchLiters: 1000, dispatchAt13ts: 1000 }),
  ]);
  assert.equal(cycles[0].overdrawn, true);
});
