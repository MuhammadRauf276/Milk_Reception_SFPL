import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHcVisuals } from '../visuals/hcVisuals';
import type { HcSupplierRow } from '@/backend/modules/management-reporting/visuals/hcContracts';

const sup = (id: string, arrivals: number, rejected: number, at13: number): HcSupplierRow => ({
  id,
  name: `S${id}`,
  code: null,
  zmccName: 'Z',
  arrivals,
  accepted: arrivals - rejected,
  rejected,
  leftEarly: 0,
  received: { liters: at13, at13ts: at13 },
  daysSupplied: arrivals,
});

test('totals come from every supplier, top-5 share from the five biggest by received', () => {
  const list = [sup('1', 10, 1, 500), sup('2', 5, 0, 300), sup('3', 4, 2, 100), sup('4', 3, 0, 50), sup('5', 2, 0, 30), sup('6', 1, 0, 20)];
  const v = buildHcVisuals(list, [], [], []);
  assert.equal(v.totals.arrivals, 25);
  assert.equal(v.totals.rejected, 3);
  assert.equal(v.totals.activeSuppliers, 6);
  assert.equal(v.totals.received.at13ts, 1000);
  assert.equal(v.totals.top5Share, 98);
});

test('the list is capped and the rest is added up as Others, totals unchanged', () => {
  const list = [sup('1', 10, 1, 500), sup('2', 5, 0, 300), sup('3', 4, 2, 100)];
  const v = buildHcVisuals(list, [], [], [], 2);
  assert.equal(v.suppliers.length, 3);
  const others = v.suppliers.find((s) => s.id === '__others')!;
  assert.equal(others.arrivals, 4);
  assert.equal(others.rejected, 2);
  assert.equal(v.totals.arrivals, 19);
});

test('no suppliers gives no share', () => {
  assert.equal(buildHcVisuals([], [], [], []).totals.top5Share, null);
});
