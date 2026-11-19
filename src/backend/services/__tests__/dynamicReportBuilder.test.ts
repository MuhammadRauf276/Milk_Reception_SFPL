import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@core/db';
import type { User } from '@core/types';
import {
  executeDynamicReportQuery,
  ReportRequestError,
  DOMAIN_FIELD_MAP,
  JOURNEY_RECONCILIATION_FIELDS,
  computeColumnTotals,
  computeGroupedSubtotals,
  generateDynamicCsvReport,
} from '../dynamicReportEngine';
import type { DynamicQueryRequest, ReportDomain, ReportRow, SavedReportTemplate } from '@/frontend/modules/dashboard/reports/dynamicReportTypes';
import {
  buildDateClause,
  checkDateRange,
  daysInRange,
  detectDatePreset,
  dateSettingsForTemplate,
  filtersForTemplate,
  formatLossGainText,
  normalizeSavedTemplate,
  pickDateFieldId,
  readDateRange,
  resolveDatePreset,
  withDateRange,
} from '@/frontend/modules/dashboard/reports/dynamicReportTypes';

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
     WHERE dispatched_at >= '2026-01-01T00:00:00+05:00'::timestamptz
       AND dispatched_at < '2027-01-01T00:00:00+05:00'::timestamptz`
  )) as { n: number; disp: number | null; rec: number | null }[];
  assert.equal(res.totalRecords, direct[0].n);
  assert.equal(res.rows.length, direct[0].n);
  const sum = (key: string) => res.rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);
  assert.ok(Math.abs(sum('dispatch_gross_liters') - (direct[0].disp ?? 0)) < 0.01);
  assert.ok(Math.abs(sum('received_gross_liters') - (direct[0].rec ?? 0)) < 0.01);
  assert.ok(Math.abs((res.columnTotals?.dispatch_gross_liters ?? 0) - (direct[0].disp ?? 0)) < 0.01);
  // plant minus dispatch, only where both exist
  for (const r of res.rows) {
    if (r.plant_fat != null && r.dispatch_fat != null) assert.ok(Math.abs(Number(r.fat_diff) - (Number(r.plant_fat) - Number(r.dispatch_fat))) < 1e-6);
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
  const rowSum = all.rows.reduce((a, r) => a + Number(r.dispatch_gross_liters ?? 0), 0);
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

// ---------------------------------------------------------------------------
// Custom date range
// ---------------------------------------------------------------------------

test('a custom range builds the same filter as a preset and reads back', () => {
  const today = '2026-11-16';
  const last7 = resolveDatePreset('LAST_7', today);
  assert.deepEqual(last7, { from: '2026-11-10', to: '2026-11-16' });
  assert.equal(daysInRange(last7.from, last7.to), 7);
  assert.equal(detectDatePreset(last7, today), 'LAST_7');
  assert.equal(detectDatePreset({ from: '2026-11-01', to: '2026-11-09' }, today), null);

  const clause = buildDateClause('dispatch_date', { from: '2026-11-01', to: '2026-11-09' });
  assert.equal(clause.operator, 'BETWEEN');
  assert.deepEqual(readDateRange([clause], 'dispatch_date'), { from: '2026-11-01', to: '2026-11-09' });
  // one day is an EQUALS filter, and a new range replaces the old one
  const one = withDateRange([clause, { id: 'x', fieldId: 'vehicle_number', operator: 'CONTAINS', value: 'A' }], 'dispatch_date', { from: '2026-11-05', to: '2026-11-05' });
  assert.equal(one.length, 2);
  assert.equal(one.find((f) => f.fieldId === 'dispatch_date')?.operator, 'EQUALS');
});

test('a custom range drives the date field of every report type', async () => {
  const range = { from: '2026-01-01', to: '2026-03-31' };
  let checked = 0;
  for (const domain of Object.keys(DOMAIN_FIELD_MAP) as ReportDomain[]) {
    const dateFieldId = pickDateFieldId(DOMAIN_FIELD_MAP[domain]);
    if (domain === 'TANK_STORAGE') {
      assert.equal(dateFieldId, undefined);
      continue;
    }
    assert.ok(dateFieldId, `${domain} has a date field`);
    const res = await executeDynamicReportQuery(
      { domain, selectedFieldIds: [dateFieldId], filters: [buildDateClause(dateFieldId, range)], page: 1, pageSize: 100 },
      executive
    );
    for (const r of res.rows) {
      const day = String(r[dateFieldId]).slice(0, 10);
      assert.ok(day >= range.from && day <= range.to, `${domain}: ${day} inside the range`);
    }
    if (domain === 'VEHICLE_DISPATCH') assert.deepEqual(res.dateRange, { ...range, defaulted: false });
    checked++;
  }
  assert.equal(checked, 6);
});

test('a custom range over 366 days is refused with a clear message', async () => {
  assert.match(checkDateRange('2025-01-01', '2026-12-31') ?? '', /366/);
  assert.match(checkDateRange('2026-02-01', '2026-01-01') ?? '', /after/);
  assert.equal(checkDateRange('2026-01-01', '2026-12-31'), null);
  // 366 days exactly is allowed, 367 is not
  assert.equal(checkDateRange('2026-01-01', '2027-01-01'), null);
  assert.notEqual(checkDateRange('2026-01-01', '2027-01-02'), null);
  await assert.rejects(
    executeDynamicReportQuery(base({ filters: [buildDateClause('dispatch_date', { from: '2024-01-01', to: '2026-01-01' })] }), executive),
    (e: unknown) => e instanceof ReportRequestError && /366/.test(e.message)
  );
});

// ---------------------------------------------------------------------------
// Saved templates
// ---------------------------------------------------------------------------

test('a saved template round-trips bucket, pivot, date range, sort and grouping', () => {
  const today = '2026-11-16';
  const filters = withDateRange([{ id: 'a', fieldId: 'source_name', operator: 'CONTAINS', value: 'ZMCC' }], 'dispatch_date', { from: '2026-09-01', to: '2026-10-15' });
  const dates = dateSettingsForTemplate(filters, 'dispatch_date', today);
  assert.equal(dates.datePreset, undefined);
  assert.deepEqual([dates.dateFrom, dates.dateTo], ['2026-09-01', '2026-10-15']);
  assert.equal(dates.filters.length, 1, 'the date filter is stored as dates, not as a filter');

  const template: SavedReportTemplate = {
    id: 'custom-1',
    name: 'Monthly',
    description: '',
    domain: 'VEHICLE_DISPATCH',
    selectedFieldIds: ['dispatch_date', 'gross_variance_liters'],
    filters: dates.filters,
    groupByFieldId: 'dispatched_at',
    timeBucket: 'WEEK',
    sortFieldId: 'gross_variance_liters',
    sortDirection: 'asc',
    pivot: { rowFieldId: 'source_name', colFieldId: 'dispatched_at', colBucket: 'MONTH', metricFieldId: 'gross_variance_liters', aggregation: 'SUM' },
    dateFrom: dates.dateFrom,
    dateTo: dates.dateTo,
  };
  const back = normalizeSavedTemplate(JSON.parse(JSON.stringify(template)));
  assert.ok(back);
  assert.equal(back.timeBucket, 'WEEK');
  assert.deepEqual(back.pivot, template.pivot);
  assert.equal(back.sortFieldId, 'gross_variance_liters');
  assert.equal(back.sortDirection, 'asc');
  assert.equal(back.groupByFieldId, 'dispatched_at');
  assert.deepEqual(readDateRange(filtersForTemplate(back, 'dispatch_date', today), 'dispatch_date'), { from: '2026-09-01', to: '2026-10-15' });
  assert.equal(filtersForTemplate(back, 'dispatch_date', today).some((f) => f.fieldId === 'source_name'), true);

  // a quick range is saved by name and counts back from the day the template is opened
  const preset = dateSettingsForTemplate(withDateRange([], 'dispatch_date', resolveDatePreset('LAST_7', today)), 'dispatch_date', today);
  assert.equal(preset.datePreset, 'LAST_7');
  const opened = normalizeSavedTemplate({ ...template, datePreset: preset.datePreset, dateFrom: undefined, dateTo: undefined });
  assert.ok(opened);
  assert.deepEqual(readDateRange(filtersForTemplate(opened, 'dispatch_date', '2026-12-20'), 'dispatch_date'), { from: '2026-12-14', to: '2026-12-20' });
});

test('an old saved template still loads: missing keys use defaults and old loss ids become Loss / Gain ids', () => {
  const old = normalizeSavedTemplate({
    id: 'old',
    name: 'Old',
    domain: 'PLANT_TRANSIT',
    selectedFieldIds: ['dispatch_note_number', 'transit_loss_liters', 'transit_loss_pct'],
    filters: [{ id: 'f', fieldId: 'dispatch_date', operator: 'BETWEEN', value: '2026-01-01', valueSecondary: '2026-01-31' }],
    sortFieldId: 'transit_loss_liters',
  });
  assert.ok(old);
  assert.deepEqual(old.selectedFieldIds, ['dispatch_note_number', 'transit_diff_liters', 'transit_diff_pct']);
  assert.equal(old.sortFieldId, 'transit_diff_liters');
  assert.equal(old.timeBucket, undefined);
  assert.equal(old.pivot, undefined);
  assert.equal(old.datePreset, undefined);
  // its own date filter is kept as it was saved
  assert.deepEqual(readDateRange(filtersForTemplate(old, 'dispatch_date', '2026-11-16'), 'dispatch_date'), { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(normalizeSavedTemplate({ nonsense: true }), null);
  for (const f of ['transit_diff_liters', 'transit_diff_pct']) assert.ok(DOMAIN_FIELD_MAP.PLANT_TRANSIT.some((d) => d.id === f));
});

test('the engine accepts old loss field ids', async () => {
  const res = await executeDynamicReportQuery(
    {
      domain: 'PLANT_TRANSIT',
      selectedFieldIds: ['dispatch_note_number', 'transit_loss_liters'],
      filters: [],
      sortFieldId: 'transit_loss_liters',
      sortDirection: 'asc',
      page: 1,
      pageSize: 50,
    },
    executive
  );
  assert.deepEqual(res.fields.map((f) => f.id), ['dispatch_note_number', 'transit_diff_liters']);
});

// ---------------------------------------------------------------------------
// Loss and gain: signed difference = received minus sent
// ---------------------------------------------------------------------------

const journeyRow = (shop: number, gate: number | null, route: string): ReportRow => {
  const diff = gate === null ? null : Number((gate - shop).toFixed(2));
  return {
    shop_liters: shop,
    gate_liters: gate,
    route_diff_liters: diff,
    route_diff_pct: diff !== null && shop > 0 ? (diff / shop) * 100 : null,
    route_loss_only_liters: diff !== null && diff < 0 ? -diff : null,
    route_gain_only_liters: diff !== null && diff > 0 ? diff : null,
    route,
  };
};

test('net loss / gain of a group is the sum of signed differences: a gain row reduces the loss', () => {
  const rows = [journeyRow(1000, 900, 'A'), journeyRow(500, 450, 'A'), journeyRow(300, 330, 'B'), journeyRow(200, null, 'B')];
  const fields = JOURNEY_RECONCILIATION_FIELDS.filter((f) => f.lossGain || f.id === 'shop_liters');
  const totals = computeColumnTotals(rows, fields);
  // -100 + -50 + 30 = -120, not the -150 that clamping each row at zero would give
  assert.equal(totals.route_diff_liters, -120);
  assert.equal(totals.route_loss_only_liters, 150);
  assert.equal(totals.route_gain_only_liters, 30);
  assert.equal(totals.route_gain_only_liters - totals.route_loss_only_liters, totals.route_diff_liters);
  // percent = net difference / litres sent x 100, over the rows that have a difference
  assert.ok(Math.abs((totals.route_diff_pct ?? 0) - (-120 / 1800) * 100) < 0.01);

  const group = computeGroupedSubtotals(rows, { id: 'route', label: 'Route', category: 'OPERATIONAL', dataType: 'string' }, undefined, fields);
  assert.equal(group.find((g) => g.groupKey === 'A')?.aggregations.route_diff_liters, -150);
  assert.equal(group.find((g) => g.groupKey === 'B')?.aggregations.route_diff_liters, 30);
  assert.equal(group.reduce((sum, g) => sum + (g.aggregations.route_diff_liters ?? 0), 0), totals.route_diff_liters);
});

test('loss and gain text: loss, gain and even', () => {
  assert.equal(formatLossGainText(-120, 'L'), 'Loss 120 L');
  assert.equal(formatLossGainText(35, 'L'), 'Gain 35 L');
  assert.equal(formatLossGainText(0, 'L'), 'Even');
  assert.equal(formatLossGainText(0.004, 'L'), 'Even');
  assert.equal(formatLossGainText(-0.52, '%'), 'Loss 0.52%');
  assert.equal(formatLossGainText(120, 'L', 'loss_only'), 'Loss 120 L');
});

test('no loss field is clamped at zero', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/backend/services/dynamicReportEngine.ts'), 'utf8');
  assert.equal(/GREATEST\(\s*0/i.test(source), false, 'no GREATEST(0, ...) in the engine');
  assert.equal(/Math\.max\(\s*0\s*,\s*-/.test(source), false, 'no Math.max(0, -x) in the engine');
});

for (const [domain, diffId, lossId, gainId] of [
  ['VEHICLE_DISPATCH', 'gross_variance_liters', 'gross_loss_only_liters', 'gross_gain_only_liters'],
  ['PLANT_TRANSIT', 'transit_diff_liters', 'transit_loss_only_liters', 'transit_gain_only_liters'],
] as const) {
  test(`${domain}: net total equals the sum of signed rows, and gross gain minus gross loss equals the net`, async () => {
    const res = await executeDynamicReportQuery(
      {
        domain,
        selectedFieldIds: ['dispatch_date', diffId, lossId, gainId],
        filters: wideRange,
        page: 1,
        pageSize: 500,
      },
      executive
    );
    const signed = res.rows.reduce((a, r) => a + Number(r[diffId] ?? 0), 0);
    const loss = res.rows.reduce((a, r) => a + Number(r[lossId] ?? 0), 0);
    const gain = res.rows.reduce((a, r) => a + Number(r[gainId] ?? 0), 0);
    assert.ok(Math.abs((res.columnTotals?.[diffId] ?? 0) - signed) < 0.01);
    assert.ok(Math.abs(gain - loss - signed) < 0.01);
    for (const r of res.rows) {
      const v = r[diffId];
      if (v === null) continue;
      // a gain is kept as a positive number, never turned into zero
      assert.equal(Number(r[gainId] ?? 0) - Number(r[lossId] ?? 0), Number(v));
    }
    const kpi = res.summaryKpis.find((k) => k.id === 'kpi-loss-gain');
    if (res.rows.length > 0 && kpi) assert.ok(Math.abs(Number(kpi.value) - signed) < 0.01);
  });
}

for (const domain of ['MOT_COLLECTIONS', 'HC_SUPPLIERS', 'JOURNEY_RECONCILIATION', 'PLANT_TRANSIT', 'QUALITY_SCREENING', 'VEHICLE_DISPATCH'] as const) {
  test(`${domain}: a range over 366 days is refused (rows, group and pivot) and no date means the last 30 days`, async () => {
    const dateId = pickDateFieldId(DOMAIN_FIELD_MAP[domain]);
    assert.ok(dateId);
    const filters = [buildDateClause(dateId, { from: '2024-01-01', to: '2026-01-01' })];
    const fields = DOMAIN_FIELD_MAP[domain];
    const text = fields.find((f) => f.dataType === 'string')!.id;
    const common = { domain, selectedFieldIds: [dateId], filters, page: 1, pageSize: 5 };
    const tooLong = (e: unknown) => e instanceof ReportRequestError && /366/.test(e.message);
    await assert.rejects(executeDynamicReportQuery(common, executive), tooLong);
    await assert.rejects(executeDynamicReportQuery({ ...common, groupByFieldId: text }, executive), tooLong);
    await assert.rejects(executeDynamicReportQuery({ ...common, pivot: { rowFieldId: text, colFieldId: dateId, aggregation: 'COUNT' } }, executive), tooLong);
    await assert.rejects(generateDynamicCsvReport({ ...common, exportFormat: 'CSV' }, executive), tooLong);
    const open = await executeDynamicReportQuery({ ...common, filters: [] }, executive);
    assert.ok(open.dateRange?.defaulted ?? true);
    for (const r of open.rows) assert.ok(String(r[dateId]).slice(0, 10) >= '2026-10-01');
  });
}
