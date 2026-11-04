import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_MAX_RANGE_DAYS,
  ReportInputError,
  buildColumnSearch,
  dateRangeProblem,
  getVehiclePortionReport,
  parseColumnFilters,
  rangeDays,
  type ReportColumnFilters,
  type VehiclePortionReportDb,
} from '../management/vehiclePortionReport';

function fakeDb(total: number) {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const statements: string[] = [];
  const db: VehiclePortionReportDb = {
    $transaction: (fn) =>
      fn({
        $executeRawUnsafe: async (sql) => void statements.push(sql),
        $queryRawUnsafe: async (sql, ...args) => {
          queries.push({ sql, args });
          return sql.includes('COUNT(*)') ? [{ total: BigInt(total) }] : [];
        },
      }),
  };
  return { db, queries, statements };
}

test('a range counts both end days', () => {
  assert.equal(rangeDays('2026-11-04', '2026-11-04'), 1);
  assert.equal(rangeDays('2026-10-29', '2026-11-04'), 7);
});

test('the date range is required, ordered and capped', () => {
  assert.ok(dateRangeProblem(null, '2026-11-04'));
  assert.ok(dateRangeProblem('2026-11-04', undefined));
  assert.ok(dateRangeProblem('bad', '2026-11-04'));
  assert.ok(dateRangeProblem('2026-11-05', '2026-11-04'));
  assert.equal(dateRangeProblem('2026-08-05', '2026-11-04'), null);
  assert.equal(rangeDays('2026-08-05', '2026-11-04'), REPORT_MAX_RANGE_DAYS);
  assert.ok(dateRangeProblem('2026-08-04', '2026-11-04'));
});

test('a refused range never reaches the database', async () => {
  const { db, queries } = fakeDb(0);
  await assert.rejects(getVehiclePortionReport({ from: '2020-01-01', to: '2026-11-04' }, db), ReportInputError);
  assert.equal(queries.length, 0);
});

test('column searches are parameters, and values never reach the SQL text', () => {
  const { sql, args } = buildColumnSearch({ vehicle: "x'; DROP TABLE y;--", stage: 'Unload' }, 3);
  assert.ok(!sql.includes('DROP'));
  assert.equal(sql, ' AND vehicle_number ILIKE $3 AND stage ILIKE $4');
  assert.deepEqual(args, ["%x'; DROP TABLE y;--%", '%Unload%']);
});

test('an unknown column is dropped, so a column name cannot be injected', () => {
  const filters = { 'vehicle_number; DROP': 'x' } as unknown as ReportColumnFilters;
  assert.deepEqual(buildColumnSearch(filters, 3), { sql: '', args: [] });
});

test('numeric columns search as text and ignore thousands separators', () => {
  assert.deepEqual(buildColumnSearch({ quantity: '12,534' }, 3), {
    sql: ' AND dispatch_quantity_value::text ILIKE $3',
    args: ['%12534%'],
  });
});

test('wildcards typed by the user are taken literally', () => {
  assert.deepEqual(buildColumnSearch({ token: '50%_a' }, 3).args, ['%50\\%\\_a%']);
});

test('empty searches are ignored', () => {
  assert.deepEqual(buildColumnSearch({ vehicle: '   ', token: '' }, 3), { sql: '', args: [] });
});

test('every column can be read from the request', () => {
  const filters = parseColumnFilters(new URLSearchParams('f_vehicle=LES&f_plantFat=3.8&f_unknown=x&page=2'));
  assert.deepEqual(filters, { vehicle: 'LES', plantFat: '3.8' });
});

test('the query has a time limit and dates become plant-day UTC bounds', async () => {
  const { db, queries, statements } = fakeDb(0);
  await getVehiclePortionReport({ from: '2026-11-04', to: '2026-11-04' }, db);
  assert.match(statements[0], /SET LOCAL statement_timeout/);
  assert.deepEqual(queries[0].args, ['2026-11-03T19:00:00.000Z', '2026-11-04T18:59:59.999Z']);
});

test('a page past the end falls back to the last page', async () => {
  const { db, queries } = fakeDb(120);
  const report = await getVehiclePortionReport({ from: '2026-11-01', to: '2026-11-04', page: 99 }, db);
  assert.equal(report.page, 3);
  assert.equal(report.totalPages, 3);
  assert.match(queries[1].sql, /LIMIT 50 OFFSET 100/);
});
