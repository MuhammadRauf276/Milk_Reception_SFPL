/**
 * Vehicle report read from the vw_vehicle_export_report view (the vehicle report columns plus the source and the
 * Excel-only columns). Safe to import on the client for the column list and limits: the database comes in as an argument.
 */

/** The one view both the screen and the Excel file read, so they can never disagree. */
export const REPORT_VIEW = 'vw_vehicle_export_report';

export const REPORT_MAX_RANGE_DAYS = 92;
export const REPORT_PAGE_SIZE = 50;
export const STATEMENT_TIMEOUT_MS = 8000;
const MAX_SEARCH_LENGTH = 60;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Every searchable column, and only these reach SQL. Numeric columns are searched as text. */
const COLUMN_SQL = {
  vehicle: { sql: 'vehicle_number' },
  token: { sql: 'token_number' },
  source: { sql: 'source_name' },
  date: { sql: 'dispatch_date_text' },
  stage: { sql: 'stage' },
  portion: { sql: 'portion_label' },
  decision: { sql: 'decision' },
  quantity: { sql: 'dispatch_quantity_value', numeric: true },
  dispatchFat: { sql: 'dispatch_fat', numeric: true },
  plantFat: { sql: 'plant_fat', numeric: true },
  dispatchLr: { sql: 'dispatch_lr', numeric: true },
  plantLr: { sql: 'plant_lr', numeric: true },
  dispatchSnf: { sql: 'dispatch_snf', numeric: true },
  plantSnf: { sql: 'plant_snf', numeric: true },
  dispatchTs: { sql: 'dispatch_ts', numeric: true },
  plantTs: { sql: 'plant_ts', numeric: true },
  dispatch13Ts: { sql: 'dispatch_at_13ts_liters', numeric: true },
  firstWeight: { sql: 'first_weight_kg', numeric: true },
  secondWeight: { sql: 'second_weight_kg', numeric: true },
  netWeight: { sql: 'net_weight_kg', numeric: true },
  received13Ts: { sql: 'received_at_13ts_liters', numeric: true },
} as const satisfies Record<string, { sql: string; numeric?: boolean }>;

export type ReportColumnKey = keyof typeof COLUMN_SQL;
export type ReportColumnFilters = Partial<Record<ReportColumnKey, string>>;

export interface VehiclePortionRow {
  key: string;
  visitId: string;
  /** First portion of its vehicle. Vehicle-wide values appear on this row only, so a column can never count them twice. */
  isFirstPortion: boolean;
  vehicle: string;
  token: string | null;
  source: string;
  date: string;
  stage: string;
  portion: string;
  decision: string;
  quantity: number | null;
  quantityUnit: string | null;
  dispatchFat: number | null;
  plantFat: number | null;
  dispatchLr: number | null;
  plantLr: number | null;
  dispatchSnf: number | null;
  plantSnf: number | null;
  dispatchTs: number | null;
  plantTs: number | null;
  dispatch13Ts: number | null;
  firstWeight: number | null;
  secondWeight: number | null;
  netWeight: number | null;
  received13Ts: number | null;
}

export interface VehiclePortionReport {
  rows: VehiclePortionRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export class ReportInputError extends Error {}

/** Which kind of source the report covers. */
export const SOURCE_TYPES = ['ALL', 'ZMCC', 'CONTRACTOR'] as const;
export type SourceTypeFilter = (typeof SOURCE_TYPES)[number];

export interface ReportSourceFilter {
  sourceType: SourceTypeFilter;
  /** Chosen sources. Empty means every source of the chosen kind. */
  sourceIds: string[];
}

const MAX_SOURCE_IDS = 200;

/** Reads `sourceType` and `sourceIds=1,2,3` from the address. Anything unknown falls back to all sources. */
export function parseSourceFilter(params: URLSearchParams): ReportSourceFilter {
  const type = (params.get('sourceType') || 'ALL').toUpperCase();
  const sourceType = (SOURCE_TYPES as readonly string[]).includes(type) ? (type as SourceTypeFilter) : 'ALL';
  const sourceIds = (params.get('sourceIds') || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{1,18}$/.test(id))
    .slice(0, MAX_SOURCE_IDS);
  return { sourceType, sourceIds };
}

export interface ReportWhereInput {
  from?: string | null;
  to?: string | null;
  filters?: ReportColumnFilters;
  source?: Partial<ReportSourceFilter>;
  /** Only these column searches are used (a view that lacks the other columns). */
  allowedColumns?: readonly ReportColumnKey[];
}

/**
 * The WHERE clause shared by the screen and the Excel file: the dates, the source choice and the column searches,
 * all as parameters. Throws ReportInputError when the dates are missing or the range is too long.
 */
export function buildReportWhere(input: ReportWhereInput): { where: string; args: unknown[] } {
  const problem = dateRangeProblem(input.from, input.to);
  if (problem) throw new ReportInputError(problem);

  // Dates are plant calendar days; the column holds UTC.
  const args: unknown[] = [
    new Date(`${input.from}T00:00:00.000+05:00`).toISOString(),
    new Date(`${input.to}T23:59:59.999+05:00`).toISOString(),
  ];
  // dispatched_at has a time zone; the bounds are instants.
  let where = 'dispatched_at BETWEEN $1::timestamptz AND $2::timestamptz';

  const sourceType = input.source?.sourceType ?? 'ALL';
  if (sourceType !== 'ALL') {
    args.push(sourceType);
    where += ` AND source_type = $${args.length}`;
  }
  const sourceIds = (input.source?.sourceIds ?? []).filter((id) => /^\d{1,18}$/.test(id));
  if (sourceIds.length > 0) {
    args.push(sourceIds);
    where += ` AND source_id = ANY($${args.length}::bigint[])`;
  }

  const search = buildColumnSearch(input.filters ?? {}, args.length + 1, input.allowedColumns);
  return { where: where + search.sql, args: [...args, ...search.args] };
}

/** Whole days covered by a date range, counting both ends. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** A readable reason the range is refused, or null when it is fine. */
export function dateRangeProblem(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to || !DATE_ONLY.test(from) || !DATE_ONLY.test(to)) return 'Choose a From date and a To date.';
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return 'Choose a valid date.';
  }
  if (from > to) return 'From date cannot be after To date.';
  if (rangeDays(from, to) > REPORT_MAX_RANGE_DAYS) return `Choose a range of ${REPORT_MAX_RANGE_DAYS} days or less.`;
  return null;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Column searches as parameterised SQL. Unknown columns and empty searches are dropped. */
export function buildColumnSearch(
  filters: ReportColumnFilters,
  firstParam: number,
  allowed?: readonly ReportColumnKey[]
): { sql: string; args: string[] } {
  const clauses: string[] = [];
  const args: string[] = [];
  for (const key of Object.keys(COLUMN_SQL) as ReportColumnKey[]) {
    if (allowed && !allowed.includes(key)) continue;
    const column: { sql: string; numeric?: boolean } = COLUMN_SQL[key];
    const raw = filters[key]?.trim().slice(0, MAX_SEARCH_LENGTH);
    // Numbers are shown with thousands separators but stored without them.
    const value = column.numeric ? raw?.replace(/,/g, '') : raw;
    if (!value) continue;
    args.push(`%${escapeLike(value)}%`);
    clauses.push(`${column.sql}${column.numeric ? '::text' : ''} ILIKE $${firstParam + args.length - 1}`);
  }
  return { sql: clauses.map((c) => ` AND ${c}`).join(''), args };
}

export function parseColumnFilters(params: URLSearchParams): ReportColumnFilters {
  const filters: ReportColumnFilters = {};
  for (const key of Object.keys(COLUMN_SQL) as ReportColumnKey[]) {
    const value = params.get(`f_${key}`);
    if (value) filters[key] = value;
  }
  return filters;
}

type Raw = Record<string, unknown>;

interface ReportTx {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe(sql: string, ...args: unknown[]): Promise<unknown>;
}

export interface VehiclePortionReportDb {
  $transaction<T>(fn: (tx: ReportTx) => Promise<T>, options: { timeout: number; maxWait: number }): Promise<T>;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Only what the screen shows is read, so the joins behind the Excel-only columns are left out of a page. */
const SCREEN_COLUMNS = [
  'visit_id', 'portion_id', 'is_first_portion', 'vehicle_number', 'token_number', 'source_name', 'dispatch_date_text',
  'stage', 'portion_label', 'decision', 'dispatch_quantity_value', 'dispatch_quantity_unit', 'dispatch_fat', 'plant_fat',
  'dispatch_lr', 'plant_lr', 'dispatch_snf', 'plant_snf', 'dispatch_ts', 'plant_ts', 'dispatch_at_13ts_liters',
  'first_weight_kg', 'second_weight_kg', 'net_weight_kg', 'received_at_13ts_liters',
].join(', ');

function toRow(r: Raw): VehiclePortionRow {
  return {
    key: String(r.portion_id),
    visitId: String(r.visit_id),
    isFirstPortion: Boolean(r.is_first_portion),
    vehicle: String(r.vehicle_number),
    token: (r.token_number as string | null) ?? null,
    source: String(r.source_name),
    date: String(r.dispatch_date_text),
    stage: String(r.stage),
    portion: String(r.portion_label),
    decision: String(r.decision),
    quantity: num(r.dispatch_quantity_value),
    quantityUnit: (r.dispatch_quantity_unit as string | null) ?? null,
    dispatchFat: num(r.dispatch_fat),
    plantFat: num(r.plant_fat),
    dispatchLr: num(r.dispatch_lr),
    plantLr: num(r.plant_lr),
    dispatchSnf: num(r.dispatch_snf),
    plantSnf: num(r.plant_snf),
    dispatchTs: num(r.dispatch_ts),
    plantTs: num(r.plant_ts),
    dispatch13Ts: num(r.dispatch_at_13ts_liters),
    firstWeight: num(r.first_weight_kg),
    secondWeight: num(r.second_weight_kg),
    netWeight: num(r.net_weight_kg),
    received13Ts: num(r.received_at_13ts_liters),
  };
}

/**
 * One page of the report. The guard rails that protect the rest of the system live here: a required and capped date
 * range, one fixed page size, and a time limit that stops the query instead of letting it hold up other work.
 */
export async function getVehiclePortionReport(
  params: ReportWhereInput & { page?: number; pageSize?: number },
  db: VehiclePortionReportDb
): Promise<VehiclePortionReport> {
  const { where, args } = buildReportWhere(params);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const rawPageSize = Number(params.pageSize);
  const effectivePageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(REPORT_PAGE_SIZE, Math.max(1, Math.floor(rawPageSize)))
      : REPORT_PAGE_SIZE;

  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const counted = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS total FROM ${REPORT_VIEW} WHERE ${where}`,
        ...args
      )) as Raw[];
      const totalRows = Number(counted[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalRows / effectivePageSize));
      const currentPage = Math.min(page, totalPages);
      const rows = (await tx.$queryRawUnsafe(
        `SELECT ${SCREEN_COLUMNS} FROM ${REPORT_VIEW} WHERE ${where}
         ORDER BY dispatched_at DESC, visit_id DESC, portion_number
         LIMIT ${effectivePageSize} OFFSET ${(currentPage - 1) * effectivePageSize}`,
        ...args
      )) as Raw[];
      return { rows: rows.map(toRow), page: currentPage, pageSize: effectivePageSize, totalRows, totalPages };
    },
    { timeout: STATEMENT_TIMEOUT_MS * 2 + 2000, maxWait: 5000 }
  );
}
