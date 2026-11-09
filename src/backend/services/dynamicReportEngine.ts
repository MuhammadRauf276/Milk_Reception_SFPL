import { LIVE_PLANT_TRANSIT_SQL } from './liveReportSql';
import { getBatchTankPhysicalStock, getBatchTankTodayMovements } from '@/backend/services/zmccTankService';
import { prisma } from '@core/db';
import type { User } from '@core/types';
import { canActAs } from '@core/roles/hierarchy';
import { getPakistanCalendarDate, getPakistanDayWindow } from '@core/business-day';
import ExcelJS from 'exceljs';
import { isTemperatureTest } from '@/lib/lab-test-roles';
import { loadSystemRoles, type PolicyDb } from '@/backend/services/testPointPolicyService';
import type {
  ReportDomain,
  ReportFieldDefinition,
  DynamicFilterClause,
  DynamicQueryRequest,
  DynamicQueryResponse,
  DynamicSummaryKpi,
  GroupedSubtotal,
  SavedReportTemplate,
  DynamicExportRequest,
} from '@/frontend/modules/dashboard/reports/dynamicReportTypes';

// ============================================================================
// 1. FIELD CATALOGS BY DOMAIN
// ============================================================================

export const MOT_COLLECTIONS_FIELDS: ReportFieldDefinition[] = [
  { id: 'collection_number', label: 'Collection #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'operational_date', label: 'Operational Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'route_code', label: 'Route Code', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'route_name', label: 'Route Name', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'shop_code', label: 'Shop Code', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'shop_name', label: 'Shop Name', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'owner_name', label: 'Shop Owner', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: false, sortable: true, filterable: true },
  { id: 'mot_name', label: 'MOT Driver', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'vehicle_number', label: 'MOT Vehicle', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: false, sortable: true, filterable: true },
  { id: 'gross_liters', label: 'Gross Liters', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] },
  { id: 'at_13ts_liters', label: '13% TS Liters', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'fat', label: 'Fat %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'lr', label: 'LR', category: 'QUALITY', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'snf', label: 'SNF %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'density', label: 'Density (g/ml)', category: 'QUALITY', dataType: 'number', format: 'number', align: 'right', defaultSelected: false, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'final_decision', label: 'Lab Decision', category: 'QUALITY', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['ACCEPTED', 'REJECTED', 'FLAGGED', 'CONDITIONAL'] },
  { id: 'device_collected_at', label: 'Collection Timestamp', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
  { id: 'collection_latitude', label: 'GPS Latitude', category: 'GEOLOCATION', dataType: 'number', format: 'number', align: 'right', defaultSelected: false, sortable: false, filterable: false },
  { id: 'collection_longitude', label: 'GPS Longitude', category: 'GEOLOCATION', dataType: 'number', format: 'number', align: 'right', defaultSelected: false, sortable: false, filterable: false },
  { id: 'shop_rmr_number', label: 'Manual RMR #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: false, sortable: true, filterable: true },
  { id: 'collection_notes', label: 'Notes & Remarks', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: false, sortable: false, filterable: true },
];

export const HC_SUPPLIERS_FIELDS: ReportFieldDefinition[] = [
  { id: 'zmcc_token', label: 'Token #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'arrival_date', label: 'Arrival Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'arrival_timestamp', label: 'Arrival Time', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: true, sortable: true, filterable: true },
  { id: 'supplier_code', label: 'Supplier Code', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'supplier_name', label: 'Supplier Name', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'phone', label: 'Phone Number', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: false, sortable: false, filterable: true },
  { id: 'vehicle_number', label: 'Vehicle #', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'gross_liters', label: 'Gross Liters', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'fat', label: 'Fat %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'lr', label: 'LR', category: 'QUALITY', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'snf', label: 'SNF %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'temperature_c', label: 'Temperature (°C)', category: 'QUALITY', dataType: 'number', format: 'temperature', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MAX'] },
  { id: 'decision', label: 'Lab Decision', category: 'QUALITY', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['ACCEPTED', 'REJECTED', 'PENDING'] },
  { id: 'rmr_number', label: 'RMR Receipt #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'rmr_status', label: 'RMR Status', category: 'IDENTIFICATION', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['ISSUED', 'RECORDED', 'CANCELLED', 'PENDING'] },
];

export const JOURNEY_RECONCILIATION_FIELDS: ReportFieldDefinition[] = [
  { id: 'journey_number', label: 'Journey #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'operational_date', label: 'Operational Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'route_code', label: 'Route Code', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'route_name', label: 'Route Name', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'mot_name', label: 'MOT Driver', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'vehicle_number', label: 'Vehicle #', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'status', label: 'Status', category: 'OPERATIONAL', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['COLLECTING', 'RETURNED_TO_ZMCC', 'COMPLETED', 'CANCELLED'] },
  { id: 'planned_stops', label: 'Planned Stops', category: 'OPERATIONAL', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'visited_stops', label: 'Visited Stops', category: 'OPERATIONAL', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'completion_rate', label: 'Completion %', category: 'OPERATIONAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'shop_liters', label: 'Shop Collected (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'gate_liters', label: 'Gate Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'loss_liters', label: 'Route Loss (L)', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'loss_pct', label: 'Route Loss %', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'dispatched_at', label: 'Dispatched At', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
  { id: 'returned_at', label: 'Returned At', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
];

export const TANK_STORAGE_FIELDS: ReportFieldDefinition[] = [
  { id: 'tank_code', label: 'Tank Code', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'tank_name', label: 'Tank Name', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'capacity_liters', label: 'Capacity (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'current_stock_liters', label: 'Current Stock (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'fill_pct', label: 'Fill %', category: 'VOLUMES', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'current_temp_c', label: 'Temperature (°C)', category: 'QUALITY', dataType: 'number', format: 'temperature', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MAX'] },
  { id: 'today_receipts_liters', label: 'Today Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'today_dispatches_liters', label: 'Today Dispatched (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'holding_hours', label: 'Holding (Hrs)', category: 'TIMING', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MAX'] },
  { id: 'is_active', label: 'Operational State', category: 'OPERATIONAL', dataType: 'boolean', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true },
];

export const PLANT_TRANSIT_FIELDS: ReportFieldDefinition[] = [
  { id: 'dispatch_note_number', label: 'Dispatch Slip #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'dispatch_date', label: 'Dispatch Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'vehicle_number', label: 'Tanker Vehicle', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'contractor_name', label: 'Contractor', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'dispatched_liters', label: 'Dispatched Gross (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'dispatched_13ts_liters', label: 'Dispatched 13% TS (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'plant_received_liters', label: 'Plant Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'transit_loss_liters', label: 'Transit Loss (L)', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'transit_loss_pct', label: 'Transit Loss %', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'status', label: 'Status', category: 'OPERATIONAL', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['IN_TRANSIT', 'RECEIVED_AT_PLANT', 'RECONCILED', 'FLAGGED'] },
];

export const QUALITY_SCREENING_FIELDS: ReportFieldDefinition[] = [
  { id: 'sample_token', label: 'Token #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'source_type', label: 'Origin Source', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'test_date', label: 'Test Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'tested_at', label: 'Timestamp', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: true, sortable: true, filterable: true },
  { id: 'gross_liters', label: 'Gross Liters', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'fat', label: 'Fat %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'lr', label: 'LR', category: 'QUALITY', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'snf', label: 'SNF %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'temperature_c', label: 'Temperature (°C)', category: 'QUALITY', dataType: 'number', format: 'temperature', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MAX'] },
  { id: 'decision', label: 'Final Decision', category: 'QUALITY', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['ACCEPTED', 'REJECTED', 'FLAGGED'] },
  { id: 'exception_reason', label: 'Rejection Reason', category: 'QUALITY', dataType: 'string', format: 'text', defaultSelected: true, sortable: false, filterable: true },
];

export const DOMAIN_FIELD_MAP: Record<ReportDomain, ReportFieldDefinition[]> = {
  MOT_COLLECTIONS: MOT_COLLECTIONS_FIELDS,
  HC_SUPPLIERS: HC_SUPPLIERS_FIELDS,
  JOURNEY_RECONCILIATION: JOURNEY_RECONCILIATION_FIELDS,
  TANK_STORAGE: TANK_STORAGE_FIELDS,
  PLANT_TRANSIT: PLANT_TRANSIT_FIELDS,
  QUALITY_SCREENING: QUALITY_SCREENING_FIELDS,
};

// ============================================================================
// 2. SYSTEM STANDARD PRESETS
// ============================================================================

export const SYSTEM_DEFAULT_TEMPLATES: SavedReportTemplate[] = [
  {
    id: 'sys-preset-route-quality',
    name: 'Daily Route Milk Quality & Tier-1 Loss',
    description: 'Comprehensive route collections with shop-level Fat, LR, SNF, and At 13% TS volumes.',
    domain: 'MOT_COLLECTIONS',
    selectedFieldIds: ['collection_number', 'operational_date', 'route_name', 'shop_name', 'gross_liters', 'at_13ts_liters', 'fat', 'lr', 'snf', 'final_decision'],
    filters: [],
    groupByFieldId: 'route_name',
    sortFieldId: 'operational_date',
    sortDirection: 'desc',
    isSystemDefault: true,
  },
  {
    id: 'sys-preset-hc-inward',
    name: 'Local HC Supplier Direct Intake & RMR Audit',
    description: 'Direct farmer milk receipts with physical tokens, lab results, and RMR slip tracking.',
    domain: 'HC_SUPPLIERS',
    selectedFieldIds: ['zmcc_token', 'arrival_date', 'supplier_code', 'supplier_name', 'gross_liters', 'fat', 'lr', 'snf', 'temperature_c', 'decision', 'rmr_number', 'rmr_status'],
    filters: [],
    groupByFieldId: 'arrival_date',
    sortFieldId: 'arrival_timestamp',
    sortDirection: 'desc',
    isSystemDefault: true,
  },
  {
    id: 'sys-preset-journey-reconciliation',
    name: 'MOT Journey Reconciliation & Stop Adherence',
    description: 'Journey run audits: planned vs visited shops, gate reception volumes, and Tier-1 route losses.',
    domain: 'JOURNEY_RECONCILIATION',
    selectedFieldIds: ['journey_number', 'operational_date', 'route_name', 'mot_name', 'planned_stops', 'visited_stops', 'completion_rate', 'shop_liters', 'gate_liters', 'loss_liters', 'loss_pct', 'status'],
    filters: [],
    groupByFieldId: 'route_name',
    sortFieldId: 'operational_date',
    sortDirection: 'desc',
    isSystemDefault: true,
  },
  {
    id: 'sys-preset-low-fat',
    name: 'Low Fat Quality Exception Audit (< 3.5% Fat)',
    description: 'Ad-hoc quality alert identifying all collection stops below the 3.50% fat threshold.',
    domain: 'MOT_COLLECTIONS',
    selectedFieldIds: ['collection_number', 'operational_date', 'route_name', 'shop_code', 'shop_name', 'mot_name', 'gross_liters', 'fat', 'lr', 'snf', 'final_decision'],
    filters: [
      { id: 'f-1', fieldId: 'fat', operator: 'LESS_THAN', value: 3.5 },
    ],
    groupByFieldId: 'route_name',
    sortFieldId: 'fat',
    sortDirection: 'asc',
    isSystemDefault: true,
  },
  {
    id: 'sys-preset-tank-stock',
    name: 'ZMCC Silo Tanks Utilization & Inventory',
    description: 'Physical silo stock, capacity utilization percentage, chilling temperatures, and CIP state.',
    domain: 'TANK_STORAGE',
    selectedFieldIds: ['tank_code', 'tank_name', 'capacity_liters', 'current_stock_liters', 'fill_pct', 'current_temp_c', 'today_receipts_liters', 'today_dispatches_liters', 'holding_hours', 'is_active'],
    filters: [],
    sortFieldId: 'tank_code',
    sortDirection: 'asc',
    isSystemDefault: true,
  },
  {
    id: 'sys-preset-plant-transit',
    name: 'Plant Tanker Transit Discrepancy & Loss',
    description: 'Dispatch slips to Plant, comparing dispatched liters against received liters and transit losses.',
    domain: 'PLANT_TRANSIT',
    selectedFieldIds: ['dispatch_note_number', 'dispatch_date', 'vehicle_number', 'contractor_name', 'dispatched_liters', 'plant_received_liters', 'transit_loss_liters', 'transit_loss_pct', 'status'],
    filters: [],
    sortFieldId: 'dispatch_date',
    sortDirection: 'desc',
    isSystemDefault: true,
  },
];

// ============================================================================
// 3. DYNAMIC QUERY EXECUTOR
// ============================================================================

export async function executeDynamicReportQuery(
  req: DynamicQueryRequest,
  currentUser: User | null
): Promise<DynamicQueryResponse> {
  const { domain, selectedFieldIds, filters, groupByFieldId, sortFieldId, sortDirection, page = 1, pageSize = 20, zmccId } = req;

  const isSystemScope =
    currentUser?.role === 'HEAD_OF_MPD' ||
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'DATA_EXECUTIVE' ||
    currentUser?.role === 'EXECUTIVE_MANAGEMENT';

  let effectiveZmccId: bigint | undefined = undefined;
  if (isSystemScope) {
    if (zmccId && zmccId !== 'ALL' && /^\d+$/.test(zmccId)) {
      effectiveZmccId = BigInt(zmccId);
    }
  } else if (currentUser?.procurement_source_id) {
    effectiveZmccId = BigInt(currentUser.procurement_source_id);
  }

  const allDomainFields = DOMAIN_FIELD_MAP[domain] || MOT_COLLECTIONS_FIELDS;
  const activeFields = allDomainFields.filter((f) => selectedFieldIds.includes(f.id));

  let rawRows: Record<string, any>[] = [];
  let totalCount = 0;
  // KPI figures across the whole filter, never just the current page.
  let kpiTotals: DomainKpiTotals = {};

  // --------------------------------------------------------------------------
  // DOMAIN 1: MOT_COLLECTIONS
  // --------------------------------------------------------------------------
  if (domain === 'MOT_COLLECTIONS') {
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;

    for (const flt of filters) {
      applyCollectionFilter(where, flt);
    }

    const [count, totals, records] = await Promise.all([
      prisma.motShopCollection.count({ where }),
      getCollectionKpiTotals(where),
      prisma.motShopCollection.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: getOrderByClause(sortFieldId, sortDirection, 'device_collected_at'),
        include: {
          route: { select: { route_code: true, name: true } },
          shop: { select: { shop_code: true, shop_name: true, owner_name: true } },
          mot_profile: { select: { name: true } },
          mot_vehicle: { select: { vehicle_number: true } },
        },
      }),
    ]);

    totalCount = count;
    kpiTotals = totals;
    rawRows = records.map((r) => ({
      id: r.id.toString(),
      collection_number: r.collection_number,
      operational_date: r.operational_date.toISOString().split('T')[0],
      route_code: r.route?.route_code || '—',
      route_name: r.route?.name || '—',
      shop_code: r.shop?.shop_code || '—',
      shop_name: r.shop?.shop_name || '—',
      owner_name: r.shop?.owner_name || '—',
      mot_name: r.mot_profile?.name || '—',
      vehicle_number: r.mot_vehicle?.vehicle_number || '—',
      gross_liters: r.gross_liters ? Number(r.gross_liters) : 0,
      at_13ts_liters: r.at_13ts_liters ? Number(r.at_13ts_liters) : 0,
      fat: r.fat ? Number(r.fat) : null,
      lr: r.lr ? Number(r.lr) : null,
      snf: r.snf ? Number(r.snf) : null,
      density: r.density ? Number(r.density) : null,
      final_decision: r.final_decision || 'ACCEPTED',
      device_collected_at: r.device_collected_at ? r.device_collected_at.toISOString() : null,
      collection_latitude: r.collection_latitude ? Number(r.collection_latitude) : null,
      collection_longitude: r.collection_longitude ? Number(r.collection_longitude) : null,
      shop_rmr_number: r.shop_rmr_number || '—',
      collection_notes: r.collection_notes || '',
    }));
  }

  // --------------------------------------------------------------------------
  // DOMAIN 2: HC_SUPPLIERS
  // --------------------------------------------------------------------------
  else if (domain === 'HC_SUPPLIERS') {
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;

    for (const flt of filters) {
      applyHcFilter(where, flt);
    }

    const [count, hcKpiSessions, records] = await Promise.all([
      prisma.zmccLocalSupplierArrival.count({ where }),
      // LR and Fat live in lab result rows, so the weighted figures cannot be a single SQL aggregate here.
      prisma.zmccLocalSupplierArrival.findMany({
        where,
        select: {
          lab_session: {
            select: {
              gross_liters: true,
              snf: true,
              results: { select: { test_id: true, test_code_snapshot: true, test_name_snapshot: true, numeric_value: true } },
            },
          },
        },
      }),
      prisma.zmccLocalSupplierArrival.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: getOrderByClause(sortFieldId, sortDirection, 'arrival_timestamp'),
        include: {
          local_supplier: { select: { local_supplier_code: true, name: true, phone: true } },
          lab_session: {
            select: {
              status: true,
              decision: true,
              gross_liters: true,
              density: true,
              snf: true,
              results: { select: { test_id: true, test_code_snapshot: true, test_name_snapshot: true, numeric_value: true } },
            },
          },
          rmr_issuance: {
            select: { series: true, book_number: true, receipt_number: true, rmr_year: true, cancelled_at: true },
          },
        },
      }),
    ]);

    totalCount = count;
    const roles = await loadSystemRoles(prisma as unknown as PolicyDb);
    const hasFatRole = [...roles.values()].includes('FAT');
    const hasLrRole = [...roles.values()].includes('LR');
    const readResults = (results: LabResultRow[] | undefined) => {
      let fat: number | null = null;
      let lr: number | null = null;
      let temp: number | null = null;
      for (const res of results ?? []) {
        const code = res.test_code_snapshot.toUpperCase();
        const num = res.numeric_value ? Number(res.numeric_value) : null;
        const role = roles.get(String(res.test_id));
        if (role === 'FAT' || (!hasFatRole && code.includes('FAT'))) fat = num;
        else if (role === 'LR' || (!hasLrRole && (code.includes('LR') || code.includes('CLR')))) lr = num;
        else if (isTemperatureTest({ testCode: code, testName: res.test_name_snapshot, systemRole: role })) temp = num;
      }
      return { fat, lr, temp };
    };

    const hcKpiRows = hcKpiSessions.flatMap((a) => {
      if (!a.lab_session) return [];
      const liters = a.lab_session.gross_liters != null ? Number(a.lab_session.gross_liters) : 0;
      const { fat, lr } = readResults(a.lab_session.results);
      return [{ liters, fat, lr, snf: a.lab_session.snf != null ? Number(a.lab_session.snf) : null }];
    });
    kpiTotals = {
      grossLiters: hcKpiRows.length > 0 ? hcKpiRows.reduce((sum, r) => sum + r.liters, 0) : null,
      avgFat: weightedAverage(hcKpiRows.map((r) => [r.fat, r.liters])),
      avgLr: weightedAverage(hcKpiRows.map((r) => [r.lr, r.liters])),
      avgSnf: weightedAverage(hcKpiRows.map((r) => [r.snf, r.liters])),
    };

    rawRows = records.map((a) => {
      const { fat: fatVal, lr: lrVal, temp: tempVal } = readResults(a.lab_session?.results);

      const rmrStr = a.rmr_issuance
        ? a.rmr_issuance.series
          ? `${a.rmr_issuance.series}-${a.rmr_issuance.rmr_year}-${a.rmr_issuance.book_number}-${a.rmr_issuance.receipt_number}`
          : a.rmr_issuance.receipt_number
        : a.rmr_number || null;

      const rmrStatus = a.rmr_issuance?.cancelled_at
        ? 'CANCELLED'
        : a.rmr_issuance
        ? 'ISSUED'
        : a.rmr_number
        ? 'RECORDED'
        : 'PENDING';

      return {
        id: a.id.toString(),
        zmcc_token: a.zmcc_token,
        arrival_date: a.arrival_date.toISOString().split('T')[0],
        arrival_timestamp: a.arrival_timestamp.toISOString(),
        supplier_code: a.local_supplier?.local_supplier_code || '—',
        supplier_name: a.local_supplier?.name || '—',
        phone: a.local_supplier?.phone || '—',
        vehicle_number: a.vehicle_number,
        gross_liters: a.lab_session?.gross_liters ? Number(a.lab_session.gross_liters) : 0,
        fat: fatVal,
        lr: lrVal,
        snf: a.lab_session?.snf ? Number(a.lab_session.snf) : null,
        temperature_c: tempVal,
        decision: a.lab_session?.decision || 'PENDING',
        rmr_number: rmrStr || '—',
        rmr_status: rmrStatus,
      };
    });
  }

  // --------------------------------------------------------------------------
  // DOMAIN 3: JOURNEY_RECONCILIATION
  // --------------------------------------------------------------------------
  else if (domain === 'JOURNEY_RECONCILIATION') {
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;

    for (const flt of filters) {
      applyJourneyFilter(where, flt);
    }

    const [count, totals, records] = await Promise.all([
      prisma.motJourney.count({ where }),
      getJourneyKpiTotals(where),
      prisma.motJourney.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: getOrderByClause(sortFieldId, sortDirection, 'assigned_at'),
        include: {
          route: { select: { route_code: true, name: true } },
          mot_profile: { select: { name: true } },
          mot_vehicle: { select: { vehicle_number: true } },
          mot_arrival: { select: { arrival_timestamp: true } },
          _count: { select: { stops: true, collections: true } },
          collections: { select: { gross_liters: true, final_decision: true } },
        },
      }),
    ]);

    totalCount = count;
    kpiTotals = totals;
    rawRows = records.map((j) => {
      // Rejected milk never travels to the ZMCC, so it is not part of the loss comparison.
      const shopLiters = j.collections
        .filter((c) => c.final_decision !== 'REJECTED')
        .reduce((sum, c) => sum + Number(c.gross_liters), 0);
      // Not received yet: gate litres and loss are unknown, not zero.
      const gateLiters = j.area_received_liters != null ? Number(j.area_received_liters) : null;
      const lossLit = gateLiters !== null ? Number((shopLiters - gateLiters).toFixed(2)) : null;
      const lossPct = lossLit !== null && shopLiters > 0 ? Number(((lossLit / shopLiters) * 100).toFixed(2)) : null;

      const planned = j._count.stops;
      const visited = j._count.collections;
      const completionRate = planned > 0 ? Number(((visited / planned) * 100).toFixed(1)) : 100;

      return {
        id: j.id.toString(),
        journey_number: j.journey_number,
        operational_date: j.operational_date.toISOString().split('T')[0],
        route_code: j.route?.route_code || '—',
        route_name: j.route?.name || '—',
        mot_name: j.mot_profile?.name || '—',
        vehicle_number: j.mot_vehicle?.vehicle_number || '—',
        status: j.status,
        planned_stops: planned,
        visited_stops: visited,
        completion_rate: completionRate,
        shop_liters: Number(shopLiters.toFixed(2)),
        gate_liters: gateLiters !== null ? Number(gateLiters.toFixed(2)) : null,
        loss_liters: lossLit,
        loss_pct: lossPct,
        dispatched_at: j.assigned_at.toISOString(),
        returned_at: j.mot_arrival?.arrival_timestamp?.toISOString() || null,
      };
    });
  }

  // --------------------------------------------------------------------------
  // DOMAIN 4: TANK_STORAGE
  // --------------------------------------------------------------------------
  else if (domain === 'TANK_STORAGE') {
    const where: any = { is_active: true };
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;

    const [count, records] = await Promise.all([
      prisma.zmccTank.count({ where }),
      prisma.zmccTank.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { tank_code: 'asc' },
      }),
    ]);

    const tankIds = records.map((t) => t.id);
    const [physicalStocks, todayMovements] = await Promise.all([
      getBatchTankPhysicalStock(tankIds),
      getBatchTankTodayMovements(tankIds, getPakistanDayWindow().start),
    ]);

    totalCount = count;
    rawRows = records.map((t) => {
      const cap = Number(t.capacity_liters);
      const today = todayMovements.get(t.id.toString());
      const stock = Number((physicalStocks.get(t.id.toString()) ?? 0).toFixed(2));
      const fillPct = cap > 0 ? Number(((stock / cap) * 100).toFixed(1)) : 0;

      return {
        id: t.id.toString(),
        tank_code: t.tank_code,
        tank_name: t.tank_name,
        capacity_liters: cap,
        current_stock_liters: stock,
        fill_pct: fillPct,
        current_temp_c: null,
        today_receipts_liters: Number((today?.received ?? 0).toFixed(2)),
        today_dispatches_liters: Number((today?.dispatched ?? 0).toFixed(2)),
        holding_hours: null,
        is_active: t.is_active,
      };
    });
  }

  // --------------------------------------------------------------------------
  // DOMAIN 5: PLANT_TRANSIT (read live, so new tankers show without a manual refresh)
  // --------------------------------------------------------------------------
  else if (domain === 'PLANT_TRANSIT') {
    // A failed query throws to the caller: it must show as an error, never as made-up rows.
    const conditions = ['1=1'];
    const params: any[] = [];
    let pIdx = 1;

    if (effectiveZmccId) {
      conditions.push(`zmcc_id = $${pIdx++}`);
      params.push(effectiveZmccId);
    }

    const countRes = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text as count FROM ${LIVE_PLANT_TRANSIT_SQL} WHERE ${conditions.join(' AND ')}`,
      ...params
    )) as { count: string }[];
    totalCount = Number(countRes[0]?.count || 0);

    const offset = (page - 1) * pageSize;
    const records = (await prisma.$queryRawUnsafe(
      `SELECT * FROM ${LIVE_PLANT_TRANSIT_SQL} WHERE ${conditions.join(' AND ')} ORDER BY operational_date DESC NULLS LAST, visit_id DESC LIMIT ${pageSize} OFFSET ${offset}`,
      ...params
    )) as any[];

    const optionalNumber = (value: unknown) => (value != null ? Number(value) : null);
    rawRows = records.map((r) => {
      // The stored variance is received minus sent, so a negative value is a loss and a gain is no loss.
      const variance = optionalNumber(r.gross_variance_liters);
      const variancePct = optionalNumber(r.gross_variance_percent);

      return {
        id: r.visit_id.toString(),
        dispatch_note_number: r.visit_number || `DSP-${r.visit_id}`,
        dispatch_date: r.operational_date ? (r.operational_date instanceof Date ? r.operational_date.toISOString().split('T')[0] : String(r.operational_date)) : null,
        vehicle_number: r.vehicle_number || '—',
        contractor_name: r.zmcc_name || '—',
        dispatched_liters: optionalNumber(r.dispatch_gross_liters ?? r.sent_gross_liters),
        dispatched_13ts_liters: optionalNumber(r.dispatch_at_13ts_liters ?? r.sent_at_13ts_liters),
        plant_received_liters: optionalNumber(r.received_gross_liters),
        transit_loss_liters: variance !== null ? Math.max(0, -variance) : null,
        transit_loss_pct: variancePct !== null ? Math.max(0, -variancePct) : null,
        status: r.current_status === 'COMPLETED' ? 'RECONCILED' : (r.current_status || 'IN_TRANSIT'),
      };
    });
  }

  // --------------------------------------------------------------------------
  // DOMAIN 6: QUALITY_SCREENING
  // --------------------------------------------------------------------------
  else {
    const where: any = { final_decision: { in: ['ACCEPTED', 'REJECTED'] } };
    if (effectiveZmccId) where.lab_session = { zmcc_id: effectiveZmccId };

    for (const flt of filters) {
      applyQualityFilter(where, flt);
    }

    const labResultSelect = { test_id: true, test_code_snapshot: true, test_name_snapshot: true, numeric_value: true } as const;
    const [count, totals, records] = await Promise.all([
      prisma.zmccLabPortion.count({ where }),
      getQualityKpiTotals(where),
      prisma.zmccLabPortion.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: getOrderByClause(sortFieldId, sortDirection, 'decided_at'),
        include: {
          results: { select: labResultSelect },
          lab_session: {
            select: {
              id: true,
              arrival_type: true,
              rejection_reason: true,
              // Session-level results only: the portion's own results are loaded above.
              results: { where: { portion_id: null }, select: labResultSelect },
              mot_arrival: { select: { zmcc_token: true, journey: { select: { route: { select: { route_code: true } } } } } },
              local_supplier_arrival: { select: { zmcc_token: true, local_supplier: { select: { local_supplier_code: true } } } },
            },
          },
        },
      }),
    ]);

    totalCount = count;
    kpiTotals = totals;
    const roles = await loadSystemRoles(prisma as unknown as PolicyDb);
    const readTemperature = (results: LabResultRow[]) => {
      const match = results.find((res) =>
        isTemperatureTest({ testCode: res.test_code_snapshot.toUpperCase(), testName: res.test_name_snapshot, systemRole: roles.get(String(res.test_id)) })
      );
      return match?.numeric_value != null ? Number(match.numeric_value) : null;
    };
    const optionalNumber = (value: unknown) => (value != null ? Number(value) : null);

    rawRows = records.map((p) => {
      const session = p.lab_session;
      const testedAt = p.decided_at ?? p.created_at;
      const reasons = Array.isArray(p.exception_reasons) ? (p.exception_reasons as string[]).join(', ') : '';
      const routeCode = session.mot_arrival?.journey?.route?.route_code;
      const supplierCode = session.local_supplier_arrival?.local_supplier?.local_supplier_code;

      return {
        id: p.id.toString(),
        sample_token: session.mot_arrival?.zmcc_token ?? session.local_supplier_arrival?.zmcc_token ?? `S-${session.id}`,
        source_type: session.arrival_type === 'HC' ? `Direct HC (${supplierCode ?? '—'})` : `Route MOT (${routeCode ?? '—'})`,
        test_date: getPakistanCalendarDate(testedAt),
        tested_at: testedAt.toISOString(),
        gross_liters: optionalNumber(p.gross_liters),
        fat: optionalNumber(p.fat),
        lr: optionalNumber(p.lr),
        snf: optionalNumber(p.snf),
        temperature_c: readTemperature(p.results) ?? readTemperature(session.results),
        decision: p.final_decision,
        exception_reason: reasons || p.decision_remarks || session.rejection_reason || '—',
      };
    });
  }

  const summaryKpis = computeDynamicSummaryKpis(totalCount, kpiTotals);

  // Compute Grouped Subtotals if requested
  const groupedSubtotals = groupByFieldId
    ? computeGroupedSubtotals(rawRows, groupByFieldId, activeFields)
    : undefined;

  return {
    domain,
    fields: activeFields,
    rows: rawRows,
    totalRecords: totalCount,
    totalPages: Math.ceil(totalCount / pageSize) || 1,
    currentPage: page,
    pageSize,
    summaryKpis,
    groupedSubtotals,
  };
}

// ============================================================================
// 4. FILTER TRANSLATION HELPERS
// ============================================================================

function applyCollectionFilter(where: any, flt: DynamicFilterClause) {
  if (flt.value === undefined || flt.value === null || flt.value === '') return;

  if (flt.fieldId === 'operational_date') {
    const d = new Date(`${flt.value}T00:00:00.000Z`);
    if (flt.operator === 'EQUALS') where.operational_date = d;
    else if (flt.operator === 'BETWEEN' && flt.valueSecondary) {
      where.operational_date = {
        gte: new Date(`${flt.value}T00:00:00.000Z`),
        lte: new Date(`${flt.valueSecondary}T23:59:59.999Z`),
      };
    }
  } else if (flt.fieldId === 'fat' || flt.fieldId === 'lr' || flt.fieldId === 'snf' || flt.fieldId === 'gross_liters') {
    const num = Number(flt.value);
    if (!isNaN(num)) {
      if (flt.operator === 'GREATER_THAN') where[flt.fieldId] = { gt: num };
      else if (flt.operator === 'LESS_THAN') where[flt.fieldId] = { lt: num };
      else if (flt.operator === 'GREATER_EQUAL') where[flt.fieldId] = { gte: num };
      else if (flt.operator === 'LESS_EQUAL') where[flt.fieldId] = { lte: num };
      else if (flt.operator === 'EQUALS') where[flt.fieldId] = num;
    }
  } else if (flt.fieldId === 'final_decision') {
    where.final_decision = flt.value;
  } else if (flt.fieldId === 'route_name') {
    where.route = { name: { contains: String(flt.value), mode: 'insensitive' } };
  } else if (flt.fieldId === 'route_code') {
    where.route = { route_code: { contains: String(flt.value), mode: 'insensitive' } };
  } else if (flt.fieldId === 'shop_name') {
    where.shop = { shop_name: { contains: String(flt.value), mode: 'insensitive' } };
  } else if (flt.fieldId === 'shop_code') {
    where.shop = { shop_code: { contains: String(flt.value), mode: 'insensitive' } };
  }
}

function applyHcFilter(where: any, flt: DynamicFilterClause) {
  if (flt.value === undefined || flt.value === null || flt.value === '') return;

  if (flt.fieldId === 'arrival_date') {
    if (flt.operator === 'EQUALS') where.arrival_date = new Date(`${flt.value}T00:00:00.000Z`);
    else if (flt.operator === 'BETWEEN' && flt.valueSecondary) {
      where.arrival_date = {
        gte: new Date(`${flt.value}T00:00:00.000Z`),
        lte: new Date(`${flt.valueSecondary}T23:59:59.999Z`),
      };
    }
  } else if (flt.fieldId === 'supplier_name') {
    where.local_supplier = { name: { contains: String(flt.value), mode: 'insensitive' } };
  } else if (flt.fieldId === 'supplier_code') {
    where.local_supplier = { local_supplier_code: { contains: String(flt.value), mode: 'insensitive' } };
  } else if (flt.fieldId === 'decision') {
    where.lab_session = { decision: flt.value };
  }
}

function applyJourneyFilter(where: any, flt: DynamicFilterClause) {
  if (flt.value === undefined || flt.value === null || flt.value === '') return;

  if (flt.fieldId === 'operational_date') {
    if (flt.operator === 'EQUALS') where.operational_date = new Date(`${flt.value}T00:00:00.000Z`);
    else if (flt.operator === 'BETWEEN' && flt.valueSecondary) {
      where.operational_date = {
        gte: new Date(`${flt.value}T00:00:00.000Z`),
        lte: new Date(`${flt.valueSecondary}T23:59:59.999Z`),
      };
    }
  } else if (flt.fieldId === 'status') {
    where.status = flt.value;
  } else if (flt.fieldId === 'route_name') {
    where.route = { name: { contains: String(flt.value), mode: 'insensitive' } };
  }
}

function applyQualityFilter(where: any, flt: DynamicFilterClause) {
  if (flt.value === undefined || flt.value === null || flt.value === '') return;

  if (flt.fieldId === 'test_date') {
    const first = getPakistanDayWindow(String(flt.value));
    if (flt.operator === 'EQUALS') where.decided_at = { gte: first.start, lte: first.end };
    else if (flt.operator === 'BETWEEN' && flt.valueSecondary) {
      where.decided_at = { gte: first.start, lte: getPakistanDayWindow(String(flt.valueSecondary)).end };
    }
  } else if (flt.fieldId === 'decision') {
    where.final_decision = flt.value;
  } else if (flt.fieldId === 'fat' || flt.fieldId === 'lr' || flt.fieldId === 'snf' || flt.fieldId === 'gross_liters') {
    const num = Number(flt.value);
    if (!isNaN(num)) {
      if (flt.operator === 'GREATER_THAN') where[flt.fieldId] = { gt: num };
      else if (flt.operator === 'LESS_THAN') where[flt.fieldId] = { lt: num };
      else if (flt.operator === 'GREATER_EQUAL') where[flt.fieldId] = { gte: num };
      else if (flt.operator === 'LESS_EQUAL') where[flt.fieldId] = { lte: num };
      else if (flt.operator === 'EQUALS') where[flt.fieldId] = num;
    }
  }
}

function getOrderByClause(sortFieldId?: string, sortDirection?: 'asc' | 'desc', defaultField = 'created_at'): any {
  const dir = sortDirection === 'asc' ? 'asc' : 'desc';
  if (!sortFieldId) return { [defaultField]: dir };

  // Direct properties
  const directFields = ['operational_date', 'arrival_date', 'arrival_timestamp', 'gross_liters', 'fat', 'lr', 'snf', 'at_13ts_liters', 'assigned_at', 'status', 'tank_code'];
  if (directFields.includes(sortFieldId)) {
    return { [sortFieldId]: dir };
  }
  return { [defaultField]: dir };
}

// ============================================================================
// 5. SUMMARY KPI & GROUPING CALCULATORS
// ============================================================================

type LabResultRow = { test_id: bigint; test_code_snapshot: string; test_name_snapshot: string; numeric_value: unknown };

/** Whole-filter figures behind the KPI cards. Null or absent means there is nothing to show. */
interface DomainKpiTotals {
  grossLiters?: number | null;
  at13tsLiters?: number | null;
  avgFat?: number | null;
  avgLr?: number | null;
  avgSnf?: number | null;
  routeLossLiters?: number | null;
}

/** Volume-weighted average of (value, litres) pairs, ignoring missing values. Null when nothing is weighted. */
function weightedAverage(pairs: Array<[number | null, number]>): number | null {
  let sum = 0;
  let weight = 0;
  for (const [value, liters] of pairs) {
    if (value === null || !(liters > 0)) continue;
    sum += value * liters;
    weight += liters;
  }
  return weight > 0 ? sum / weight : null;
}

/** Litres grouped by each distinct reading (a bounded set), turned into a volume-weighted average. */
function weightedFromGroups(groups: any[], field: string): number | null {
  return weightedAverage(
    groups.map((g): [number | null, number] => [g[field] != null ? Number(g[field]) : null, Number(g._sum.gross_liters ?? 0)])
  );
}

async function getCollectionKpiTotals(where: any): Promise<DomainKpiTotals> {
  const [sums, byFat, byLr, bySnf] = await Promise.all([
    prisma.motShopCollection.aggregate({ where, _sum: { gross_liters: true, at_13ts_liters: true } }),
    prisma.motShopCollection.groupBy({ by: ['fat'], where, _sum: { gross_liters: true } }),
    prisma.motShopCollection.groupBy({ by: ['lr'], where, _sum: { gross_liters: true } }),
    prisma.motShopCollection.groupBy({ by: ['snf'], where, _sum: { gross_liters: true } }),
  ]);
  return {
    grossLiters: sums._sum.gross_liters != null ? Number(sums._sum.gross_liters) : null,
    at13tsLiters: sums._sum.at_13ts_liters != null ? Number(sums._sum.at_13ts_liters) : null,
    avgFat: weightedFromGroups(byFat, 'fat'),
    avgLr: weightedFromGroups(byLr, 'lr'),
    avgSnf: weightedFromGroups(bySnf, 'snf'),
  };
}

async function getQualityKpiTotals(where: any): Promise<DomainKpiTotals> {
  const [sums, byFat, byLr, bySnf] = await Promise.all([
    prisma.zmccLabPortion.aggregate({ where, _sum: { gross_liters: true } }),
    prisma.zmccLabPortion.groupBy({ by: ['fat'], where, _sum: { gross_liters: true } }),
    prisma.zmccLabPortion.groupBy({ by: ['lr'], where, _sum: { gross_liters: true } }),
    prisma.zmccLabPortion.groupBy({ by: ['snf'], where, _sum: { gross_liters: true } }),
  ]);
  return {
    grossLiters: sums._sum.gross_liters != null ? Number(sums._sum.gross_liters) : null,
    avgFat: weightedFromGroups(byFat, 'fat'),
    avgLr: weightedFromGroups(byLr, 'lr'),
    avgSnf: weightedFromGroups(bySnf, 'snf'),
  };
}

/** Route loss across journeys already received at the ZMCC: non-rejected shop litres minus received litres. */
async function getJourneyKpiTotals(where: any): Promise<DomainKpiTotals> {
  const received = { ...where, area_received_liters: { not: null } };
  const [shop, gate] = await Promise.all([
    prisma.motShopCollection.aggregate({
      where: { journey: received, final_decision: { not: 'REJECTED' } },
      _sum: { gross_liters: true },
    }),
    prisma.motJourney.aggregate({ where: received, _sum: { area_received_liters: true } }),
  ]);
  if (gate._sum.area_received_liters == null) return { routeLossLiters: null };
  return { routeLossLiters: Number(shop._sum.gross_liters ?? 0) - Number(gate._sum.area_received_liters) };
}

function computeDynamicSummaryKpis(totalCount: number, totals: DomainKpiTotals): DynamicSummaryKpi[] {
  const kpis: DynamicSummaryKpi[] = [];

  kpis.push({
    id: 'kpi-count',
    label: 'Total Records',
    value: totalCount,
    format: 'number',
  });

  // Volumes
  if (totals.grossLiters != null) {
    kpis.push({
      id: 'kpi-liters',
      label: 'Total Gross Liters',
      value: Number(totals.grossLiters.toFixed(2)),
      unit: 'L',
      format: 'liters',
    });
  }

  // 13% TS
  if (totals.at13tsLiters != null) {
    kpis.push({
      id: 'kpi-13ts',
      label: 'Standardized 13% TS',
      value: Number(totals.at13tsLiters.toFixed(2)),
      unit: 'L',
      format: 'liters',
    });
  }

  // Quality: Fat, LR & SNF (volume-weighted)
  if (totals.avgFat != null) {
    kpis.push({
      id: 'kpi-fat',
      label: 'Average Fat',
      value: Number(totals.avgFat.toFixed(2)),
      unit: '%',
      format: 'percent',
    });
  }

  if (totals.avgLr != null) {
    kpis.push({
      id: 'kpi-lr',
      label: 'Average LR',
      value: Number(totals.avgLr.toFixed(1)),
      format: 'number',
    });
  }

  if (totals.avgSnf != null) {
    kpis.push({
      id: 'kpi-snf',
      label: 'Average SNF',
      value: Number(totals.avgSnf.toFixed(2)),
      unit: '%',
      format: 'percent',
    });
  }

  // Loss
  if (totals.routeLossLiters != null) {
    kpis.push({
      id: 'kpi-loss',
      label: 'Total Route Loss',
      value: Number(totals.routeLossLiters.toFixed(2)),
      unit: 'L',
      format: 'liters',
    });
  }

  return kpis;
}

function computeGroupedSubtotals(
  rows: Record<string, any>[],
  groupByFieldId: string,
  fields: ReportFieldDefinition[]
): GroupedSubtotal[] {
  const groups = new Map<string, { label: string; records: Record<string, any>[] }>();

  for (const r of rows) {
    const key = String(r[groupByFieldId] || 'Unassigned');
    const curr = groups.get(key) || { label: key, records: [] };
    curr.records.push(r);
    groups.set(key, curr);
  }

  const result: GroupedSubtotal[] = [];

  for (const [key, group] of groups.entries()) {
    const aggs: Record<string, number> = {};
    for (const f of fields) {
      if (f.dataType === 'number') {
        const nums = group.records.filter((r) => r[f.id] != null).map((r) => Number(r[f.id])).filter((n) => !isNaN(n));
        if (nums.length > 0) {
          if (f.aggregations?.includes('SUM') || f.format === 'liters') {
            aggs[f.id] = Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
          } else if (f.aggregations?.includes('AVG') || f.format === 'percent' || f.format === 'temperature') {
            aggs[f.id] = Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
          }
        }
      }
    }

    result.push({
      groupKey: key,
      groupLabel: group.label,
      recordCount: group.records.length,
      aggregations: aggs,
    });
  }

  return result;
}

// ============================================================================
// 6. DYNAMIC EXCEL & CSV EXPORT GENERATOR
// ============================================================================

export async function generateDynamicExcelReport(
  req: DynamicExportRequest,
  currentUser: User | null
): Promise<Buffer> {
  const queryRes = await executeDynamicReportQuery(
    {
      domain: req.domain,
      selectedFieldIds: req.selectedFieldIds,
      filters: req.filters,
      groupByFieldId: req.groupByFieldId,
      sortFieldId: req.sortFieldId,
      sortDirection: req.sortDirection,
      page: 1,
      pageSize: 5000,
      zmccId: req.zmccId,
    },
    currentUser
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Milk Reception Platform';
  wb.created = new Date();

  const sheetName = req.reportTitle ? req.reportTitle.slice(0, 30) : req.domain.replace('_', ' ');
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  // Style constants
  const brandBlue = '1E3A8A';
  const brandFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: brandBlue },
  };
  const headerFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    bold: true,
    color: { argb: 'FFFFFF' },
    size: 10,
  };
  const titleFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    bold: true,
    color: { argb: '1E293B' },
    size: 14,
  };
  const metaFont: Partial<ExcelJS.Font> = {
    name: 'Segoe UI',
    color: { argb: '64748B' },
    size: 9,
  };

  // Row 1: Report Title Banner
  ws.mergeCells(1, 1, 1, queryRes.fields.length || 6);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = req.reportTitle || `${req.domain.replace(/_/g, ' ')} Dynamic Report`;
  titleCell.font = titleFont;

  // Row 2: Metadata (Generated date & Active records)
  ws.mergeCells(2, 1, 2, queryRes.fields.length || 6);
  const metaCell = ws.getCell(2, 1);
  metaCell.value = `Generated at ${new Date().toISOString()} · Total Records: ${queryRes.totalRecords}`;
  metaCell.font = metaFont;

  // Row 3: Blank separator
  ws.addRow([]);

  // Row 4: Column Headers
  const headerRow = ws.addRow(queryRes.fields.map((f) => f.label));
  headerRow.height = 24;
  headerRow.eachCell((cell, colNumber) => {
    cell.fill = brandFill;
    cell.font = headerFont;
    cell.alignment = {
      vertical: 'middle',
      horizontal: queryRes.fields[colNumber - 1]?.align || 'left',
    };
  });

  // Data Rows
  for (const row of queryRes.rows) {
    const rowValues = queryRes.fields.map((f) => {
      const val = row[f.id];
      if (val === null || val === undefined) return '—';
      return val;
    });

    const dataRow = ws.addRow(rowValues);
    dataRow.eachCell((cell, colNumber) => {
      const f = queryRes.fields[colNumber - 1];
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: f?.align || 'left',
      };

      if (f?.format === 'liters') {
        cell.numFmt = '#,##0.00 "L"';
      } else if (f?.format === 'percent') {
        cell.numFmt = '0.00"%"';
      } else if (f?.format === 'temperature') {
        cell.numFmt = '0.0"°C"';
      } else if (f?.dataType === 'number') {
        cell.numFmt = '#,##0.00';
      }
    });
  }

  // Summary / Total Row
  if (queryRes.rows.length > 0) {
    const totalValues = queryRes.fields.map((f, idx) => {
      if (idx === 0) return 'TOTAL / SUMMARY';
      if (f.dataType === 'number') {
        const nums = queryRes.rows.filter((r) => r[f.id] != null).map((r) => Number(r[f.id])).filter((n) => !isNaN(n));
        if (nums.length === 0) return '—';
        if (f.aggregations?.includes('SUM') || f.format === 'liters') {
          return Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
        }
        if (f.aggregations?.includes('AVG') || f.format === 'percent' || f.format === 'temperature') {
          return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
        }
      }
      return '—';
    });

    const totalRow = ws.addRow(totalValues);
    totalRow.height = 22;
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', bold: true, size: 9 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'F1F5F9' },
      };
      const f = queryRes.fields[colNumber - 1];
      cell.alignment = {
        vertical: 'middle',
        horizontal: f?.align || 'left',
      };
      if (f?.format === 'liters') cell.numFmt = '#,##0.00 "L"';
      else if (f?.format === 'percent') cell.numFmt = '0.00"%"';
      else if (f?.format === 'temperature') cell.numFmt = '0.0"°C"';
      else if (f?.dataType === 'number') cell.numFmt = '#,##0.00';
    });
  }

  // Auto-fit column widths
  ws.columns.forEach((col, idx) => {
    const f = queryRes.fields[idx];
    const headerLen = f ? f.label.length : 12;
    col.width = Math.max(headerLen + 4, 14);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateDynamicCsvReport(
  req: DynamicExportRequest,
  currentUser: User | null
): Promise<string> {
  const queryRes = await executeDynamicReportQuery(
    {
      domain: req.domain,
      selectedFieldIds: req.selectedFieldIds,
      filters: req.filters,
      groupByFieldId: req.groupByFieldId,
      sortFieldId: req.sortFieldId,
      sortDirection: req.sortDirection,
      page: 1,
      pageSize: 10000,
      zmccId: req.zmccId,
    },
    currentUser
  );

  const headers = queryRes.fields.map((f) => `"${f.label.replace(/"/g, '""')}"`).join(',');
  const rows = queryRes.rows.map((row) => {
    return queryRes.fields
      .map((f) => {
        const val = row[f.id];
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      })
      .join(',');
  });

  return [headers, ...rows].join('\n');
}
