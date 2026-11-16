/**
 * Vehicle report, one row per vehicle, read from vw_vehicle_visit_report. Safe to import on the client for the types
 * and the searchable columns: the database comes in as an argument.
 */
import {
  REPORT_PAGE_SIZE,
  STATEMENT_TIMEOUT_MS,
  buildReportWhere,
  type ReportColumnKey,
  type ReportWhereInput,
  type VehiclePortionReportDb,
} from './vehiclePortionReport';

export const VISIT_REPORT_VIEW = 'vw_vehicle_visit_report';

/** The text columns a person can search on the vehicle report. */
export const VISIT_SEARCH_COLUMNS = ['vehicle', 'token', 'source', 'date', 'stage', 'decision'] as const satisfies readonly ReportColumnKey[];

export interface VehicleVisitRow {
  visitId: string;
  vehicle: string;
  token: string | null;
  source: string;
  sourceType: string | null;
  date: string;
  stage: string;
  decision: string;
  portions: number;
  plantAddedPortions: number;
  dispatchFat: number | null;
  plantFat: number | null;
  dispatchLr: number | null;
  plantLr: number | null;
  dispatchSnf: number | null;
  plantSnf: number | null;
  dispatchTs: number | null;
  plantTs: number | null;
  dispatchGrossLiters: number | null;
  receivedGrossLiters: number | null;
  dispatch13Ts: number | null;
  received13Ts: number | null;
  variance13Ts: number | null;
  netWeight: number | null;
  gateOutAt: string | null;
}

export interface VehicleVisitReport {
  rows: VehicleVisitRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const SCREEN_COLUMNS = [
  'visit_id', 'vehicle_number', 'token_number', 'source_name', 'source_type', 'dispatch_date_text', 'stage', 'decision',
  'portions', 'plant_added_portions', 'dispatch_fat', 'plant_fat', 'dispatch_lr', 'plant_lr', 'dispatch_snf', 'plant_snf',
  'dispatch_ts', 'plant_ts', 'dispatch_gross_liters', 'received_gross_liters', 'dispatch_at_13ts_liters',
  'received_at_13ts_liters', 'at_13ts_variance_liters', 'net_weight_kg', 'gate_out_at',
].join(', ');

function toRow(r: Raw): VehicleVisitRow {
  return {
    visitId: String(r.visit_id),
    vehicle: String(r.vehicle_number),
    token: (r.token_number as string | null) ?? null,
    source: String(r.source_name),
    sourceType: (r.source_type as string | null) ?? null,
    date: String(r.dispatch_date_text),
    stage: String(r.stage),
    decision: String(r.decision),
    portions: Number(r.portions ?? 0),
    plantAddedPortions: Number(r.plant_added_portions ?? 0),
    dispatchFat: num(r.dispatch_fat),
    plantFat: num(r.plant_fat),
    dispatchLr: num(r.dispatch_lr),
    plantLr: num(r.plant_lr),
    dispatchSnf: num(r.dispatch_snf),
    plantSnf: num(r.plant_snf),
    dispatchTs: num(r.dispatch_ts),
    plantTs: num(r.plant_ts),
    dispatchGrossLiters: num(r.dispatch_gross_liters),
    receivedGrossLiters: num(r.received_gross_liters),
    dispatch13Ts: num(r.dispatch_at_13ts_liters),
    received13Ts: num(r.received_at_13ts_liters),
    variance13Ts: num(r.at_13ts_variance_liters),
    netWeight: num(r.net_weight_kg),
    gateOutAt: r.gate_out_at instanceof Date ? r.gate_out_at.toISOString() : null,
  };
}

/** The WHERE clause of the vehicle report: dates, source choice and the text column searches. */
export function buildVisitWhere(input: ReportWhereInput) {
  return buildReportWhere({ ...input, allowedColumns: VISIT_SEARCH_COLUMNS });
}

/** One page of vehicles, with the same guard rails as the portion report: capped dates, fixed page size, time limit. */
export async function getVehicleVisitReport(
  params: ReportWhereInput & { page?: number; pageSize?: number },
  db: VehiclePortionReportDb
): Promise<VehicleVisitReport> {
  const { where, args } = buildVisitWhere(params);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const asked = Number(params.pageSize);
  const pageSize = Number.isFinite(asked) && asked > 0 ? Math.min(REPORT_PAGE_SIZE, Math.max(1, Math.floor(asked))) : REPORT_PAGE_SIZE;

  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const counted = (await tx.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${VISIT_REPORT_VIEW} WHERE ${where}`, ...args)) as Raw[];
      const totalRows = Number(counted[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
      const currentPage = Math.min(page, totalPages);
      const rows = (await tx.$queryRawUnsafe(
        `SELECT ${SCREEN_COLUMNS} FROM ${VISIT_REPORT_VIEW} WHERE ${where}
         ORDER BY dispatched_at DESC, visit_id DESC
         LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`,
        ...args
      )) as Raw[];
      return { rows: rows.map(toRow), page: currentPage, pageSize, totalRows, totalPages };
    },
    { timeout: STATEMENT_TIMEOUT_MS * 2 + 2000, maxWait: 5000 }
  );
}
