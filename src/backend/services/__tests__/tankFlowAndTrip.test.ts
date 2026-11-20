import test from 'node:test';
import assert from 'node:assert/strict';
import { flowSummary, type FlowDay } from '@/backend/modules/management-reporting/visuals/tankFlow';
import { journeyTripFigures } from '@/backend/services/motTripFigures';

const day = (over: Partial<FlowDay>): FlowDay => ({ day: '2026-11-01', mc: 0, hc: 0, other: 0, adminIn: 0, adminOut: 0, dispatch: 0, over: 0, plant: 0, ...over });

test('tank flow adds up from opening to closing; a dispatch above intake comes from stock', () => {
  const days = [day({ mc: 3000, hc: 2000 }), day({ day: '2026-11-02', dispatch: 9000, adminIn: 500, adminOut: 100 })];
  const tank = [
    { day: '2026-11-01', opening: 10000, inL: 5000, outL: 0, closing: 15000 },
    { day: '2026-11-02', opening: 15000, inL: 500, outL: 9100, closing: 6400 },
  ];
  const t = flowSummary(days, tank);
  assert.equal(t.opening, 10000);
  assert.equal(t.closing, 6400);
  assert.equal(t.gap, 0);
  assert.equal(t.fromStock, 4000);
});

test('the gap shows what the ledger moved beyond the flows; without the ledger there is no level', () => {
  const t = flowSummary([day({ mc: 100 })], [{ day: '2026-11-01', opening: 0, inL: 100, outL: 0, closing: 90 }]);
  assert.equal(t.gap, -10);
  assert.equal(flowSummary([day({ mc: 100 })], null).opening, null);
});

test('trip rule: stored ZMCC figure first, shops from the summary, missing @13 TS stays missing', () => {
  const base = { summary: { total_gross_liters: 500, total_at_13ts_liters: 480 }, collections: [], area_received_liters: 490, area_received_at_13ts_liters: 470, mot_arrival: null };
  assert.deepEqual(journeyTripFigures(base), { shopGross: 500, shop13ts: 480, receivedGross: 490, received13ts: 470 });
  const noSummary = { ...base, summary: null, area_received_at_13ts_liters: null, collections: [
    { gross_liters: 200, at_13ts_liters: 190, final_decision: 'ACCEPTED' },
    { gross_liters: 50, at_13ts_liters: 40, final_decision: 'REJECTED' },
  ] };
  const f = journeyTripFigures(noSummary);
  assert.equal(f.shopGross, 200);
  assert.equal(f.received13ts, null);
});
