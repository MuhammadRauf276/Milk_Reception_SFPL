/**
 * The vehicle report as an Excel file: one row per portion with everything the Inspect window shows (the vehicle,
 * the papers, seals, dispatch beside plant for every test, quantities, weights, every time stamp and the final
 * reconciliation), read from the vw_vehicle_export_report and vw_portion_test_comparison views.
 *
 * Kept light on the database:
 *  - the same required and capped date range as the screen, and a cap on rows;
 *  - read one day at a time, so each query is small, uses the dispatch date index and has its own time limit;
 *  - rows are written to the file as they arrive (a streaming writer), so memory stays flat however long the report;
 *  - one export at a time per person.
 */
import ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import {
  REPORT_VIEW,
  ReportInputError,
  STATEMENT_TIMEOUT_MS,
  buildReportWhere,
  type ReportColumnFilters,
  type ReportSourceFilter,
  type VehiclePortionReportDb,
} from './vehiclePortionReport';
import { EXPORT_GROUPS, EXPORT_MAX_ROWS, type ExportGroupKey } from './vehicleReportExportOptions';

type Raw = Record<string, unknown>;
type CellKind = 'text' | 'number' | 'datetime' | 'yesno';

interface ExportColumn {
  header: string;
  group: ExportGroupKey | 'always';
  kind: CellKind;
  width: number;
  /** Decimal places shown for a number. */
  decimals?: number;
  /** A value of the whole vehicle: written on its first portion only, so a column total never counts it twice. */
  vehicleWide?: boolean;
  value: (r: Raw) => unknown;
}

const col = (sql: string) => (r: Raw) => r[sql];
const diff = (plant: string, dispatch: string) => (r: Raw) => {
  const a = toNumber(r[plant]);
  const b = toNumber(r[dispatch]);
  return a == null || b == null ? null : Math.round((a - b) * 1000) / 1000;
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const text = (header: string, sql: string, group: ExportColumn['group'], width = 16): ExportColumn => ({
  header,
  group,
  kind: 'text',
  width,
  value: col(sql),
});
const number = (
  header: string,
  sql: string,
  group: ExportColumn['group'],
  opts: { decimals?: number; vehicleWide?: boolean; width?: number } = {}
): ExportColumn => ({ header, group, kind: 'number', width: opts.width ?? 14, decimals: opts.decimals ?? 2, vehicleWide: opts.vehicleWide, value: col(sql) });
const time = (header: string, sql: string, group: ExportColumn['group'], vehicleWide = true): ExportColumn => ({
  header,
  group,
  kind: 'datetime',
  width: 19,
  vehicleWide,
  value: col(sql),
});

/** Fixed columns, in file order. The columns of the Tests group are added per lab test when the file is built. */
const COLUMNS: ExportColumn[] = [
  time('Dispatched', 'dispatched_at', 'always', false),
  text('Visit No', 'visit_number', 'always'),
  text('Vehicle', 'vehicle_number', 'always', 14),
  text('Token', 'token_number', 'always', 14),
  text('Source Type', 'source_type', 'always', 13),
  text('Source', 'source_name', 'always', 24),
  text('Source Code', 'source_code', 'always', 13),
  text('Stage', 'stage', 'always', 28),
  text('Portion', 'portion_label', 'always', 9),
  text('Plant Decision', 'decision', 'always', 15),

  text('Driver', 'driver_name', 'vehicle', 18),
  text('Dispatch Note No', 'dispatch_note_number', 'vehicle', 18),
  text('Reception No', 'reception_number', 'vehicle', 16),
  text('Dispatch Decision', 'dispatch_person_decision', 'vehicle', 18),
  text('System Outcome', 'dispatch_system_outcome', 'vehicle', 18),
  text('Approval', 'approval_status', 'vehicle', 14),
  { header: 'Tanker Washed', group: 'vehicle', kind: 'yesno', width: 14, value: col('tanker_washed') },

  text('Seal (Dispatch)', 'seal_number', 'portion', 16),
  text('Seal (Plant)', 'plant_seal_number', 'portion', 16),
  { header: 'Seal Match', group: 'portion', kind: 'yesno', width: 12, value: col('seal_match') },
  number('Portion Quantity', 'dispatch_quantity_value', 'portion'),
  text('Unit', 'dispatch_quantity_unit', 'portion', 8),
  text('Rejection Reason', 'plant_rejection_reason', 'portion', 28),
  time('Plant Decided', 'plant_decided_at', 'portion', false),

  number('Fat Dispatch', 'dispatch_fat', 'quality'),
  number('Fat Plant', 'plant_fat', 'quality'),
  { header: 'Fat Diff', group: 'quality', kind: 'number', width: 11, decimals: 2, value: diff('plant_fat', 'dispatch_fat') },
  number('LR Dispatch', 'dispatch_lr', 'quality'),
  number('LR Plant', 'plant_lr', 'quality'),
  { header: 'LR Diff', group: 'quality', kind: 'number', width: 11, decimals: 2, value: diff('plant_lr', 'dispatch_lr') },
  number('SNF Dispatch', 'dispatch_snf', 'quality', { decimals: 3 }),
  number('SNF Plant', 'plant_snf', 'quality', { decimals: 3 }),
  { header: 'SNF Diff', group: 'quality', kind: 'number', width: 11, decimals: 3, value: diff('plant_snf', 'dispatch_snf') },
  number('TS Dispatch', 'dispatch_ts', 'quality', { decimals: 3 }),
  number('TS Plant', 'plant_ts', 'quality', { decimals: 3 }),
  { header: 'TS Diff', group: 'quality', kind: 'number', width: 11, decimals: 3, value: diff('plant_ts', 'dispatch_ts') },

  number('Dispatch Gross L', 'dispatch_gross_liters', 'quantity', { vehicleWide: true, width: 17 }),
  number('Received Gross L', 'received_gross_liters', 'quantity', { vehicleWide: true, width: 17 }),
  number('Gross Variance L', 'gross_variance_liters', 'quantity', { vehicleWide: true, width: 17 }),
  number('Gross Variance %', 'gross_variance_percent', 'quantity', { vehicleWide: true, width: 17, decimals: 3 }),
  number('Dispatch @13 TS L', 'dispatch_at_13ts_liters', 'quantity', { vehicleWide: true, width: 18 }),
  number('Received @13 TS L', 'received_at_13ts_liters', 'quantity', { vehicleWide: true, width: 18 }),
  number('@13 TS Variance L', 'at_13ts_variance_liters', 'quantity', { vehicleWide: true, width: 18 }),
  number('@13 TS Variance %', 'at_13ts_variance_percent', 'quantity', { vehicleWide: true, width: 18, decimals: 3 }),

  { ...text('Weight Ticket', 'weight_ticket_number', 'weights', 16), vehicleWide: true },
  number('First Weight kg', 'first_weight_kg', 'weights', { vehicleWide: true, width: 16 }),
  number('Second Weight kg', 'second_weight_kg', 'weights', { vehicleWide: true, width: 17 }),
  number('Net Weight kg', 'net_weight_kg', 'weights', { vehicleWide: true, width: 15 }),

  time('Gate In', 'gate_in_at', 'timings'),
  time('First Weight At', 'first_weight_at', 'timings'),
  time('Unloading Start', 'unloading_started_at', 'timings', false),
  time('Unloading End', 'unloading_finished_at', 'timings', false),
  text('Silo', 'silo_number', 'timings', 10),
  time('Second Weight At', 'second_weight_at', 'timings'),
  time('Gate Out', 'gate_out_at', 'timings'),
  time('Final Receipt', 'reconciled_at', 'timings'),
];

const FIXED_SQL = [
  'visit_id', 'portion_id', 'is_first_portion', 'dispatched_at', 'visit_number', 'vehicle_number', 'token_number',
  'source_type', 'source_name', 'source_code', 'stage', 'portion_label', 'decision', 'driver_name', 'dispatch_note_number',
  'reception_number', 'dispatch_person_decision', 'dispatch_system_outcome', 'approval_status', 'tanker_washed',
  'seal_number', 'plant_seal_number', 'seal_match', 'dispatch_quantity_value', 'dispatch_quantity_unit',
  'plant_rejection_reason', 'plant_decided_at', 'dispatch_fat', 'plant_fat', 'dispatch_lr', 'plant_lr', 'dispatch_snf',
  'plant_snf', 'dispatch_ts', 'plant_ts', 'dispatch_gross_liters', 'received_gross_liters', 'gross_variance_liters',
  'gross_variance_percent', 'dispatch_at_13ts_liters', 'received_at_13ts_liters', 'at_13ts_variance_liters',
  'at_13ts_variance_percent', 'weight_ticket_number', 'first_weight_kg', 'second_weight_kg', 'net_weight_kg', 'gate_in_at',
  'first_weight_at', 'unloading_started_at', 'unloading_finished_at', 'silo_number', 'second_weight_at', 'gate_out_at',
  'reconciled_at',
].join(', ');

export interface VehicleExportParams {
  from?: string | null;
  to?: string | null;
  filters?: ReportColumnFilters;
  source?: Partial<ReportSourceFilter>;
  /** Column groups to include. Empty or missing means all of them. */
  groups?: ExportGroupKey[];
}

/** Reads `groups=vehicle,quality,...` from the address. Unknown names are dropped; none means all. */
export function parseExportGroups(params: URLSearchParams): ExportGroupKey[] {
  const known = new Set<string>(EXPORT_GROUPS.map((g) => g.key));
  const asked = (params.get('groups') || '').split(',').map((g) => g.trim()).filter((g) => known.has(g)) as ExportGroupKey[];
  return asked.length > 0 ? asked : EXPORT_GROUPS.map((g) => g.key);
}

const PKT_OFFSET_MS = 5 * 3600_000;
/** Excel has no time zones: the plant's clock time is written as the cell value. */
const plantClock = (v: unknown): Date | null => {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null;
  return new Date(v.getTime() + PKT_OFFSET_MS);
};

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const FAIL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
const numFmt = (decimals: number) => (decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0');

interface SourceTotals {
  source: string;
  type: string;
  vehicles: number;
  portions: number;
  accepted: number;
  rejected: number;
  pending: number;
  dispatchGross: number;
  receivedGross: number;
  dispatch13: number;
  received13: number;
  received: number;
  variance13: number;
}

interface TestCell {
  dispatch: unknown;
  plant: unknown;
  dispatchFailed: boolean;
  plantFailed: boolean;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 32;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

/** Builds the file. Throws ReportInputError with a readable reason when the request cannot be served. */
export async function buildVehicleReportExcel(params: VehicleExportParams, db: VehiclePortionReportDb): Promise<Buffer> {
  const { where, args } = buildReportWhere(params);
  const from = params.from as string;
  const to = params.to as string;
  const groups = new Set<string>(params.groups?.length ? params.groups : EXPORT_GROUPS.map((g) => g.key));
  const withTests = groups.has('tests');

  const run = <T>(fn: (tx: Parameters<Parameters<VehiclePortionReportDb['$transaction']>[0]>[0]) => Promise<T>) =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        return fn(tx);
      },
      { timeout: STATEMENT_TIMEOUT_MS * 2 + 2000, maxWait: 5000 }
    );

  // The size is checked first, so a request that is too large is refused before any heavy reading. The same
  // query lists the days that have vehicles, so empty days cost nothing later.
  const { days, total } = await run(async (tx) => {
    const perDay = (await tx.$queryRawUnsafe(
      `SELECT to_char(dispatched_at + interval '5 hours', 'YYYY-MM-DD') AS day, COUNT(*) AS total
       FROM ${REPORT_VIEW} WHERE ${where} GROUP BY 1 ORDER BY 1 DESC`,
      ...args
    )) as Raw[];
    return { days: perDay.map((d) => String(d.day)), total: perDay.reduce((sum, d) => sum + Number(d.total), 0) };
  });
  if (total === 0) throw new ReportInputError('No vehicles match these dates and filters.');
  if (total > EXPORT_MAX_ROWS) {
    throw new ReportInputError(
      `This report has ${total.toLocaleString()} rows. The limit is ${EXPORT_MAX_ROWS.toLocaleString()}. Choose fewer days or one source.`
    );
  }

  // Only the lab tests that have a result in this report get columns.
  const tests = withTests
    ? await run(
        async (tx) =>
          (await tx.$queryRawUnsafe(
            `SELECT t.id, t.test_name, t.unit FROM lab_test t
             WHERE t.id IN (
               SELECT r.test_id FROM dispatch_lab_result r
               WHERE r.performance_status = 'PERFORMED' AND r.portion_id IN (SELECT portion_id FROM ${REPORT_VIEW} WHERE ${where})
               UNION
               SELECT r.test_id FROM plant_lab_result r
               WHERE r.performance_status = 'PERFORMED' AND r.portion_id IN (SELECT portion_id FROM ${REPORT_VIEW} WHERE ${where})
             )
             ORDER BY t.display_order, t.id`,
            ...args
          )) as Raw[]
      )
    : [];

  const columns = COLUMNS.filter((c) => c.group === 'always' || groups.has(c.group));
  const testIndex = new Map<string, number>();
  tests.forEach((t, i) => testIndex.set(String(t.id), i));

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

  const ws = wb.addWorksheet('Vehicles', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  const testHeader = (t: Raw, side: string) => `${String(t.test_name)}${t.unit ? ` (${String(t.unit)})` : ''} ${side}`;
  ws.columns = [
    ...columns.map((c) => ({ header: c.header, width: c.width })),
    ...tests.flatMap((t) => [
      { header: testHeader(t, 'Dispatch'), width: 16 },
      { header: testHeader(t, 'Plant'), width: 16 },
    ]),
  ];
  columns.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    if (c.kind === 'number') column.numFmt = numFmt(c.decimals ?? 2);
    if (c.kind === 'datetime') column.numFmt = 'dd-mmm-yyyy hh:mm';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length + tests.length * 2 } };
  const header = ws.getRow(1);
  styleHeader(header);
  header.commit();

  const totals = new Map<string, SourceTotals>();
  const add = (v: unknown) => toNumber(v) ?? 0;

  for (const day of days) {
    const slice = buildReportWhere({ ...params, from: day, to: day });
    const { rows, testsByPortion } = await run(async (tx) => {
      const dayRows = (await tx.$queryRawUnsafe(
        `SELECT ${FIXED_SQL} FROM ${REPORT_VIEW} WHERE ${slice.where} ORDER BY dispatched_at DESC, visit_id DESC, portion_number`,
        ...slice.args
      )) as Raw[];
      const byPortion = new Map<string, TestCell[]>();
      if (withTests && dayRows.length > 0) {
        const results = (await tx.$queryRawUnsafe(
          `SELECT portion_id, test_id, dispatch_value, plant_value, dispatch_text, plant_text, dispatch_passed, plant_passed
           FROM vw_portion_test_comparison WHERE portion_id = ANY($1::bigint[])`,
          dayRows.map((r) => String(r.portion_id))
        )) as Raw[];
        for (const r of results) {
          const index = testIndex.get(String(r.test_id));
          if (index === undefined) continue;
          const key = String(r.portion_id);
          let cells = byPortion.get(key);
          if (!cells) byPortion.set(key, (cells = []));
          cells[index] = {
            dispatch: toNumber(r.dispatch_value) ?? r.dispatch_text ?? null,
            plant: toNumber(r.plant_value) ?? r.plant_text ?? null,
            dispatchFailed: r.dispatch_passed === false,
            plantFailed: r.plant_passed === false,
          };
        }
      }
      return { rows: dayRows, testsByPortion: byPortion };
    });

    for (const r of rows) {
      const first = Boolean(r.is_first_portion);
      const values: unknown[] = columns.map((c) => {
        if (c.vehicleWide && !first) return null;
        const v = c.value(r);
        if (v === null || v === undefined) return null;
        if (c.kind === 'number') return toNumber(v);
        if (c.kind === 'datetime') return plantClock(v);
        if (c.kind === 'yesno') return v ? 'Yes' : 'No';
        return String(v);
      });
      const cells = testsByPortion.get(String(r.portion_id));
      const failed: number[] = [];
      tests.forEach((_, i) => {
        const cell = cells?.[i];
        values.push(cell?.dispatch ?? null, cell?.plant ?? null);
        if (cell?.dispatchFailed) failed.push(columns.length + i * 2 + 1);
        if (cell?.plantFailed) failed.push(columns.length + i * 2 + 2);
      });
      const row = ws.addRow(values);
      for (const index of failed) row.getCell(index).fill = FAIL_FILL;
      row.commit();

      const key = String(r.source_name);
      let t = totals.get(key);
      if (!t) {
        t = { source: key, type: String(r.source_type ?? ''), vehicles: 0, portions: 0, accepted: 0, rejected: 0, pending: 0, dispatchGross: 0, receivedGross: 0, dispatch13: 0, received13: 0, received: 0, variance13: 0 };
        totals.set(key, t);
      }
      t.portions += 1;
      if (r.decision === 'ACCEPTED') t.accepted += 1;
      else if (r.decision === 'REJECTED') t.rejected += 1;
      else t.pending += 1;
      if (first) {
        t.vehicles += 1;
        t.dispatchGross += add(r.dispatch_gross_liters);
        t.receivedGross += add(r.received_gross_liters);
        t.dispatch13 += add(r.dispatch_at_13ts_liters);
        t.received13 += add(r.received_at_13ts_liters);
        if (r.reconciled_at) t.received += 1;
        t.variance13 += add(r.at_13ts_variance_liters);
      }
    }
  }
  ws.commit();

  // Summary: what was asked for, then one line per source and a total.
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { width: 28 }, { width: 14 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ];
  const sourceType = params.source?.sourceType ?? 'ALL';
  const searches = Object.entries(params.filters ?? {}).filter(([, v]) => v?.trim());
  summary.addRow(['Vehicle report']).font = { bold: true, size: 14 };
  summary.addRow(['Dates', `${from} to ${to}`]);
  summary.addRow(['Source type', sourceType === 'ALL' ? 'ZMCC and Contractor' : sourceType === 'ZMCC' ? 'ZMCC' : 'Contractor']);
  summary.addRow(['Sources', params.source?.sourceIds?.length ? [...totals.keys()].join(', ') : 'All']);
  summary.addRow(['Column searches', searches.length ? searches.map(([k, v]) => `${k}: ${v}`).join('; ') : 'None']);
  summary.addRow(['Made on', plantClock(new Date())]).getCell(2).numFmt = 'dd-mmm-yyyy hh:mm';
  summary.addRow([]);
  styleHeader(
    summary.addRow([
      'Source', 'Type', 'Vehicles', 'Received', 'Portions', 'Accepted', 'Rejected', 'Pending',
      'Dispatch Gross L', 'Received Gross L', 'Dispatch @13 TS L', 'Received @13 TS L', '@13 TS Variance L',
    ])
  );
  const lines = [...totals.values()].sort((a, b) => a.type.localeCompare(b.type) || a.source.localeCompare(b.source));
  const sum = (pick: (t: SourceTotals) => number) => lines.reduce((s, t) => s + pick(t), 0);
  const line = (t: SourceTotals) => [
    t.source, t.type, t.vehicles, t.received, t.portions, t.accepted, t.rejected, t.pending,
    // The variance is the one saved at final receipt, so it covers received vehicles only.
    ...[t.dispatchGross, t.receivedGross, t.dispatch13, t.received13, t.variance13].map((n) => Math.round(n * 100) / 100),
  ];
  const format = (row: ExcelJS.Row) => {
    for (let i = 9; i <= 13; i++) row.getCell(i).numFmt = numFmt(2);
  };
  for (const t of lines) format(summary.addRow(line(t)));
  const totalRow = summary.addRow(
    line({
      source: 'Total', type: '', vehicles: sum((t) => t.vehicles), portions: sum((t) => t.portions), accepted: sum((t) => t.accepted),
      rejected: sum((t) => t.rejected), pending: sum((t) => t.pending), dispatchGross: sum((t) => t.dispatchGross),
      receivedGross: sum((t) => t.receivedGross), dispatch13: sum((t) => t.dispatch13), received13: sum((t) => t.received13),
      received: sum((t) => t.received), variance13: sum((t) => t.variance13),
    })
  );
  totalRow.font = { bold: true };
  format(totalRow);
  summary.addRow([]);
  summary.addRow(['Vehicle totals appear on the first portion row only. Received and variance figures cover vehicles that reached final receipt. Red cells are failed tests.']);
  summary.commit();

  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
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
