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
import { buildVehicleReportExcel, exportOncePerUser, parseExportGroups } from '@/backend/services/management/vehicleReportExport';

const db = prisma as unknown as VehiclePortionReportDb;

test('the source choice is read from the address and anything unknown is dropped', () => {
  assert.deepEqual(parseSourceFilter(new URLSearchParams('sourceType=zmcc&sourceIds=2,abc,7, 9')), {
    sourceType: 'ZMCC',
    sourceIds: ['2', '7', '9'],
  });
  assert.deepEqual(parseSourceFilter(new URLSearchParams('sourceType=DROP TABLE')), { sourceType: 'ALL', sourceIds: [] });
  assert.deepEqual(parseExportGroups(new URLSearchParams('groups=quality,nonsense')), ['quality']);
  assert.equal(parseExportGroups(new URLSearchParams('')).length, 7);
});

test('the source choice and searches reach SQL only as parameters', () => {
  const { where, args } = buildReportWhere({
    from: '2026-11-01',
    to: '2026-11-07',
    source: { sourceType: 'CONTRACTOR', sourceIds: ['3', "1; DROP TABLE x"] },
    filters: { vehicle: "LES'--" },
  });
  assert.equal(where, 'dispatched_at BETWEEN $1::timestamp AND $2::timestamp AND source_type = $3 AND source_id = ANY($4::bigint[]) AND vehicle_number ILIKE $5');
  assert.deepEqual(args.slice(2), ['CONTRACTOR', ['3'], "%LES'--%"]);
  assert.throws(() => buildReportWhere({ from: '2026-01-01', to: '2026-11-07' }), ReportInputError);
});

test('the Excel file holds the same portions as the screen, for the same source choice', async () => {
  const last = (await prisma.$queryRawUnsafe(
    `SELECT to_char(max(dispatched_at) + interval '5 hours', 'YYYY-MM-DD') AS day FROM vw_vehicle_export_report`
  )) as Array<{ day: string | null }>;
  const to = last[0]?.day;
  if (!to) return; // an empty database has nothing to compare
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);

  for (const sourceType of ['ALL', 'ZMCC', 'CONTRACTOR'] as const) {
    const screen = await getVehiclePortionReport({ from, to, source: { sourceType } }, db);
    if (screen.totalRows === 0) {
      await assert.rejects(buildVehicleReportExcel({ from, to, source: { sourceType } }, db), ReportInputError);
      continue;
    }
    const file = await buildVehicleReportExcel({ from, to, source: { sourceType } }, db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet('Vehicles');
    assert.ok(sheet, 'the Vehicles sheet is there');
    assert.equal(sheet.rowCount - 1, screen.totalRows, `${sourceType}: one row per portion on screen`);
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    for (const expected of ['Dispatched', 'Source Type', 'Fat Dispatch', 'Fat Plant', 'Fat Diff', 'Received @13 TS L', 'Gate In']) {
      assert.ok(headers.includes(expected), `column ${expected}`);
    }
    if (sourceType !== 'ALL') {
      const typeColumn = headers.indexOf('Source Type') + 1;
      for (let r = 2; r <= sheet.rowCount; r++) assert.equal(sheet.getRow(r).getCell(typeColumn).value, sourceType);
    }
    assert.ok(wb.getWorksheet('Summary'), 'the Summary sheet is there');
  }

  const narrow = await buildVehicleReportExcel({ from, to, groups: ['quality'] }, db);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(narrow as unknown as ArrayBuffer);
  const headers = (wb.getWorksheet('Vehicles')!.getRow(1).values as unknown[]).slice(1).map(String);
  assert.ok(headers.includes('TS Diff') && !headers.includes('Gate In') && !headers.includes('Driver'), 'only the chosen columns');
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
