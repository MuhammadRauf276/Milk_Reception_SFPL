import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTankCycles, type StageLedgerRow } from '@/backend/services/zmccStageChainService';

const base = { tankId: '1', tankCode: 'TANK-01', zmccId: '1', referenceType: null, at13tsLiters: null, receiptKind: 'MOT', visitId: null, visitNumber: null, vehicleNumber: null, dispatchLiters: null, dispatchAt13ts: null, plantNetKg: null, plantLr: null, plantTs: null } as const;
const receipt = (day: string, liters: number, ts: number, kind = 'MOT'): StageLedgerRow => ({ ...base, type: 'RECEIPT', day, quantityLiters: liters, receiptLiters: liters, receiptTs: ts, receiptKind: kind });
const issue = (day: string, liters: number, at13: number, plant?: { kg: number; lr: number; ts: number }): StageLedgerRow => ({
  ...base, type: 'ISSUE', day, quantityLiters: liters, receiptLiters: null, receiptTs: null, receiptKind: null,
  visitId: 'v' + day, visitNumber: 'VV-' + day, vehicleNumber: 'LES-3160', dispatchLiters: liters, dispatchAt13ts: at13,
  plantNetKg: plant?.kg ?? null, plantLr: plant?.lr ?? null, plantTs: plant?.ts ?? null,
});

test('17 Nov Hasilpur: the slip claims more than the tank milk held; the road loss is measured against the true figure', () => {
  // The five 17 Nov receipts (litres, TS) and the one tanker: slip 10,749.76 L / 11,170.65 @13 TS; plant 10,706 L at TS 13.26.
  const rows = [
    receipt('2026-11-17', 1495, 13.26, 'HC'),
    receipt('2026-11-17', 2651, 12.96),
    receipt('2026-11-17', 3444, 13.94),
    receipt('2026-11-17', 1454, 13.32),
    receipt('2026-11-17', 1695, 12.71, 'HC'),
    issue('2026-11-17', 10749.76, 11170.65, { kg: 10706 * 1.0265, lr: 26.5, ts: 13.26 }),
  ];
  const [c] = buildTankCycles(rows);
  assert.equal(c.tankers.length, 1);
  assert.ok(Math.abs(c.intake.liters - 10739) < 0.01);
  assert.ok(Math.abs(c.ts.tank! - 13.33) < 0.01, `tank TS ${c.ts.tank}`);
  assert.ok(c.ts.slip! > c.ts.tank!, 'slip TS above the tank milk');
  assert.ok(c.slipOver13ts > 150 && c.slipOver13ts < 190, `slip over ${c.slipOver13ts}`);
  assert.ok(Math.abs(c.road!.liters - (10706 - 10749.76)) < 0.5);
  assert.ok(Math.abs(c.leftInTank.liters - (10739 - 10749.76)) < 0.01);
  assert.ok(Math.abs(c.hc.liters - 3190) < 0.01 && Math.abs(c.mot.liters - 7549) < 0.01);
});

test('two tankers after one intake form one cycle; a later receipt starts the next; corrections are not counted twice', () => {
  const rows: StageLedgerRow[] = [
    receipt('2026-11-10', 1000, 13),
    { ...base, type: 'ADJUSTMENT_OUT', day: '2026-11-18', quantityLiters: 0.01, at13tsLiters: 500, referenceType: 'ZMCC_LAB_SESSION_CORRECTION', receiptLiters: null, receiptTs: null, receiptKind: null },
    issue('2026-11-11', 600, 600, { kg: 615.9, lr: 26.5, ts: 13 }),
    issue('2026-11-11', 400, 400),
    receipt('2026-11-12', 500, 13),
  ];
  const cycles = buildTankCycles(rows);
  assert.equal(cycles.length, 1, 'the open cycle with no dispatch yet is not a cycle');
  assert.equal(cycles[0].tankers.length, 2);
  assert.equal(cycles[0].plant, null, 'one tanker has no plant receipt yet');
  assert.ok(Math.abs(cycles[0].adjustments.at13ts) < 0.001, 'the lab correction row is skipped');
  assert.ok(Math.abs(cycles[0].slipOver13ts) < 0.01);
});
