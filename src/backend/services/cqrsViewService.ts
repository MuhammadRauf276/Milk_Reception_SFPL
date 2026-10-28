/**
 * CQRS View Service
 *
 * Provides high-performance, denormalized read-model queries powered by
 * PostgreSQL standard views (real-time active feed) and materialized views (indexed rollups).
 *
 * High-throughput transactional write operations remain completely decoupled from
 * these read views, avoiding locks and eliminating expensive in-memory JavaScript joins.
 */

import { prisma } from '@/backend/core/db';
import type { ManagementScope, ManagementFilters, Page } from '@/backend/modules/management-reporting';
import { assertManagementFiltersWithinScope, normalizeManagementPage } from '@/backend/modules/management-reporting';

// ============================================================================
// 1. TYPED VIEW SCHEMAS
// ============================================================================

export interface LiveMotCollectionRow {
  collection_id: string;
  collection_number: string;
  journey_id: string;
  journey_number: string;
  journey_status: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  route_id: string;
  route_code: string;
  route_name: string;
  mot_vehicle_id: string;
  vehicle_number: string;
  mot_profile_id: string;
  mot_driver_name: string;
  shop_id: string;
  shop_code: string;
  shop_name: string;
  owner_name: string;
  operational_date: string;
  quantity_value: number;
  quantity_unit: string;
  gross_liters: number;
  density: number;
  lr: number;
  fat: number;
  snf: number;
  ts: number;
  at_13ts_liters: number;
  final_decision: string;
  device_collected_at: string | null;
  shop_rmr_number: string | null;
  collection_notes: string | null;
  collection_latitude: number | null;
  collection_longitude: number | null;
  created_at: string;
}

export interface LiveHcSupplierInwardRow {
  arrival_id: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  arrival_date: string;
  arrival_timestamp: string;
  zmcc_token: string;
  raw_milk_token_number: string | null;
  arrival_rmr_number: string | null;
  vehicle_number: string;
  local_supplier_id: string;
  local_supplier_code: string;
  supplier_name: string;
  supplier_phone: string | null;
  supplier_cnic: string | null;
  supplier_active: boolean;
  lab_session_id: string | null;
  lab_status: string | null;
  lab_decision: string | null;
  final_decision: string | null;
  accepted_gross_liters: number | null;
  density: number | null;
  snf: number | null;
  ts: number | null;
  at_13ts_liters: number | null;
  lab_completed_at: string | null;
  rmr_id: string | null;
  rmr_year: number | null;
  rmr_series: string | null;
  rmr_book_number: string | null;
  rmr_receipt_number: string | null;
  rmr_quantity_value: number | null;
  rmr_status: string | null;
  rmr_issued_at: string | null;
}

export interface DailyProcurementRollupRow {
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  operational_date: string;
  route_id: string;
  route_code: string;
  route_name: string;
  journey_count: number;
  total_shop_collections: number;
  total_gross_liters: number;
  total_at_13ts_liters: number;
  avg_fat_percentage: number | null;
  avg_lr_reading: number | null;
  avg_snf_percentage: number | null;
}

export interface PlantTransitReconciliationRow {
  visit_id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  operational_date: string | null;
  current_status: string;
  dispatch_gross_liters: number | null;
  dispatch_fat: number | null;
  dispatch_lr: number | null;
  dispatch_snf: number | null;
  dispatch_at_13ts_liters: number | null;
  sent_gross_liters: number | null;
  received_gross_liters: number | null;
  gross_variance_liters: number | null;
  gross_variance_percent: number | null;
  sent_at_13ts_liters: number | null;
  received_at_13ts_liters: number | null;
  at_13ts_variance_liters: number | null;
  at_13ts_variance_percent: number | null;
  reconciled_at: string | null;
  created_at: string;
}

// ============================================================================
// 2. QUERY BUILDER HELPERS
// ============================================================================

function buildWhereClause(
  scope: ManagementScope,
  filters: ManagementFilters,
  dateColumn = 'operational_date',
  zmccColumn = 'zmcc_id'
): { whereSql: string; params: (string | number | bigint)[] } {
  assertManagementFiltersWithinScope(scope, filters);

  const conditions: string[] = ['1=1'];
  const params: (string | number | bigint)[] = [];
  let paramIdx = 1;

  if (scope.kind === 'ZMCC') {
    conditions.push(`${zmccColumn} = $${paramIdx++}`);
    params.push(BigInt(scope.zmccId));
  } else if (filters.sourceId) {
    conditions.push(`${zmccColumn} = $${paramIdx++}`);
    params.push(BigInt(filters.sourceId));
  }

  if (filters.routeId) {
    conditions.push(`route_id = $${paramIdx++}`);
    params.push(BigInt(filters.routeId));
  }

  if (filters.vehicleNumber) {
    conditions.push(`vehicle_number ILIKE $${paramIdx++}`);
    params.push(`%${filters.vehicleNumber.trim()}%`);
  }

  if (filters.from) {
    conditions.push(`${dateColumn} >= $${paramIdx++}::date`);
    params.push(filters.from);
  }

  if (filters.to) {
    conditions.push(`${dateColumn} <= $${paramIdx++}::date`);
    params.push(filters.to);
  }

  return { whereSql: conditions.join(' AND '), params };
}

// ============================================================================
// 3. READ QUERIES
// ============================================================================

/**
 * 1. Live MOT Shop Collections Feed (PostgreSQL Standard View)
 */
export async function getLiveMotCollectionFeed(
  scope: ManagementScope,
  filters: ManagementFilters
): Promise<Page<LiveMotCollectionRow>> {
  const { page, pageSize } = normalizeManagementPage(filters);
  const { whereSql, params } = buildWhereClause(scope, filters, 'operational_date', 'zmcc_id');

  const countQuery = `SELECT COUNT(*)::text as count FROM vw_mot_collection_feed WHERE ${whereSql}`;
  const countRes = (await prisma.$queryRawUnsafe(countQuery, ...params)) as { count: string }[];
  const total = Number(countRes[0]?.count || 0);

  const offset = (page - 1) * pageSize;
  const dataQuery = `
    SELECT * FROM vw_mot_collection_feed
    WHERE ${whereSql}
    ORDER BY operational_date DESC, collection_id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const rawRows = (await prisma.$queryRawUnsafe(dataQuery, ...params)) as any[];

  const items: LiveMotCollectionRow[] = rawRows.map((r) => ({
    collection_id: r.collection_id.toString(),
    collection_number: r.collection_number,
    journey_id: r.journey_id.toString(),
    journey_number: r.journey_number,
    journey_status: r.journey_status,
    zmcc_id: r.zmcc_id.toString(),
    zmcc_code: r.zmcc_code,
    zmcc_name: r.zmcc_name,
    route_id: r.route_id.toString(),
    route_code: r.route_code,
    route_name: r.route_name,
    mot_vehicle_id: r.mot_vehicle_id.toString(),
    vehicle_number: r.vehicle_number,
    mot_profile_id: r.mot_profile_id.toString(),
    mot_driver_name: r.mot_driver_name,
    shop_id: r.shop_id.toString(),
    shop_code: r.shop_code,
    shop_name: r.shop_name,
    owner_name: r.owner_name,
    operational_date: r.operational_date instanceof Date ? r.operational_date.toISOString().split('T')[0] : String(r.operational_date),
    quantity_value: Number(r.quantity_value || 0),
    quantity_unit: r.quantity_unit,
    gross_liters: Number(r.gross_liters || 0),
    density: Number(r.density || 0),
    lr: Number(r.lr || 0),
    fat: Number(r.fat || 0),
    snf: Number(r.snf || 0),
    ts: Number(r.ts || 0),
    at_13ts_liters: Number(r.at_13ts_liters || 0),
    final_decision: r.final_decision,
    device_collected_at: r.device_collected_at ? new Date(r.device_collected_at).toISOString() : null,
    shop_rmr_number: r.shop_rmr_number,
    collection_notes: r.collection_notes,
    collection_latitude: r.collection_latitude != null ? Number(r.collection_latitude) : null,
    collection_longitude: r.collection_longitude != null ? Number(r.collection_longitude) : null,
    created_at: new Date(r.created_at).toISOString(),
  }));

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * 2. Live HC/Direct Supplier Inward Feed (PostgreSQL Standard View)
 */
export async function getLiveHcSupplierInwardFeed(
  scope: ManagementScope,
  filters: ManagementFilters
): Promise<Page<LiveHcSupplierInwardRow>> {
  const { page, pageSize } = normalizeManagementPage(filters);
  const { whereSql, params } = buildWhereClause(scope, filters, 'arrival_date', 'zmcc_id');

  const countQuery = `SELECT COUNT(*)::text as count FROM vw_hc_supplier_inward_feed WHERE ${whereSql}`;
  const countRes = (await prisma.$queryRawUnsafe(countQuery, ...params)) as { count: string }[];
  const total = Number(countRes[0]?.count || 0);

  const offset = (page - 1) * pageSize;
  const dataQuery = `
    SELECT * FROM vw_hc_supplier_inward_feed
    WHERE ${whereSql}
    ORDER BY arrival_date DESC, arrival_id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const rawRows = (await prisma.$queryRawUnsafe(dataQuery, ...params)) as any[];

  const items: LiveHcSupplierInwardRow[] = rawRows.map((r) => ({
    arrival_id: r.arrival_id.toString(),
    zmcc_id: r.zmcc_id.toString(),
    zmcc_code: r.zmcc_code,
    zmcc_name: r.zmcc_name,
    arrival_date: r.arrival_date instanceof Date ? r.arrival_date.toISOString().split('T')[0] : String(r.arrival_date),
    arrival_timestamp: new Date(r.arrival_timestamp).toISOString(),
    zmcc_token: r.zmcc_token,
    raw_milk_token_number: r.raw_milk_token_number,
    arrival_rmr_number: r.arrival_rmr_number,
    vehicle_number: r.vehicle_number,
    local_supplier_id: r.local_supplier_id.toString(),
    local_supplier_code: r.local_supplier_code,
    supplier_name: r.supplier_name,
    supplier_phone: r.supplier_phone,
    supplier_cnic: r.supplier_cnic,
    supplier_active: Boolean(r.supplier_active),
    lab_session_id: r.lab_session_id ? r.lab_session_id.toString() : null,
    lab_status: r.lab_status,
    lab_decision: r.lab_decision,
    final_decision: r.final_decision,
    accepted_gross_liters: r.accepted_gross_liters != null ? Number(r.accepted_gross_liters) : null,
    density: r.density != null ? Number(r.density) : null,
    snf: r.snf != null ? Number(r.snf) : null,
    ts: r.ts != null ? Number(r.ts) : null,
    at_13ts_liters: r.at_13ts_liters != null ? Number(r.at_13ts_liters) : null,
    lab_completed_at: r.lab_completed_at ? new Date(r.lab_completed_at).toISOString() : null,
    rmr_id: r.rmr_id ? r.rmr_id.toString() : null,
    rmr_year: r.rmr_year != null ? Number(r.rmr_year) : null,
    rmr_series: r.rmr_series,
    rmr_book_number: r.rmr_book_number,
    rmr_receipt_number: r.rmr_receipt_number,
    rmr_quantity_value: r.rmr_quantity_value != null ? Number(r.rmr_quantity_value) : null,
    rmr_status: r.rmr_status,
    rmr_issued_at: r.rmr_issued_at ? new Date(r.rmr_issued_at).toISOString() : null,
  }));

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * 3. Daily Route & ZMCC Procurement Rollup (Materialized View with B-Tree Indexes)
 * Returns pre-aggregated weighted averages (Average Fat %, Average LR, Average SNF %) in < 5ms.
 */
export async function getDailyProcurementRollup(
  scope: ManagementScope,
  filters: ManagementFilters
): Promise<DailyProcurementRollupRow[]> {
  const { whereSql, params } = buildWhereClause(scope, filters, 'operational_date', 'zmcc_id');

  const query = `
    SELECT * FROM mv_daily_procurement_rollup
    WHERE ${whereSql}
    ORDER BY operational_date DESC, total_gross_liters DESC
  `;
  const rawRows = (await prisma.$queryRawUnsafe(query, ...params)) as any[];

  return rawRows.map((r) => ({
    zmcc_id: r.zmcc_id.toString(),
    zmcc_code: r.zmcc_code,
    zmcc_name: r.zmcc_name,
    operational_date: r.operational_date instanceof Date ? r.operational_date.toISOString().split('T')[0] : String(r.operational_date),
    route_id: r.route_id.toString(),
    route_code: r.route_code,
    route_name: r.route_name,
    journey_count: Number(r.journey_count || 0),
    total_shop_collections: Number(r.total_shop_collections || 0),
    total_gross_liters: Number(r.total_gross_liters || 0),
    total_at_13ts_liters: Number(r.total_at_13ts_liters || 0),
    avg_fat_percentage: r.avg_fat_percentage != null ? Number(r.avg_fat_percentage) : null,
    avg_lr_reading: r.avg_lr_reading != null ? Number(r.avg_lr_reading) : null,
    avg_snf_percentage: r.avg_snf_percentage != null ? Number(r.avg_snf_percentage) : null,
  }));
}

/**
 * 4. Plant Transit Reconciliation & QA Comparison (Materialized View with B-Tree Indexes)
 */
export async function getPlantTransitReconciliation(
  scope: ManagementScope,
  filters: ManagementFilters
): Promise<Page<PlantTransitReconciliationRow>> {
  const { page, pageSize } = normalizeManagementPage(filters);
  const { whereSql, params } = buildWhereClause(scope, filters, 'operational_date', 'zmcc_id');

  const countQuery = `SELECT COUNT(*)::text as count FROM mv_plant_transit_reconciliation WHERE ${whereSql}`;
  const countRes = (await prisma.$queryRawUnsafe(countQuery, ...params)) as { count: string }[];
  const total = Number(countRes[0]?.count || 0);

  const offset = (page - 1) * pageSize;
  const dataQuery = `
    SELECT * FROM mv_plant_transit_reconciliation
    WHERE ${whereSql}
    ORDER BY operational_date DESC, visit_id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const rawRows = (await prisma.$queryRawUnsafe(dataQuery, ...params)) as any[];

  const items: PlantTransitReconciliationRow[] = rawRows.map((r) => ({
    visit_id: r.visit_id.toString(),
    visit_number: r.visit_number,
    reception_number: r.reception_number,
    vehicle_number: r.vehicle_number,
    zmcc_id: r.zmcc_id ? r.zmcc_id.toString() : '',
    zmcc_code: r.zmcc_code || '',
    zmcc_name: r.zmcc_name || '',
    operational_date: r.operational_date ? (r.operational_date instanceof Date ? r.operational_date.toISOString().split('T')[0] : String(r.operational_date)) : null,
    current_status: r.current_status,
    dispatch_gross_liters: r.dispatch_gross_liters != null ? Number(r.dispatch_gross_liters) : null,
    dispatch_fat: r.dispatch_fat != null ? Number(r.dispatch_fat) : null,
    dispatch_lr: r.dispatch_lr != null ? Number(r.dispatch_lr) : null,
    dispatch_snf: r.dispatch_snf != null ? Number(r.dispatch_snf) : null,
    dispatch_at_13ts_liters: r.dispatch_at_13ts_liters != null ? Number(r.dispatch_at_13ts_liters) : null,
    sent_gross_liters: r.sent_gross_liters != null ? Number(r.sent_gross_liters) : null,
    received_gross_liters: r.received_gross_liters != null ? Number(r.received_gross_liters) : null,
    gross_variance_liters: r.gross_variance_liters != null ? Number(r.gross_variance_liters) : null,
    gross_variance_percent: r.gross_variance_percent != null ? Number(r.gross_variance_percent) : null,
    sent_at_13ts_liters: r.sent_at_13ts_liters != null ? Number(r.sent_at_13ts_liters) : null,
    received_at_13ts_liters: r.received_at_13ts_liters != null ? Number(r.received_at_13ts_liters) : null,
    at_13ts_variance_liters: r.at_13ts_variance_liters != null ? Number(r.at_13ts_variance_liters) : null,
    at_13ts_variance_percent: r.at_13ts_variance_percent != null ? Number(r.at_13ts_variance_percent) : null,
    reconciled_at: r.reconciled_at ? new Date(r.reconciled_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
  }));

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ============================================================================
// 4. NON-BLOCKING MATERIALIZED VIEW REFRESH
// ============================================================================

/**
 * Concurrent non-blocking refresh of analytical materialized views.
 * Readers continue querying the current snapshot with 0ms interruption.
 */
export async function refreshProcurementMaterializedViews(): Promise<{
  success: boolean;
  refreshedAt: string;
  durationMs: number;
}> {
  const start = Date.now();
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_procurement_rollup;`);
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_plant_transit_reconciliation;`);
  return {
    success: true,
    refreshedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
