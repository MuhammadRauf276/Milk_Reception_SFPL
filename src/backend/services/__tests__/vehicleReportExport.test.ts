import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prisma } from '@/backend/core/db';
import {
  ReportInputError,
  buildReportWhere,
  getVehiclePortionReport,
  parseSourceFilter,
  type VehiclePortionReportDb,
} from '@/backend/services/management/vehiclePortionReport';
import { buildVisitWhere, getVehicleVisitReport } from '@/backend/services/management/vehicleVisitReport';
import { buildVehicleReportExcel, exportOncePerUser, parseExportOptions } from '@/backend/services/management/vehicleReportExport';

const db = prisma as unknown as VehiclePortionReportDb;

async function load(file: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  return wb;
}
const headersOf = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1).map(String);

test('the source choice and the file choices are read from the address; anything unknown is dropped', () => {
  assert.deepEqual(parseSourceFilter(new URLSearchParams('sourceType=zmcc&sourceIds=2,abc,7, 9')), { sourceType: 'ZMCC', sourceIds: ['2', '7', '9'] });
  assert.deepEqual(parseSourceFilter(new URLSearchParams('sourceType=DROP TABLE')), { sourceType: 'ALL', sourceIds: [] });
  const opts = parseExportOptions(new URLSearchParams('sheets=vehicles,tests,bogus&values=diff&groups=quality,nope&tests=4,x,9'));
  assert.deepEqual(opts, { sheets: ['vehicles', 'tests'], values: ['diff'], groups: ['quality'], testIds: ['4', '9'] });
  const defaults = parseExportOptions(new URLSearchParams(''));
  assert.deepEqual(defaults.sheets, ['summary', 'vehicles']);
  assert.equal(defaults.values.length, 3);
});

test('filters reach SQL only as parameters, and the vehicle report searches only its own columns', () => {
  const { where, args } = buildReportWhere({
    from: '2026-11-01',
    to: '2026-11-07',
    source: { sourceType: 'CONTRACTOR', sourceIds: ['3', '1; DROP TABLE x'] },
    filters: { vehicle: "LES'--" },
  });
  assert.equal(where, 'dispatched_at BETWEEN $1::timestamp AND $2::timestamp AND source_type = $3 AND source_id = ANY($4::bigint[]) AND vehicle_number ILIKE $5');
  assert.deepEqual(args.slice(2), ['CONTRACTOR', ['3'], "%LES'--%"]);
  const visit = buildVisitWhere({ from: '2026-11-01', to: '2026-11-07', filters: { vehicle: 'A', plantFat: '4', portion: 'P' } });
  assert.ok(visit.where.includes('vehicle_number') && !visit.where.includes('plant_fat') && !visit.where.includes('portion_label'));
  assert.throws(() => buildReportWhere({ from: '2026-01-01', to: '2026-11-07' }), ReportInputError);
});

test('the Excel file matches the screen: one Vehicles row per vehicle, one Portions row per portion, tests as rows', async () => {
  const last = (await prisma.$queryRawUnsafe(
    `SELECT to_char(max(dispatched_at) + interval '5 hours', 'YYYY-MM-DD') AS day FROM vw_vehicle_visit_report`
  )) as Array<{ day: string | null }>;
  const to = last[0]?.day;
  if (!to) return; // an empty database has nothing to compare
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);

  for (const sourceType of ['ALL', 'ZMCC', 'CONTRACTOR'] as const) {
    const vehicles = await getVehicleVisitReport({ from, to, source: { sourceType } }, db);
    if (vehicles.totalRows === 0) {
      await assert.rejects(buildVehicleReportExcel({ from, to, source: { sourceType } }, db), ReportInputError);
      continue;
    }
    const portions = await getVehiclePortionReport({ from, to, source: { sourceType } }, db);
    const wb = await load(
      await buildVehicleReportExcel({ from, to, source: { sourceType }, sheets: ['summary', 'vehicles', 'portions', 'tests'] }, db)
    );
    const v = wb.getWorksheet('Vehicles');
    const p = wb.getWorksheet('Portions');
    const t = wb.getWorksheet('Lab tests');
    assert.ok(v && p && t && wb.getWorksheet('Summary'), 'all four sheets');
    assert.equal(v.rowCount - 1, vehicles.totalRows, `${sourceType}: one Vehicles row per vehicle on screen`);
    assert.equal(p.rowCount - 1, portions.totalRows, `${sourceType}: one Portions row per portion`);
    for (const h of ['Fat Dispatch', 'Fat Plant', 'Fat Diff', '@13 TS L Diff', 'Gate Out']) assert.ok(headersOf(v).includes(h), `Vehicles column ${h}`);
    assert.deepEqual(headersOf(t).slice(5), ['Test', 'Unit', 'Dispatch', 'Dispatch Result', 'Plant', 'Plant Result', 'Difference']);
    if (sourceType !== 'ALL') {
      const col = headersOf(v).indexOf('Source Type') + 1;
      for (let r = 2; r <= v.rowCount; r++) assert.equal(v.getRow(r).getCell(col).value, sourceType);
    }
  }
});

test('only the chosen values, columns and tests go in the file', async () => {
  const last = (await prisma.$queryRawUnsafe(
    `SELECT to_char(max(dispatched_at) + interval '5 hours', 'YYYY-MM-DD') AS day FROM vw_vehicle_visit_report`
  )) as Array<{ day: string | null }>;
  const to = last[0]?.day;
  if (!to) return;
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);

  const wb = await load(await buildVehicleReportExcel({ from, to, sheets: ['vehicles'], values: ['diff'], groups: ['quality'] }, db));
  const headers = headersOf(wb.getWorksheet('Vehicles')!);
  assert.ok(headers.includes('Fat Diff') && !headers.includes('Fat Dispatch') && !headers.includes('Fat Plant'), 'difference only');
  assert.ok(!headers.includes('Gate Out') && !headers.includes('Driver'), 'only the chosen groups');
  assert.equal(wb.getWorksheet('Summary'), undefined, 'no summary when not chosen');

  const fat = await prisma.labTest.findFirst({ where: { systemRole: 'FAT' } });
  if (fat) {
    const tests = await load(await buildVehicleReportExcel({ from, to, sheets: ['tests'], testIds: [fat.id.toString()] }, db));
    const sheet = tests.getWorksheet('Lab tests')!;
    const col = headersOf(sheet).indexOf('Test') + 1;
    for (let r = 2; r <= sheet.rowCount; r++) assert.equal(sheet.getRow(r).getCell(col).value, fat.testName);
  }
  await assert.rejects(buildVehicleReportExcel({ from, to, sheets: [] }, db), ReportInputError);
});

test('a second export by the same person is refused while the first is running', async () => {
  let release: () => void = () => undefined;
  const first = exportOncePerUser('u1', () => new Promise<string>((resolve) => (release = () => resolve('done'))));
  await assert.rejects(exportOncePerUser('u1', async () => 'second'), ReportInputError);
  assert.equal(await exportOncePerUser('u2', async () => 'other person'), 'other person');
  release();
  assert.equal(await first, 'done');
  assert.equal(await exportOncePerUser('u1', async () => 'again'), 'again');
});

test.after(async () => {
  await prisma.$disconnect();
});
