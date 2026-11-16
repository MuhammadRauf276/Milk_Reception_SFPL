import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@core/db';
import type { User } from '@core/types';
import { executeDynamicReportQuery, ReportRequestError } from '../dynamicReportEngine';
import type { DynamicQueryRequest } from '@/frontend/modules/dashboard/reports/dynamicReportTypes';

// Read-only: these tests only SELECT from the local database.
const executive = { id: '1', role: 'EXECUTIVE_MANAGEMENT' } as unknown as User;

const FROM = '2020-01-01';
const TO = '2030-12-31';
const wideRange = [{ id: 'r', fieldId: 'dispatch_date', operator: 'BETWEEN' as const, value: '2026-01-01', valueSecondary: '2026-12-31' }];

const base = (over: Partial<DynamicQueryRequest> = {}): DynamicQueryRequest => ({
  domain: 'VEHICLE_DISPATCH',
  selectedFieldIds: ['dispatch_date', 'vehicle_number', 'dispatch_gross_liters', 'received_gross_liters', 'gross_variance_liters', 'plant_fat', 'dispatch_fat', 'fat_diff'],
  filters: wideRange,
  page: 1,
  pageSize: 500,
  ...over,
});

after(async () => {
  await prisma.$disconnect();
});

test('vehicle dispatch rows match a direct SELECT on the view for the same range', async () => {
  const res = await executeDynamicReportQuery(base(), executive);
  const direct = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n, SUM(dispatch_gross_liters)::float8 AS disp, SUM(received_gross_liters)::float8 AS rec
     FROM vw_vehicle_visit_report
     WHERE dispatched_at >= ('2026-01-01T00:00:00+05:00'::timestamptz AT TIME ZONE 'UTC')
       AND dispatched_at < ('2027-01-01T00:00:00+05:00'::timestamptz AT TIME ZONE 'UTC')`
  )) as { n: number; disp: number | null; rec: number | null }[];
  assert.equal(res.totalRecords, direct[0].n);
  assert.equal(res.rows.length, direct[0].n);
  const sum = (key: string) => res.rows.reduce((a, r) => a + (r[key] ?? 0), 0);
  assert.ok(Math.abs(sum('dispatch_gross_liters') - (direct[0].disp ?? 0)) < 0.01);
  assert.ok(Math.abs(sum('received_gross_liters') - (direct[0].rec ?? 0)) < 0.01);
  assert.ok(Math.abs((res.columnTotals?.dispatch_gross_liters ?? 0) - (direct[0].disp ?? 0)) < 0.01);
  // plant minus dispatch, only where both exist
  for (const r of res.rows) {
    if (r.plant_fat != null && r.dispatch_fat != null) assert.ok(Math.abs(r.fat_diff - (r.plant_fat - r.dispatch_fat)) < 1e-6);
    else assert.equal(r.fat_diff, null);
  }
});

test('whole-result group totals equal the sum over all rows, not one page', async () => {
  const all = await executeDynamicReportQuery(base(), executive);
  const paged = await executeDynamicReportQuery(base({ pageSize: 2, groupByFieldId: 'source_name' }), executive);
  assert.ok(paged.rows.length <= 2);
  const groups = paged.groupedSubtotals ?? [];
  assert.equal(groups.reduce((a, g) => a + g.recordCount, 0), all.totalRecords);
  const groupSum = groups.reduce((a, g) => a + (g.aggregations.dispatch_gross_liters ?? 0), 0);
  const rowSum = all.rows.reduce((a, r) => a + (r.dispatch_gross_liters ?? 0), 0);
  assert.ok(Math.abs(groupSum - rowSum) < 0.05);
});

test('a month time bucket gives one group per month present', async () => {
  const all = await executeDynamicReportQuery(base(), executive);
  const months = new Set(all.rows.map((r) => String(r.dispatch_date).slice(0, 7)));
  const res = await executeDynamicReportQuery(base({ groupByFieldId: 'dispatched_at', timeBucket: 'MONTH' }), executive);
  const keys = (res.groupedSubtotals ?? []).map((g) => g.groupKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys].sort(), [...months].sort());
});

test('pivot totals equal the grand total', async () => {
  const res = await executeDynamicReportQuery(
    base({ pageSize: 1, pivot: { rowFieldId: 'source_name', colFieldId: 'dispatched_at', colBucket: 'MONTH', metricFieldId: 'dispatch_gross_liters', aggregation: 'SUM' } }),
    executive
  );
  const p = res.pivot!;
  const grand = p.grandTotal ?? 0;
  const rowSum = p.rowKeys.reduce((a, k) => a + (p.rowTotals[k] ?? 0), 0);
  const colSum = p.colKeys.reduce((a, k) => a + (p.colTotals[k] ?? 0), 0);
  const cellSum = p.rowKeys.reduce((a, r) => a + p.colKeys.reduce((b, c) => b + (p.cells[r][c] ?? 0), 0), 0);
  assert.ok(Math.abs(rowSum - grand) < 0.05);
  assert.ok(Math.abs(colSum - grand) < 0.05);
  assert.ok(Math.abs(cellSum - grand) < 0.05);

  const count = await executeDynamicReportQuery(
    base({ pageSize: 1, pivot: { rowFieldId: 'source_name', colFieldId: 'decision', aggregation: 'COUNT' } }),
    executive
  );
  assert.equal(count.pivot!.grandTotal, count.totalRecords);
});

test('whole-result pivot works for a Prisma domain too', async () => {
  const res = await executeDynamicReportQuery(
    {
      domain: 'MOT_COLLECTIONS',
      selectedFieldIds: ['gross_liters'],
      filters: [],
      page: 1,
      pageSize: 5,
      pivot: { rowFieldId: 'route_name', colFieldId: 'final_decision', metricFieldId: 'gross_liters', aggregation: 'SUM' },
    },
    executive
  );
  const p = res.pivot!;
  const rowSum = p.rowKeys.reduce((a, k) => a + (p.rowTotals[k] ?? 0), 0);
  assert.ok(Math.abs(rowSum - (p.grandTotal ?? 0)) < 0.05);
});

test('fields outside the allow-list are rejected', async () => {
  await assert.rejects(
    executeDynamicReportQuery(base({ filters: [...wideRange, { id: 'x', fieldId: 'visit_id; DROP TABLE x', operator: 'EQUALS', value: '1' }] }), executive),
    ReportRequestError
  );
  await assert.rejects(executeDynamicReportQuery(base({ groupByFieldId: 'nope' }), executive), ReportRequestError);
  await assert.rejects(
    executeDynamicReportQuery(base({ pivot: { rowFieldId: 'source_name', colFieldId: 'x"; --', metricFieldId: 'portions', aggregation: 'SUM' } }), executive),
    ReportRequestError
  );
});

test('date range is required, defaults to 30 days and is capped at 366 days', async () => {
  const def = await executeDynamicReportQuery(base({ filters: [] }), executive);
  assert.equal(def.dateRange?.defaulted, true);
  await assert.rejects(
    executeDynamicReportQuery(base({ filters: [{ id: 'r', fieldId: 'dispatch_date', operator: 'BETWEEN', value: FROM, valueSecondary: TO }] }), executive),
    (e: unknown) => e instanceof ReportRequestError && /366/.test(e.message)
  );
});
