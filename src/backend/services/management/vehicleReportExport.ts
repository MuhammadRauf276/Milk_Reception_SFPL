/**
 * The vehicle report as an Excel file. The person chooses:
 *  - the sheets: Summary (totals per source), Vehicles (one row per vehicle), Portions (one row per compartment)
 *    and Lab tests (one row per portion and test: dispatch, plant and difference side by side, so a new test adds
 *    rows, not columns);
 *  - which values of each comparison: Dispatch, Plant, Difference;
 *  - the column groups, and which lab tests.
 *
 * Kept light on the database: the same capped date range as the screen and a cap on rows, each sheet read one day at a
 * time (small queries on the dispatch date index, each with a time limit) and written as it is read (streaming, so
 * memory stays flat), one export at a time per person.
 */
import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import {
  REPORT_VIEW,
  ReportInputError,
  STATEMENT_TIMEOUT_MS,
  type ReportColumnFilters,
  type ReportSourceFilter,
  type VehiclePortionReportDb,
} from './vehiclePortionReport';
import { VISIT_REPORT_VIEW, buildVisitWhere } from './vehicleVisitReport';
import {
  ALL_VALUES,
  DEFAULT_GROUPS,
  DEFAULT_SHEETS,
  EXPORT_GROUPS,
  EXPORT_MAX_ROWS,
  EXPORT_MAX_TEST_ROWS,
  EXPORT_SHEETS,
  EXPORT_VALUES,
  type ExportGroupKey,
  type ExportSheetKey,
  type ExportValueKey,
} from './vehicleReportExportOptions';

type Raw = Record<string, unknown>;
type Tx = Parameters<Parameters<VehiclePortionReportDb['$transaction']>[0]>[0];
type CellKind = 'text' | 'number' | 'datetime' | 'yesno';

interface Column {
  header: string;
  kind: CellKind;
  width: number;
  decimals?: number;
  value: (r: Raw) => unknown;
}

export interface VehicleExportParams {
  from?: string | null;
  to?: string | null;
  filters?: ReportColumnFilters;
  source?: Partial<ReportSourceFilter>;
  sheets?: ExportSheetKey[];
  values?: ExportValueKey[];
  groups?: ExportGroupKey[];
  /** Lab tests for the Lab tests sheet. Empty or missing means all. */
  testIds?: string[];
}

function pick<T extends string>(params: URLSearchParams, name: string, known: readonly { key: T }[], fallback: T[]): T[] {
  if (!params.has(name)) return fallback;
  const keys = new Set<string>(known.map((k) => k.key));
  return (params.get(name) || '').split(',').map((v) => v.trim()).filter((v) => keys.has(v)) as T[];
}

/** Reads the file choices from the address. Anything unknown is dropped; a missing choice takes its default. */
export function parseExportOptions(params: URLSearchParams) {
  return {
    sheets: pick(params, 'sheets', EXPORT_SHEETS, DEFAULT_SHEETS),
    values: pick(params, 'values', EXPORT_VALUES, ALL_VALUES),
    groups: pick(params, 'groups', EXPORT_GROUPS, DEFAULT_GROUPS),
    testIds: (params.get('tests') || '').split(',').map((v) => v.trim()).filter((v) => /^\d{1,18}$/.test(v)).slice(0, 200),
  };
}

// ------------------------------------------------------------------------------------------------ cell helpers
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const PKT_OFFSET_MS = 5 * 3600_000;
/** Excel has no time zones: the plant's clock time is written as the cell value. */
const plantClock = (v: unknown): Date | null =>
  v instanceof Date && !Number.isNaN(v.getTime()) ? new Date(v.getTime() + PKT_OFFSET_MS) : null;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const minus = (a: unknown, b: unknown) => {
  const x = toNumber(a);
  const y = toNumber(b);
  return x == null || y == null ? null : round3(x - y);
};
const numFmt = (decimals: number) => (decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0');

const text = (header: string, sql: string, width = 16): Column => ({ header, kind: 'text', width, value: (r) => r[sql] });
const number = (header: string, sql: string, decimals = 2, width = 14): Column => ({ header, kind: 'number', width, decimals, value: (r) => r[sql] });
const time = (header: string, sql: string): Column => ({ header, kind: 'datetime', width: 19, value: (r) => r[sql] });
const yesno = (header: string, sql: string): Column => ({ header, kind: 'yesno', width: 12, value: (r) => r[sql] });

/** Dispatch, plant and difference of one measure, as many of them as the person chose. */
function compare(label: string, dispatchSql: string, plantSql: string, values: Set<string>, decimals = 2, diffSql?: string): Column[] {
  const out: Column[] = [];
  if (values.has('dispatch')) out.push(number(`${label} Dispatch`, dispatchSql, decimals));
  if (values.has('plant')) out.push(number(`${label} Plant`, plantSql, decimals));
  if (values.has('diff')) {
    out.push({
      header: `${label} Diff`,
      kind: 'number',
      width: 12,
      decimals,
      value: diffSql ? (r) => r[diffSql] : (r) => minus(r[plantSql], r[dispatchSql]),
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ sheet columns
function vehicleColumns(groups: Set<string>, values: Set<string>): Column[] {
  const cols: Column[] = [
    time('Dispatched', 'dispatched_at'),
    text('Visit No', 'visit_number'),
    text('Vehicle', 'vehicle_number', 14),
    text('Token', 'token_number', 12),
    text('Source Type', 'source_type', 12),
    text('Source', 'source_name', 22),
    text('Stage', 'stage', 24),
    text('Decision', 'decision', 15),
    number('Portions', 'portions', 0, 10),
    number('Added at Plant', 'plant_added_portions', 0, 14),
  ];
  if (groups.has('papers')) {
    cols.push(
      text('Driver', 'driver_name', 18), text('Dispatch Note No', 'dispatch_note_number', 18), text('Reception No', 'reception_number'),
      text('Dispatch Decision', 'dispatch_person_decision', 18), text('System Outcome', 'dispatch_system_outcome', 16),
      text('Approval', 'approval_status', 12), yesno('Tanker Washed', 'tanker_washed')
    );
  }
  if (groups.has('quality')) {
    cols.push(
      ...compare('Fat', 'dispatch_fat', 'plant_fat', values),
      ...compare('LR', 'dispatch_lr', 'plant_lr', values),
      ...compare('SNF', 'dispatch_snf', 'plant_snf', values, 3),
      ...compare('TS', 'dispatch_ts', 'plant_ts', values, 3)
    );
  }
  if (groups.has('quantity')) {
    cols.push(
      number('Dispatch Qty', 'dispatch_quantity_value'), text('Unit', 'dispatch_quantity_unit', 8),
      ...compare('Gross L', 'dispatch_gross_liters', 'received_gross_liters', values, 2, 'gross_variance_liters'),
      ...(values.has('diff') ? [number('Gross Variance %', 'gross_variance_percent', 3, 16)] : []),
      ...compare('@13 TS L', 'dispatch_at_13ts_liters', 'received_at_13ts_liters', values, 2, 'at_13ts_variance_liters'),
      ...(values.has('diff') ? [number('@13 TS Variance %', 'at_13ts_variance_percent', 3, 17)] : [])
    );
  }
  if (groups.has('weights')) {
    cols.push(text('Weight Ticket', 'weight_ticket_number'), number('Gross kg', 'gross_weight_kg'), number('Tare kg', 'tare_weight_kg'), number('Net kg', 'net_weight_kg'));
  }
  if (groups.has('timings')) {
    cols.push(time('Gate In', 'gate_in_at'), time('First Weight At', 'first_weight_at'), time('Second Weight At', 'second_weight_at'), time('Gate Out', 'gate_out_at'), time('Final Receipt', 'reconciled_at'));
  }
  return cols;
}

function portionColumns(groups: Set<string>, values: Set<string>): Column[] {
  const cols: Column[] = [
    time('Dispatched', 'dispatched_at'),
    text('Vehicle', 'vehicle_number', 14),
    text('Token', 'token_number', 12),
    text('Source', 'source_name', 22),
    text('Portion', 'portion_label', 13),
    { header: 'From', kind: 'text', width: 10, value: (r) => (r.is_dispatch_portion === false ? 'Plant' : 'Dispatch') },
    text('Decision', 'decision', 12),
  ];
  if (groups.has('seals')) {
    cols.push(text('Seal (Dispatch)', 'seal_number'), text('Seal (Plant)', 'plant_seal_number'), yesno('Seal Match', 'seal_match'), text('Rejection Reason', 'plant_rejection_reason', 26), time('Plant Decided', 'plant_decided_at'));
  }
  if (groups.has('quantity')) cols.push(number('Portion Qty', 'dispatch_quantity_value'), text('Unit', 'dispatch_quantity_unit', 8));
  if (groups.has('quality')) {
    cols.push(
      ...compare('Fat', 'dispatch_fat', 'plant_fat', values),
      ...compare('LR', 'dispatch_lr', 'plant_lr', values),
      ...compare('SNF', 'dispatch_snf', 'plant_snf', values, 3),
      ...compare('TS', 'dispatch_ts', 'plant_ts', values, 3)
    );
  }
  if (groups.has('weights')) {
    cols.push(number('Weight Before kg', 'portion_weight_before_kg', 2, 16), number('Weight After kg', 'portion_weight_after_kg', 2, 16), number('Milk Off kg', 'portion_net_weight_kg'), time('Weighed At', 'portion_weighed_at'));
  }
  if (groups.has('timings')) cols.push(time('Unloading Start', 'unloading_started_at'), time('Unloading End', 'unloading_finished_at'), text('Silo', 'silo_number', 10));
  return cols;
}

function testColumns(values: Set<string>): Column[] {
  const result = (passed: string) => (r: Raw) => (r[passed] === true ? 'Pass' : r[passed] === false ? 'Fail' : null);
  const side = (num: string, txt: string) => (r: Raw) => toNumber(r[num]) ?? (r[txt] as string | null) ?? null;
  const cols: Column[] = [
    time('Dispatched', 'dispatched_at'),
    text('Vehicle', 'vehicle_number', 14),
    text('Token', 'token_number', 12),
    text('Source', 'source_name', 22),
    text('Portion', 'portion_label', 13),
    text('Test', 'test_name', 26),
    text('Unit', 'unit', 10),
  ];
  if (values.has('dispatch')) cols.push({ header: 'Dispatch', kind: 'number', width: 12, decimals: 3, value: side('dispatch_value', 'dispatch_text') }, { header: 'Dispatch Result', kind: 'text', width: 15, value: result('dispatch_passed') });
  if (values.has('plant')) cols.push({ header: 'Plant', kind: 'number', width: 12, decimals: 3, value: side('plant_value', 'plant_text') }, { header: 'Plant Result', kind: 'text', width: 13, value: result('plant_passed') });
  if (values.has('diff')) cols.push({ header: 'Difference', kind: 'number', width: 12, decimals: 3, value: (r) => minus(r.plant_value, r.dispatch_value) });
  return cols;
}

// ------------------------------------------------------------------------------------------------ writing
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const FAIL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 30;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

function startSheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, name: string, cols: Column[], frozen: number) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: frozen, ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  cols.forEach((c, i) => {
    if (c.kind === 'number') ws.getColumn(i + 1).numFmt = numFmt(c.decimals ?? 2);
    if (c.kind === 'datetime') ws.getColumn(i + 1).numFmt = 'dd-mmm-yyyy hh:mm';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const header = ws.getRow(1);
  styleHeader(header);
  header.commit();
  return ws;
}

function cellValue(c: Column, r: Raw): unknown {
  const v = c.value(r);
  if (v === null || v === undefined) return null;
  if (c.kind === 'number') return typeof v === 'string' && toNumber(v) == null ? v : toNumber(v);
  if (c.kind === 'datetime') return plantClock(v);
  if (c.kind === 'yesno') return v ? 'Yes' : 'No';
  return String(v);
}

// ------------------------------------------------------------------------------------------------ the file
export async function buildVehicleReportExcel(params: VehicleExportParams, db: VehiclePortionReportDb): Promise<Buffer> {
  const { where, args } = buildVisitWhere(params);
  const sheets = new Set<string>(params.sheets ?? DEFAULT_SHEETS);
  const values = new Set<string>(params.values ?? ALL_VALUES);
  const groups = new Set<string>(params.groups ?? DEFAULT_GROUPS);
  const testIds = params.testIds ?? [];
  if (sheets.size === 0) throw new ReportInputError('Choose at least one sheet.');
  if (sheets.has('tests') && values.size === 0) throw new ReportInputError('Choose Dispatch, Plant or Difference for the Lab tests sheet.');

  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        return fn(tx);
      },
      { timeout: STATEMENT_TIMEOUT_MS * 2 + 2000, maxWait: 5000 }
    );

  // Portions of the vehicles that match: the Portions and Lab tests sheets follow the vehicle filters.
  const portionsOf = (visitWhere: string) => `visit_id IN (SELECT visit_id FROM ${VISIT_REPORT_VIEW} WHERE ${visitWhere})`;
  const testFilter = (firstParam: number) => (testIds.length > 0 ? ` AND test_id = ANY($${firstParam}::bigint[])` : '');

  // Size first, so a request that is too large is refused before any heavy reading. The same query lists the days
  // that have vehicles, so empty days cost nothing later.
  const { days, portions, testRows } = await run(async (tx) => {
    const perDay = (await tx.$queryRawUnsafe(
      `SELECT to_char(dispatched_at AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD') AS day, SUM(portions) AS portions
       FROM ${VISIT_REPORT_VIEW} WHERE ${where} GROUP BY 1 ORDER BY 1 DESC`,
      ...args
    )) as Raw[];
    let tests = 0;
    if (sheets.has('tests') && perDay.length > 0) {
      const counted = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM vw_portion_test_comparison WHERE ${portionsOf(where)}${testFilter(args.length + 1)}`,
        ...args,
        ...(testIds.length > 0 ? [testIds] : [])
      )) as Raw[];
      tests = Number(counted[0]?.n ?? 0);
    }
    return { days: perDay.map((d) => String(d.day)), portions: perDay.reduce((s, d) => s + Number(d.portions), 0), testRows: tests };
  });
  if (days.length === 0) throw new ReportInputError('No vehicles match these dates and filters.');
  if (portions > EXPORT_MAX_ROWS) {
    throw new ReportInputError(`This report has ${portions.toLocaleString()} portions. The limit is ${EXPORT_MAX_ROWS.toLocaleString()}. Choose fewer days or one source.`);
  }
  if (testRows > EXPORT_MAX_TEST_ROWS) {
    throw new ReportInputError(`The Lab tests sheet would have ${testRows.toLocaleString()} rows. Choose fewer days, fewer tests or one source.`);
  }

  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    out.on('end', resolve);
    out.on('error', reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = 'Milk Reception';
  wb.created = new Date();

  // Each sheet is written whole before the next one starts, so nothing waits in memory. It is read a week of
  // vehicle days at a time (days with no vehicles are skipped), so each query stays small.
  const DAYS_PER_READ = 7;
  const eachDay = async (write: (dayWhere: string, dayArgs: unknown[]) => Promise<void>) => {
    for (let i = 0; i < days.length; i += DAYS_PER_READ) {
      const chunk = days.slice(i, i + DAYS_PER_READ); // newest first
      const slice = buildVisitWhere({ ...params, from: chunk[chunk.length - 1], to: chunk[0] });
      await write(slice.where, slice.args);
    }
  };

  if (sheets.has('summary')) await writeSummary(wb, params, where, args, run);

  if (sheets.has('vehicles')) {
    const cols = vehicleColumns(groups, values);
    const ws = startSheet(wb, 'Vehicles', cols, 4);
    await eachDay(async (dayWhere, dayArgs) => {
      const rows = (await run((tx) => tx.$queryRawUnsafe(`SELECT * FROM ${VISIT_REPORT_VIEW} WHERE ${dayWhere} ORDER BY dispatched_at DESC, visit_id DESC`, ...dayArgs))) as Raw[];
      for (const r of rows) ws.addRow(cols.map((c) => cellValue(c, r))).commit();
    });
    ws.commit();
  }

  if (sheets.has('portions')) {
    const cols = portionColumns(groups, values);
    const ws = startSheet(wb, 'Portions', cols, 5);
    await eachDay(async (dayWhere, dayArgs) => {
      const rows = (await run((tx) =>
        tx.$queryRawUnsafe(`SELECT * FROM ${REPORT_VIEW} WHERE ${portionsOf(dayWhere)} ORDER BY dispatched_at DESC, visit_id DESC, portion_number`, ...dayArgs)
      )) as Raw[];
      for (const r of rows) ws.addRow(cols.map((c) => cellValue(c, r))).commit();
    });
    ws.commit();
  }

  if (sheets.has('tests')) {
    const cols = testColumns(values);
    const ws = startSheet(wb, 'Lab tests', cols, 6);
    const failAt = (header: string) => cols.findIndex((c) => c.header === header) + 1;
    const dispatchCol = failAt('Dispatch');
    const plantCol = failAt('Plant');
    await eachDay(async (dayWhere, dayArgs) => {
      const rows = (await run((tx) =>
        tx.$queryRawUnsafe(
          `SELECT r.dispatched_at, r.vehicle_number, r.token_number, r.source_name, r.portion_label, c.*
           FROM vw_portion_test_comparison c
           JOIN ${REPORT_VIEW} r ON r.portion_id = c.portion_id
           WHERE r.${portionsOf(dayWhere)}${testFilter(dayArgs.length + 1).replace('test_id', 'c.test_id')}
           ORDER BY r.dispatched_at DESC, r.visit_id DESC, r.portion_number, c.display_order, c.test_id`,
          ...dayArgs,
          ...(testIds.length > 0 ? [testIds] : [])
        )
      )) as Raw[];
      for (const r of rows) {
        const row = ws.addRow(cols.map((c) => cellValue(c, r)));
        if (dispatchCol > 0 && r.dispatch_passed === false) row.getCell(dispatchCol).fill = FAIL_FILL;
        if (plantCol > 0 && r.plant_passed === false) row.getCell(plantCol).fill = FAIL_FILL;
        row.commit();
      }
    });
    ws.commit();
  }

  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
}

/** Summary: what was asked for, then one line per source and a total, from one grouped query. */
async function writeSummary(
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  params: VehicleExportParams,
  where: string,
  args: unknown[],
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
) {
  const lines = (await run((tx) =>
    tx.$queryRawUnsafe(
      `SELECT source_name, source_type, COUNT(*) AS vehicles, COUNT(reconciled_at) AS received, SUM(portions) AS portions,
              SUM(accepted_portions) AS accepted, SUM(rejected_portions) AS rejected,
              SUM(dispatch_gross_liters) AS dispatch_gross, SUM(received_gross_liters) AS received_gross,
              SUM(dispatch_at_13ts_liters) AS dispatch_13, SUM(received_at_13ts_liters) AS received_13,
              SUM(at_13ts_variance_liters) AS variance_13
       FROM ${VISIT_REPORT_VIEW} WHERE ${where} GROUP BY 1, 2 ORDER BY 2, 1`,
      ...args
    )
  )) as Raw[];

  const ws = wb.addWorksheet('Summary');
  ws.columns = [{ width: 28 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 17 }, { width: 17 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const sourceType = params.source?.sourceType ?? 'ALL';
  const searches = Object.entries(params.filters ?? {}).filter(([, v]) => v?.trim());
  ws.addRow(['Vehicle report']).font = { bold: true, size: 14 };
  ws.addRow(['Dates', `${params.from} to ${params.to}`]);
  ws.addRow(['Dispatched from', sourceType === 'ALL' ? 'ZMCC and Contractor' : sourceType === 'ZMCC' ? 'ZMCC' : 'Contractor']);
  ws.addRow(['Sources', params.source?.sourceIds?.length ? lines.map((l) => String(l.source_name)).join(', ') : 'All']);
  ws.addRow(['Searches', searches.length ? searches.map(([k, v]) => `${k}: ${v}`).join('; ') : 'None']);
  ws.addRow(['Made on', plantClock(new Date())]).getCell(2).numFmt = 'dd-mmm-yyyy hh:mm';
  ws.addRow([]);
  styleHeader(ws.addRow(['Source', 'Type', 'Vehicles', 'Received', 'Portions', 'Accepted', 'Rejected', 'Dispatch Gross L', 'Received Gross L', 'Dispatch @13 TS L', 'Received @13 TS L', '@13 TS Variance L']));
  const total = Array<number>(10).fill(0);
  const keys = ['vehicles', 'received', 'portions', 'accepted', 'rejected', 'dispatch_gross', 'received_gross', 'dispatch_13', 'received_13', 'variance_13'];
  const money = (row: ExcelJS.Row) => {
    for (let i = 8; i <= 12; i++) row.getCell(i).numFmt = numFmt(2);
  };
  for (const l of lines) {
    const nums = keys.map((k) => toNumber(l[k]) ?? 0);
    nums.forEach((n, i) => (total[i] += n));
    money(ws.addRow([String(l.source_name), String(l.source_type ?? ''), ...nums.map((n, i) => (i >= 5 ? Math.round(n * 100) / 100 : n))]));
  }
  const totalRow = ws.addRow(['Total', '', ...total.map((n, i) => (i >= 5 ? Math.round(n * 100) / 100 : n))]);
  totalRow.font = { bold: true };
  money(totalRow);
  ws.addRow([]);
  ws.addRow(['A portion is one compartment of the tanker, with its own seal and quantity. Received and variance cover vehicles that reached final receipt.']);
  ws.addRow(['Plant quality on the Vehicles sheet is the composite saved at final receipt, or the average of the portions until then.']);
  ws.commit();
}

/** One export at a time per person: a second press while one is running is refused instead of doubling the load. */
const running = new Set<string>();

export async function exportOncePerUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  if (running.has(userId)) throw new ReportInputError('Your Excel file is still being made. Please wait for it.');
  running.add(userId);
  try {
    return await work();
  } finally {
    running.delete(userId);
  }
}
