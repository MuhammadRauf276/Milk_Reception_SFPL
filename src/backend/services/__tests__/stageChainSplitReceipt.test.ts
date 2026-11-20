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
