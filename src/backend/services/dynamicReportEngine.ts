import { LIVE_PLANT_TRANSIT_SQL } from './liveReportSql';
import { getBatchTankPhysicalStock, getBatchTankTodayMovements } from '@/backend/services/zmccTankService';
import { prisma } from '@core/db';
import type { User } from '@core/types';
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
  { id: 'fat', label: 'Fat %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: false, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'lr', label: 'LR', category: 'QUALITY', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: false, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'snf', label: 'SNF %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'temperature_c', label: 'Temperature (°C)', category: 'QUALITY', dataType: 'number', format: 'temperature', align: 'right', defaultSelected: true, sortable: false, filterable: true, aggregations: ['AVG', 'MAX'] },
  { id: 'decision', label: 'Lab Decision', category: 'QUALITY', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['ACCEPTED', 'REJECTED', 'PENDING'] },
  { id: 'rmr_number', label: 'RMR Receipt #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: false, filterable: true },
  { id: 'rmr_status', label: 'RMR Status', category: 'IDENTIFICATION', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: false, filterable: true, enumValues: ['ISSUED', 'RECORDED', 'CANCELLED', 'PENDING'] },
];

export const JOURNEY_RECONCILIATION_FIELDS: ReportFieldDefinition[] = [
  { id: 'journey_number', label: 'Journey #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'operational_date', label: 'Operational Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'route_code', label: 'Route Code', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'route_name', label: 'Route Name', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'mot_name', label: 'MOT Driver', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'vehicle_number', label: 'Vehicle #', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'status', label: 'Status', category: 'OPERATIONAL', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['COLLECTING', 'RETURNED_TO_ZMCC', 'COMPLETED', 'CANCELLED'] },
  { id: 'planned_stops', label: 'Planned Stops', category: 'OPERATIONAL', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['SUM', 'AVG'] },
  { id: 'visited_stops', label: 'Visited Stops', category: 'OPERATIONAL', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['SUM', 'AVG'] },
  { id: 'completion_rate', label: 'Completion %', category: 'OPERATIONAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['AVG'] },
  { id: 'shop_liters', label: 'Shop Collected (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['SUM', 'AVG'] },
  { id: 'gate_liters', label: 'Gate Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'loss_liters', label: 'Route Loss (L)', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['SUM', 'AVG'] },
  { id: 'loss_pct', label: 'Route Loss %', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['AVG'] },
  { id: 'dispatched_at', label: 'Dispatched At', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
  { id: 'returned_at', label: 'Returned At', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
];

export const TANK_STORAGE_FIELDS: ReportFieldDefinition[] = [
  { id: 'tank_code', label: 'Tank Code', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'tank_name', label: 'Tank Name', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'capacity_liters', label: 'Capacity (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'current_stock_liters', label: 'Current Stock (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'fill_pct', label: 'Fill %', category: 'VOLUMES', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'today_receipts_liters', label: 'Today Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'today_dispatches_liters', label: 'Today Dispatched (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'is_active', label: 'Operational State', category: 'OPERATIONAL', dataType: 'boolean', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true },
];

export const PLANT_TRANSIT_FIELDS: ReportFieldDefinition[] = [
  { id: 'dispatch_note_number', label: 'Dispatch Slip #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'dispatch_date', label: 'Dispatch Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'vehicle_number', label: 'Tanker Vehicle', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'contractor_name', label: 'ZMCC', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'dispatched_liters', label: 'Dispatched Gross (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'dispatched_13ts_liters', label: 'Dispatched 13% TS (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'plant_received_liters', label: 'Plant Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'transit_loss_liters', label: 'Transit Loss (L)', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'transit_loss_pct', label: 'Transit Loss %', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'] },
  { id: 'status', label: 'Status', category: 'OPERATIONAL', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['IN_TRANSIT', 'RECEIVED_AT_PLANT', 'RECONCILED', 'FLAGGED'] },
];

export const QUALITY_SCREENING_FIELDS: ReportFieldDefinition[] = [
  { id: 'sample_token', label: 'Token #', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: false, filterable: true },
  { id: 'source_type', label: 'Origin Source', category: 'OPERATIONAL', dataType: 'string', format: 'text', defaultSelected: true, sortable: false, filterable: true },
  { id: 'test_date', label: 'Test Date', category: 'TIMING', dataType: 'date', format: 'date', defaultSelected: true, sortable: true, filterable: true },
  { id: 'tested_at', label: 'Timestamp', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: true, sortable: true, filterable: true },
  { id: 'gross_liters', label: 'Gross Liters', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'fat', label: 'Fat %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'lr', label: 'LR', category: 'QUALITY', dataType: 'number', format: 'number', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'snf', label: 'SNF %', category: 'QUALITY', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG', 'MIN', 'MAX'] },
  { id: 'temperature_c', label: 'Temperature (°C)', category: 'QUALITY', dataType: 'number', format: 'temperature', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['AVG', 'MAX'] },
  { id: 'decision', label: 'Final Decision', category: 'QUALITY', dataType: 'enum', format: 'status_pill', defaultSelected: true, sortable: true, filterable: true, enumValues: ['ACCEPTED', 'REJECTED'] },
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
    selectedFieldIds: ['tank_code', 'tank_name', 'capacity_liters', 'current_stock_liters', 'fill_pct', 'today_receipts_liters', 'today_dispatches_liters', 'is_active'],
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

/** Hard cap for one export; a bigger result must be narrowed by date or filters first. */
export const MAX_REPORT_ROWS = 50000;
const MAX_PAGE_SIZE = 500;
const EXPORT_CHUNK_SIZE = 1000;

/** A problem with what the user asked for (not a server fault): the routes answer it with a 4xx and the message. */
export class ReportRequestError extends Error {}

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '';

interface DynamicQueryOptions {
  /** Rows only: skips KPI cards and grouped subtotals. Used by the export, which reads in chunks. */
  light?: boolean;
}

export async function executeDynamicReportQuery(
  req: DynamicQueryRequest,
  currentUser: User | null,
  opts: DynamicQueryOptions = {}
): Promise<DynamicQueryResponse> {
  const { domain, selectedFieldIds, groupByFieldId, sortFieldId, sortDirection, zmccId } = req;
  const filters = Array.isArray(req.filters) ? req.filters : [];
  const page = Math.max(1, Math.floor(Number(req.page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(req.pageSize)) || 20));
  const light = opts.light === true;

  const allDomainFields = DOMAIN_FIELD_MAP[domain];
  if (!allDomainFields) throw new ReportRequestError('Unknown report type.');

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
  } else {
    // Never fall back to every source for a user who belongs to none.
    throw new ReportRequestError('Your account has no source assigned.');
  }

  const activeFields = allDomainFields.filter((f) => selectedFieldIds.includes(f.id));

  let rawRows: Record<string, any>[] = [];
  let totalCount = 0;
  // KPI figures across the whole filter, never just the current page.
  let kpiTotals: DomainKpiTotals = {};
  const noTotals = Promise.resolve<DomainKpiTotals>({});

  // --------------------------------------------------------------------------
  // DOMAIN 1: MOT_COLLECTIONS
  // --------------------------------------------------------------------------
  if (domain === 'MOT_COLLECTIONS') {
    const and: any[] = [];
    applyFilters(and, filters, MOT_SPECS);
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;
    if (and.length > 0) where.AND = and;

    const [count, totals, records] = await Promise.all([
      prisma.motShopCollection.count({ where }),
      light ? noTotals : getCollectionKpiTotals(where),
      prisma.motShopCollection.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: buildOrderBy(domain, MOT_SPECS, sortFieldId, sortDirection, 'device_collected_at'),
        select: {
          id: true,
          collection_number: true,
          operational_date: true,
          gross_liters: true,
          at_13ts_liters: true,
          fat: true,
          lr: true,
          snf: true,
          density: true,
          final_decision: true,
          device_collected_at: true,
          collection_latitude: true,
          collection_longitude: true,
          shop_rmr_number: true,
          collection_notes: true,
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
      gross_liters: r.gross_liters != null ? Number(r.gross_liters) : 0,
      at_13ts_liters: r.at_13ts_liters != null ? Number(r.at_13ts_liters) : 0,
      fat: r.fat != null ? Number(r.fat) : null,
      lr: r.lr != null ? Number(r.lr) : null,
      snf: r.snf != null ? Number(r.snf) : null,
      density: r.density != null ? Number(r.density) : null,
      final_decision: r.final_decision || 'PENDING',
      device_collected_at: r.device_collected_at ? r.device_collected_at.toISOString() : null,
      collection_latitude: r.collection_latitude != null ? Number(r.collection_latitude) : null,
      collection_longitude: r.collection_longitude != null ? Number(r.collection_longitude) : null,
      shop_rmr_number: r.shop_rmr_number || '—',
      collection_notes: r.collection_notes || '',
    }));
  }

  // --------------------------------------------------------------------------
  // DOMAIN 2: HC_SUPPLIERS
  // --------------------------------------------------------------------------
  else if (domain === 'HC_SUPPLIERS') {
    const roles = await loadSystemRoles(prisma as unknown as PolicyDb);
    const and: any[] = [];
    applyFilters(and, filters, HC_SPECS, hcCustomFilters(roles));
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;
    if (and.length > 0) where.AND = and;

    const [count, records] = await Promise.all([
      prisma.zmccLocalSupplierArrival.count({ where }),
      prisma.zmccLocalSupplierArrival.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: buildOrderBy(domain, HC_SPECS, sortFieldId, sortDirection, 'arrival_timestamp'),
        select: {
          id: true,
          zmcc_token: true,
          arrival_date: true,
          arrival_timestamp: true,
          vehicle_number: true,
          rmr_number: true,
          local_supplier: { select: { local_supplier_code: true, name: true, phone: true } },
          lab_session: {
            select: {
              decision: true,
              gross_liters: true,
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
    const hasFatRole = [...roles.values()].includes('FAT');
    const hasLrRole = [...roles.values()].includes('LR');
    const readResults = (results: LabResultRow[] | undefined) => {
      let fat: number | null = null;
      let lr: number | null = null;
      let temp: number | null = null;
      for (const res of results ?? []) {
        const code = res.test_code_snapshot.toUpperCase();
        const num = res.numeric_value != null ? Number(res.numeric_value) : null;
        const role = roles.get(String(res.test_id));
        if (role === 'FAT' || (!hasFatRole && code.includes('FAT'))) fat = num;
        else if (role === 'LR' || (!hasLrRole && (code.includes('LR') || code.includes('CLR')))) lr = num;
        else if (isTemperatureTest({ testCode: code, testName: res.test_name_snapshot, systemRole: role })) temp = num;
      }
      return { fat, lr, temp };
    };

    // LR and Fat live in lab result rows, so the weighted figures cannot be a single SQL aggregate here.
    // Skipped for exports and for very large filters, where reading every result would load the database.
    if (!light && count > 0 && count <= MAX_REPORT_ROWS) {
      const hcKpiSessions = await prisma.zmccLocalSupplierArrival.findMany({
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
      });
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
    }

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
        gross_liters: a.lab_session?.gross_liters != null ? Number(a.lab_session.gross_liters) : 0,
        fat: fatVal,
        lr: lrVal,
        snf: a.lab_session?.snf != null ? Number(a.lab_session.snf) : null,
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
    const and: any[] = [];
    applyFilters(and, filters, JOURNEY_SPECS);
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;
    if (and.length > 0) where.AND = and;

    const [count, totals, records] = await Promise.all([
      prisma.motJourney.count({ where }),
      light ? noTotals : getJourneyKpiTotals(where),
      prisma.motJourney.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: buildOrderBy(domain, JOURNEY_SPECS, sortFieldId, sortDirection, 'assigned_at'),
        select: {
          id: true,
          journey_number: true,
          operational_date: true,
          status: true,
          assigned_at: true,
          area_received_liters: true,
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
  // A source has only a handful of tanks, so stock is computed for all of them and filtered, sorted and paged here.
  // --------------------------------------------------------------------------
  else if (domain === 'TANK_STORAGE') {
    const where: any = {};
    if (effectiveZmccId) where.zmcc_id = effectiveZmccId;
    // Active tanks only, unless the user filters on the state itself.
    if (!filters.some((f) => f.fieldId === 'is_active' && hasValue(f.value))) where.is_active = true;

    const tanks = await prisma.zmccTank.findMany({
      where,
      orderBy: { tank_code: 'asc' },
      take: MAX_REPORT_ROWS + 1,
    });
    if (tanks.length > MAX_REPORT_ROWS) throw new ReportRequestError(tooManyRowsMessage());

    const tankIds = tanks.map((t) => t.id);
    const [physicalStocks, todayMovements] = await Promise.all([
      getBatchTankPhysicalStock(tankIds),
      getBatchTankTodayMovements(tankIds, getPakistanDayWindow().start),
    ]);

    let tankRows: Record<string, any>[] = tanks.map((t) => {
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
        today_receipts_liters: Number((today?.received ?? 0).toFixed(2)),
        today_dispatches_liters: Number((today?.dispatched ?? 0).toFixed(2)),
        is_active: t.is_active,
      };
    });

    for (const flt of filters) {
      if (!hasValue(flt.value)) continue;
      const def = allDomainFields.find((f) => f.id === flt.fieldId);
      if (!def || def.filterable === false) throw new ReportRequestError('This field cannot be filtered.');
      tankRows = tankRows.filter((row) => matchesRowFilter(row[def.id], def, flt));
    }

    const sortDef = allDomainFields.find((f) => f.id === sortFieldId && f.sortable !== false);
    const dirFactor = sortDirection === 'desc' ? -1 : 1;
    const sortId = sortDef ? sortDef.id : 'tank_code';
    tankRows.sort((a, b) => {
      const av = a[sortId];
      const bv = b[sortId];
      const cmp = typeof av === 'string' ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return (sortDef ? dirFactor : 1) * cmp;
    });

    totalCount = tankRows.length;
    rawRows = tankRows.slice((page - 1) * pageSize, page * pageSize);
  }

  // --------------------------------------------------------------------------
  // DOMAIN 5: PLANT_TRANSIT (read live, so new tankers show without a manual refresh)
  // --------------------------------------------------------------------------
  else if (domain === 'PLANT_TRANSIT') {
    // A failed query throws to the caller: it must show as an error, never as made-up rows.
    const conditions = ['1=1'];
    const params: any[] = [];

    if (effectiveZmccId) {
      params.push(effectiveZmccId);
      conditions.push(`zmcc_id = $${params.length}`);
    }
    for (const flt of filters) {
      const clause = transitFilterClause(flt, params);
      if (clause) conditions.push(clause);
    }
    const whereSql = conditions.join(' AND ');

    const countRes = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text as count FROM ${LIVE_PLANT_TRANSIT_SQL} WHERE ${whereSql}`,
      ...params
    )) as { count: string }[];
    totalCount = Number(countRes[0]?.count || 0);

    const sortDef = allDomainFields.find((f) => f.id === sortFieldId && f.sortable !== false);
    const sortExpr = sortDef ? TRANSIT_SPECS[sortDef.id]?.expr : undefined;
    const orderSql = sortExpr
      ? `${sortExpr} ${sortDirection === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, visit_id DESC`
      : 'operational_date DESC NULLS LAST, visit_id DESC';

    const offset = (page - 1) * pageSize;
    const records = (await prisma.$queryRawUnsafe(
      `SELECT * FROM ${LIVE_PLANT_TRANSIT_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`,
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
    const and: any[] = [];
    applyFilters(and, filters, QUALITY_SPECS, QUALITY_CUSTOM_FILTERS);
    const where: any = { final_decision: { in: ['ACCEPTED', 'REJECTED'] } };
    if (effectiveZmccId) where.lab_session = { zmcc_id: effectiveZmccId };
    if (and.length > 0) where.AND = and;

    const labResultSelect = { test_id: true, test_code_snapshot: true, test_name_snapshot: true, numeric_value: true } as const;
    const [count, totals, records] = await Promise.all([
      prisma.zmccLabPortion.count({ where }),
      light ? noTotals : getQualityKpiTotals(where),
      prisma.zmccLabPortion.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: buildOrderBy(domain, QUALITY_SPECS, sortFieldId, sortDirection, 'decided_at'),
        select: {
          id: true,
          decided_at: true,
          created_at: true,
          gross_liters: true,
          fat: true,
          lr: true,
          snf: true,
          final_decision: true,
          exception_reasons: true,
          decision_remarks: true,
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

  const summaryKpis = light ? [] : computeDynamicSummaryKpis(totalCount, kpiTotals);

  // Grouped subtotals cover the rows of the current page, the same rows the table shows.
  const groupedSubtotals =
    !light && groupByFieldId && allDomainFields.some((f) => f.id === groupByFieldId)
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

function tooManyRowsMessage(): string {
  return `More than ${MAX_REPORT_ROWS.toLocaleString('en-US')} rows match. Narrow the date range or filters.`;
}

// ============================================================================
// 4. FILTER AND SORT TRANSLATION HELPERS
// ============================================================================

type FilterKind = 'string' | 'number' | 'date' | 'datetime' | 'enum';

/** One filterable column: its kind and where it lives (a dotted path through relations). */
interface FilterSpec {
  kind: FilterKind;
  path: string;
}

type CustomFilters = Record<string, (flt: DynamicFilterClause) => any>;

const MOT_SPECS: Record<string, FilterSpec> = {
  collection_number: { kind: 'string', path: 'collection_number' },
  operational_date: { kind: 'date', path: 'operational_date' },
  route_code: { kind: 'string', path: 'route.route_code' },
  route_name: { kind: 'string', path: 'route.name' },
  shop_code: { kind: 'string', path: 'shop.shop_code' },
  shop_name: { kind: 'string', path: 'shop.shop_name' },
  owner_name: { kind: 'string', path: 'shop.owner_name' },
  mot_name: { kind: 'string', path: 'mot_profile.name' },
  vehicle_number: { kind: 'string', path: 'mot_vehicle.vehicle_number' },
  gross_liters: { kind: 'number', path: 'gross_liters' },
  at_13ts_liters: { kind: 'number', path: 'at_13ts_liters' },
  fat: { kind: 'number', path: 'fat' },
  lr: { kind: 'number', path: 'lr' },
  snf: { kind: 'number', path: 'snf' },
  density: { kind: 'number', path: 'density' },
  final_decision: { kind: 'enum', path: 'final_decision' },
  device_collected_at: { kind: 'datetime', path: 'device_collected_at' },
  shop_rmr_number: { kind: 'string', path: 'shop_rmr_number' },
  collection_notes: { kind: 'string', path: 'collection_notes' },
};

const HC_SPECS: Record<string, FilterSpec> = {
  zmcc_token: { kind: 'string', path: 'zmcc_token' },
  arrival_date: { kind: 'date', path: 'arrival_date' },
  arrival_timestamp: { kind: 'datetime', path: 'arrival_timestamp' },
  supplier_code: { kind: 'string', path: 'local_supplier.local_supplier_code' },
  supplier_name: { kind: 'string', path: 'local_supplier.name' },
  phone: { kind: 'string', path: 'local_supplier.phone' },
  vehicle_number: { kind: 'string', path: 'vehicle_number' },
  gross_liters: { kind: 'number', path: 'lab_session.gross_liters' },
  snf: { kind: 'number', path: 'lab_session.snf' },
  decision: { kind: 'enum', path: 'lab_session.decision' },
};

const JOURNEY_SPECS: Record<string, FilterSpec> = {
  journey_number: { kind: 'string', path: 'journey_number' },
  operational_date: { kind: 'date', path: 'operational_date' },
  route_code: { kind: 'string', path: 'route.route_code' },
  route_name: { kind: 'string', path: 'route.name' },
  mot_name: { kind: 'string', path: 'mot_profile.name' },
  vehicle_number: { kind: 'string', path: 'mot_vehicle.vehicle_number' },
  status: { kind: 'enum', path: 'status' },
  gate_liters: { kind: 'number', path: 'area_received_liters' },
  dispatched_at: { kind: 'datetime', path: 'assigned_at' },
  returned_at: { kind: 'datetime', path: 'mot_arrival.arrival_timestamp' },
};

const QUALITY_SPECS: Record<string, FilterSpec> = {
  test_date: { kind: 'datetime', path: 'decided_at' },
  tested_at: { kind: 'datetime', path: 'decided_at' },
  gross_liters: { kind: 'number', path: 'gross_liters' },
  fat: { kind: 'number', path: 'fat' },
  lr: { kind: 'number', path: 'lr' },
  snf: { kind: 'number', path: 'snf' },
  decision: { kind: 'enum', path: 'final_decision' },
};

const dayOf = (value: unknown): string => {
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ReportRequestError('Pick a valid date in the filter.');
  return s;
};

const numberOf = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ReportRequestError('Enter a valid number in the filter.');
  return n;
};

const needSecond = (flt: DynamicFilterClause) => {
  if (!hasValue(flt.valueSecondary)) throw new ReportRequestError('Fill both values of the between filter.');
};

/** Prisma condition for one filter on one column. negate means the condition must be wrapped in NOT. */
function scalarCondition(kind: FilterKind, flt: DynamicFilterClause): { cond: any; negate: boolean } {
  const op = flt.operator;
  const unsupported = () => new ReportRequestError('This filter does not fit the field.');

  if (kind === 'string' || kind === 'enum') {
    const v = String(flt.value);
    const mode = kind === 'string' ? ({ mode: 'insensitive' } as const) : {};
    if (op === 'EQUALS') return { cond: { equals: v, ...mode }, negate: false };
    if (op === 'NOT_EQUALS') return { cond: { equals: v, ...mode }, negate: true };
    if (op === 'CONTAINS') return { cond: { contains: v, ...mode }, negate: false };
    if (op === 'STARTS_WITH') return { cond: { startsWith: v, ...mode }, negate: false };
    if (op === 'IN_LIST') {
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      return { cond: { in: list }, negate: false };
    }
    throw unsupported();
  }

  if (kind === 'number') {
    const n = numberOf(flt.value);
    if (op === 'GREATER_THAN') return { cond: { gt: n }, negate: false };
    if (op === 'LESS_THAN') return { cond: { lt: n }, negate: false };
    if (op === 'GREATER_EQUAL') return { cond: { gte: n }, negate: false };
    if (op === 'LESS_EQUAL') return { cond: { lte: n }, negate: false };
    if (op === 'EQUALS') return { cond: { equals: n }, negate: false };
    if (op === 'NOT_EQUALS') return { cond: { equals: n }, negate: true };
    if (op === 'BETWEEN') {
      needSecond(flt);
      return { cond: { gte: n, lte: numberOf(flt.valueSecondary) }, negate: false };
    }
    if (op === 'IN_LIST') return { cond: { in: String(flt.value).split(',').map((s) => numberOf(s.trim())) }, negate: false };
    throw unsupported();
  }

  // Calendar dates are stored as UTC midnight; timestamps are compared by Pakistan calendar day.
  const day = dayOf(flt.value);
  const isDate = kind === 'date';
  const lo = isDate ? new Date(`${day}T00:00:00.000Z`) : getPakistanDayWindow(day).start;
  const hi = isDate ? new Date(`${day}T00:00:00.000Z`) : getPakistanDayWindow(day).end;
  if (op === 'EQUALS') return { cond: isDate ? { equals: lo } : { gte: lo, lte: hi }, negate: false };
  if (op === 'NOT_EQUALS') return { cond: isDate ? { equals: lo } : { gte: lo, lte: hi }, negate: true };
  if (op === 'GREATER_THAN') return { cond: { gt: hi }, negate: false };
  if (op === 'GREATER_EQUAL') return { cond: { gte: lo }, negate: false };
  if (op === 'LESS_THAN') return { cond: { lt: lo }, negate: false };
  if (op === 'LESS_EQUAL') return { cond: { lte: hi }, negate: false };
  if (op === 'BETWEEN') {
    needSecond(flt);
    const day2 = dayOf(flt.valueSecondary);
    const end = isDate ? new Date(`${day2}T00:00:00.000Z`) : getPakistanDayWindow(day2).end;
    return { cond: { gte: lo, lte: end }, negate: false };
  }
  throw unsupported();
}

/** Wraps a column condition in the relations leading to it: ('route.name', c) gives { route: { name: c } }. */
function nestPath(path: string, inner: any): any {
  return path.split('.').reduceRight((acc, key) => ({ [key]: acc }), inner);
}

function specNode(spec: FilterSpec, flt: DynamicFilterClause): any {
  const { cond, negate } = scalarCondition(spec.kind, flt);
  const node = nestPath(spec.path, cond);
  return negate ? { NOT: node } : node;
}

/** One text filter that may match any of several columns. */
function anyOfNode(paths: string[], flt: DynamicFilterClause): any {
  const { cond, negate } = scalarCondition('string', flt);
  const node = { OR: paths.map((p) => nestPath(p, cond)) };
  return negate ? { NOT: node } : node;
}

/** Every filter is its own AND member, so two filters on one field (a range) never overwrite each other. */
function applyFilters(and: any[], filters: DynamicFilterClause[], specs: Record<string, FilterSpec>, custom: CustomFilters = {}) {
  for (const flt of filters) {
    if (!hasValue(flt.value)) continue;
    const handler = custom[flt.fieldId];
    if (handler) {
      and.push(handler(flt));
      continue;
    }
    const spec = specs[flt.fieldId];
    if (!spec) throw new ReportRequestError('This field cannot be filtered.');
    and.push(specNode(spec, flt));
  }
}

/** Sort by the chosen column when the field is sortable and stored; id keeps the paging order stable. */
function buildOrderBy(
  domain: ReportDomain,
  specs: Record<string, FilterSpec>,
  sortFieldId: string | undefined,
  sortDirection: 'asc' | 'desc' | undefined,
  defaultPath: string
): any[] {
  const dir = sortDirection === 'asc' ? 'asc' : 'desc';
  const def = DOMAIN_FIELD_MAP[domain].find((f) => f.id === sortFieldId && f.sortable !== false);
  const path = def && specs[def.id] ? specs[def.id].path : defaultPath;
  return [nestPath(path, dir), { id: 'asc' }];
}

// --- HC suppliers: lab result values live in result rows, the rest on the arrival -----------------

function hcCustomFilters(roles: Map<string, string>): CustomFilters {
  const idsFor = (role: string) => [...roles.entries()].filter(([, r]) => r === role).map(([id]) => BigInt(id));
  const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

  const resultNode = (match: any, flt: DynamicFilterClause) => {
    const { cond, negate } = scalarCondition('number', flt);
    const node = { lab_session: { results: { some: { AND: [match, { numeric_value: cond }] } } } };
    return negate ? { NOT: node } : node;
  };
  const roleMatch = (role: 'FAT' | 'LR') => {
    const ids = idsFor(role);
    return ids.length > 0 ? { test_id: { in: ids } } : { test_code_snapshot: ci(role) };
  };

  return {
    fat: (flt) => resultNode(roleMatch('FAT'), flt),
    lr: (flt) => resultNode(roleMatch('LR'), flt),
    temperature_c: (flt) =>
      resultNode({ OR: [{ test_code_snapshot: ci('TEMP') }, { test_name_snapshot: { equals: 'temperature', mode: 'insensitive' } }] }, flt),
    decision: (flt) => {
      // A token without a finished lab session shows as PENDING.
      if (flt.operator === 'EQUALS' && String(flt.value) === 'PENDING') {
        return { OR: [{ lab_session: { is: null } }, { lab_session: { decision: null } }, { lab_session: { decision: 'PENDING' } }] };
      }
      return specNode(HC_SPECS.decision, flt);
    },
    rmr_number: (flt) => anyOfNode(['rmr_number', 'rmr_issuance.receipt_number'], flt),
    rmr_status: (flt) => {
      const v = String(flt.value);
      const byStatus: Record<string, any> = {
        CANCELLED: { rmr_issuance: { is: { cancelled_at: { not: null } } } },
        ISSUED: { rmr_issuance: { is: { cancelled_at: null } } },
        RECORDED: { rmr_issuance: { is: null }, rmr_number: { not: null } },
        PENDING: { rmr_issuance: { is: null }, rmr_number: null },
      };
      const node = byStatus[v];
      if (!node) throw new ReportRequestError('Unknown RMR status.');
      if (flt.operator === 'NOT_EQUALS') return { NOT: node };
      if (flt.operator !== 'EQUALS') throw new ReportRequestError('This filter does not fit the field.');
      return node;
    },
  };
}

// --- Quality screening ----------------------------------------------------------------------------

const QUALITY_CUSTOM_FILTERS: CustomFilters = {
  sample_token: (flt) => anyOfNode(['lab_session.mot_arrival.zmcc_token', 'lab_session.local_supplier_arrival.zmcc_token'], flt),
  exception_reason: (flt) => anyOfNode(['decision_remarks', 'lab_session.rejection_reason'], flt),
  source_type: (flt) => {
    // The column shows "Direct HC (code)" or "Route MOT (code)": match the kind words and the code inside.
    const v = String(flt.value).trim();
    const lower = v.toLowerCase();
    const ci = { contains: v, mode: 'insensitive' as const };
    const or: any[] = [
      { lab_session: { local_supplier_arrival: { local_supplier: { local_supplier_code: ci } } } },
      { lab_session: { mot_arrival: { journey: { route: { route_code: ci } } } } },
    ];
    if ('direct hc'.includes(lower) || lower.includes('hc') || lower.includes('direct')) or.push({ lab_session: { arrival_type: 'HC' } });
    if ('route mot'.includes(lower) || lower.includes('route') || lower.includes('mot')) or.push({ lab_session: { arrival_type: { not: 'HC' } } });
    const node = { OR: or };
    return flt.operator === 'NOT_EQUALS' ? { NOT: node } : node;
  },
};

// --- Plant transit: raw SQL over the live view; every column is an expression, never user text ------

const TRANSIT_STATUS_SQL = `(CASE WHEN current_status = 'COMPLETED' THEN 'RECONCILED' ELSE COALESCE(current_status, 'IN_TRANSIT') END)`;

const TRANSIT_SPECS: Record<string, { kind: FilterKind; expr: string }> = {
  dispatch_note_number: { kind: 'string', expr: `COALESCE(visit_number, 'DSP-' || visit_id::text)` },
  dispatch_date: { kind: 'date', expr: 'operational_date' },
  vehicle_number: { kind: 'string', expr: 'vehicle_number' },
  contractor_name: { kind: 'string', expr: 'zmcc_name' },
  dispatched_liters: { kind: 'number', expr: 'COALESCE(dispatch_gross_liters, sent_gross_liters)' },
  dispatched_13ts_liters: { kind: 'number', expr: 'COALESCE(dispatch_at_13ts_liters, sent_at_13ts_liters)' },
  plant_received_liters: { kind: 'number', expr: 'received_gross_liters' },
  transit_loss_liters: { kind: 'number', expr: 'GREATEST(0, -gross_variance_liters)' },
  transit_loss_pct: { kind: 'number', expr: 'GREATEST(0, -gross_variance_percent)' },
  status: { kind: 'enum', expr: TRANSIT_STATUS_SQL },
};

/** SQL condition for one plant transit filter; the values go in as bound parameters. */
function transitFilterClause(flt: DynamicFilterClause, params: any[]): string | null {
  if (!hasValue(flt.value)) return null;
  const spec = TRANSIT_SPECS[flt.fieldId];
  if (!spec) throw new ReportRequestError('This field cannot be filtered.');
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const op = flt.operator;
  const unsupported = () => new ReportRequestError('This filter does not fit the field.');
  const compare: Record<string, string> = { EQUALS: '=', NOT_EQUALS: '<>', GREATER_THAN: '>', LESS_THAN: '<', GREATER_EQUAL: '>=', LESS_EQUAL: '<=' };

  if (spec.kind === 'string' || spec.kind === 'enum') {
    const v = String(flt.value);
    const text = `${spec.expr}::text`;
    const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
    if (op === 'EQUALS') return `LOWER(${text}) = LOWER(${bind(v)})`;
    if (op === 'NOT_EQUALS') return `LOWER(${text}) <> LOWER(${bind(v)})`;
    if (op === 'CONTAINS') return `${text} ILIKE ${bind(`%${like(v)}%`)}`;
    if (op === 'STARTS_WITH') return `${text} ILIKE ${bind(`${like(v)}%`)}`;
    if (op === 'IN_LIST') return `${text} = ANY(${bind(v.split(',').map((s) => s.trim()).filter(Boolean))}::text[])`;
    throw unsupported();
  }
  if (spec.kind === 'number') {
    if (op === 'BETWEEN') {
      needSecond(flt);
      return `${spec.expr} BETWEEN ${bind(numberOf(flt.value))}::numeric AND ${bind(numberOf(flt.valueSecondary))}::numeric`;
    }
    if (op === 'IN_LIST') return `${spec.expr} = ANY(${bind(String(flt.value).split(',').map((s) => numberOf(s.trim())))}::numeric[])`;
    if (compare[op]) return `${spec.expr} ${compare[op]} ${bind(numberOf(flt.value))}::numeric`;
    throw unsupported();
  }
  if (op === 'BETWEEN') {
    needSecond(flt);
    return `${spec.expr} BETWEEN ${bind(dayOf(flt.value))}::date AND ${bind(dayOf(flt.valueSecondary))}::date`;
  }
  if (compare[op]) return `${spec.expr} ${compare[op]} ${bind(dayOf(flt.value))}::date`;
  throw unsupported();
}

// --- Tanks: filters on the computed rows ----------------------------------------------------------

function matchesRowFilter(value: unknown, def: ReportFieldDefinition, flt: DynamicFilterClause): boolean {
  const op = flt.operator;
  const unsupported = () => new ReportRequestError('This filter does not fit the field.');

  if (def.dataType === 'number') {
    const n = Number(value);
    const a = numberOf(flt.value);
    if (op === 'GREATER_THAN') return n > a;
    if (op === 'LESS_THAN') return n < a;
    if (op === 'GREATER_EQUAL') return n >= a;
    if (op === 'LESS_EQUAL') return n <= a;
    if (op === 'EQUALS') return n === a;
    if (op === 'NOT_EQUALS') return n !== a;
    if (op === 'BETWEEN') {
      needSecond(flt);
      return n >= a && n <= numberOf(flt.valueSecondary);
    }
    throw unsupported();
  }

  const text = String(value).toLowerCase();
  const v = String(flt.value).toLowerCase();
  if (op === 'EQUALS') return text === v;
  if (op === 'NOT_EQUALS') return text !== v;
  if (op === 'CONTAINS') return text.includes(v);
  if (op === 'STARTS_WITH') return text.startsWith(v);
  if (op === 'IN_LIST') return v.split(',').map((s) => s.trim()).includes(text);
  throw unsupported();
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

/** Weighted by litres for the quality readings, so a small load does not count as much as a big one. */
const LITER_WEIGHTED_FIELDS = new Set(['fat', 'lr', 'snf']);

/** One total for a column: a sum, or an average where a sum means nothing. Null when there is nothing to total. */
function aggregateColumn(rows: Record<string, any>[], f: ReportFieldDefinition): number | null {
  const present = rows.filter((r) => r[f.id] != null && !isNaN(Number(r[f.id])));
  if (present.length === 0) return null;
  const nums = present.map((r) => Number(r[f.id]));

  if (f.aggregations?.includes('SUM') || f.format === 'liters') {
    return Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
  }
  if (f.aggregations?.includes('AVG') || f.format === 'percent' || f.format === 'temperature') {
    if (LITER_WEIGHTED_FIELDS.has(f.id)) {
      const avg = weightedAverage(present.map((r): [number | null, number] => [Number(r[f.id]), Number(r.gross_liters ?? 0)]));
      if (avg !== null) return Number(avg.toFixed(2));
    }
    return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
  }
  return null;
}

function computeGroupedSubtotals(
  rows: Record<string, any>[],
  groupByFieldId: string,
  fields: ReportFieldDefinition[]
): GroupedSubtotal[] {
  const groups = new Map<string, { label: string; records: Record<string, any>[] }>();

  for (const r of rows) {
    const raw = r[groupByFieldId];
    const key = raw === null || raw === undefined || raw === '' ? 'Unassigned' : String(raw);
    const curr = groups.get(key) || { label: key, records: [] };
    curr.records.push(r);
    groups.set(key, curr);
  }

  const result: GroupedSubtotal[] = [];

  for (const [key, group] of groups.entries()) {
    const aggs: Record<string, number> = {};
    for (const f of fields) {
      if (f.dataType === 'number') {
        const total = aggregateColumn(group.records, f);
        if (total !== null) aggs[f.id] = total;
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

/** Date and time as Pakistan staff read it, e.g. 2026-11-16 14:05. */
function formatKarachiDateTime(value: unknown): string {
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

/** The value a cell shows: numbers stay numbers, timestamps become Pakistan time, nothing becomes blank or a dash. */
function exportCellValue(row: Record<string, any>, f: ReportFieldDefinition, blank: string): string | number | boolean | null {
  const val = row[f.id];
  if (val === null || val === undefined) return f.dataType === 'number' ? null : blank;
  if (f.dataType === 'datetime') return formatKarachiDateTime(val);
  if (typeof val === 'boolean') return val ? 'Active' : 'Inactive';
  return val;
}

/** Every row matching the filters, read in chunks, with the same fields the table shows. */
async function collectExportRows(req: DynamicExportRequest, currentUser: User | null) {
  const base = {
    domain: req.domain,
    selectedFieldIds: req.selectedFieldIds,
    filters: req.filters,
    sortFieldId: req.sortFieldId,
    sortDirection: req.sortDirection,
    pageSize: EXPORT_CHUNK_SIZE,
    zmccId: req.zmccId,
  };

  const rows: Record<string, any>[] = [];
  let fields: ReportFieldDefinition[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await executeDynamicReportQuery({ ...base, page }, currentUser, { light: true });
    if (page === 1) {
      total = res.totalRecords;
      fields = res.fields;
      if (total > MAX_REPORT_ROWS) throw new ReportRequestError(tooManyRowsMessage());
    }
    rows.push(...res.rows);
    if (res.rows.length === 0 || rows.length >= total) break;
  }
  return { fields, rows, total };
}

/** The totals row: one value per column, or null where a total means nothing. */
function exportTotals(fields: ReportFieldDefinition[], rows: Record<string, any>[]): Array<number | null> {
  return fields.map((f) => (f.dataType === 'number' ? aggregateColumn(rows, f) : null));
}

export async function generateDynamicExcelReport(
  req: DynamicExportRequest,
  currentUser: User | null
): Promise<Buffer> {
  const queryRes = await collectExportRows(req, currentUser);
  const fields = queryRes.fields;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Milk Reception Platform';
  wb.created = new Date();

  const rawName = req.reportTitle ? req.reportTitle : req.domain.replace(/_/g, ' ');
  const sheetName = rawName.replace(/[\\/?*:[\]]/g, ' ').trim().slice(0, 30) || 'Report';
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

  const colCount = Math.max(fields.length, 1);

  // Row 1: Report Title Banner
  if (colCount > 1) ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = req.reportTitle || `${req.domain.replace(/_/g, ' ')} Dynamic Report`;
  titleCell.font = titleFont;

  // Row 2: Metadata (Generated date & Active records)
  if (colCount > 1) ws.mergeCells(2, 1, 2, colCount);
  const metaCell = ws.getCell(2, 1);
  metaCell.value = `Generated ${formatKarachiDateTime(new Date())} (Pakistan time) | Total Records: ${queryRes.total}`;
  metaCell.font = metaFont;

  // Row 3: Blank separator
  ws.addRow([]);

  // Row 4: Column Headers
  const headerRow = ws.addRow(fields.map((f) => f.label));
  headerRow.height = 24;
  headerRow.eachCell((cell, colNumber) => {
    cell.fill = brandFill;
    cell.font = headerFont;
    cell.alignment = {
      vertical: 'middle',
      horizontal: fields[colNumber - 1]?.align || 'left',
    };
  });

  const numFmtFor = (f: ReportFieldDefinition | undefined): string | undefined => {
    if (f?.format === 'liters') return '#,##0.00 "L"';
    if (f?.format === 'percent') return '0.00"%"';
    if (f?.format === 'temperature') return '0.0"°C"';
    if (f?.dataType === 'number') return '#,##0.00';
    return undefined;
  };

  // Data Rows (every column keeps its place, so blanks must be written as cells)
  for (const row of queryRes.rows) {
    const dataRow = ws.addRow(fields.map((f) => exportCellValue(row, f, '-')));
    fields.forEach((f, i) => {
      const cell = dataRow.getCell(i + 1);
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: f.align || 'left' };
      const fmt = numFmtFor(f);
      if (fmt) cell.numFmt = fmt;
    });
  }

  // Summary / Total Row: sums, averages and similar, over every exported row
  if (queryRes.rows.length > 0) {
    const totals = exportTotals(fields, queryRes.rows);
    const labelIdx = totals.findIndex((t) => t === null);
    const totalRow = ws.addRow(totals.map((t, i) => (i === labelIdx ? 'TOTAL' : t)));
    totalRow.height = 22;
    fields.forEach((f, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.font = { name: 'Segoe UI', bold: true, size: 9 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'F1F5F9' },
      };
      cell.alignment = { vertical: 'middle', horizontal: f.align || 'left' };
      const fmt = numFmtFor(f);
      if (fmt && totals[i] !== null) cell.numFmt = fmt;
    });
  }

  // Auto-fit column widths
  fields.forEach((f, idx) => {
    ws.getColumn(idx + 1).width = Math.max(f.label.length + 4, 14);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateDynamicCsvReport(
  req: DynamicExportRequest,
  currentUser: User | null
): Promise<string> {
  const queryRes = await collectExportRows(req, currentUser);
  const fields = queryRes.fields;

  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  // Text that starts with a formula character is prefixed so a spreadsheet never runs it.
  const textCell = (s: string) => quote(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
  const cell = (v: string | number | boolean | null) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    return textCell(String(v));
  };

  const headers = fields.map((f) => quote(f.label)).join(',');
  const lines = queryRes.rows.map((row) => fields.map((f) => cell(exportCellValue(row, f, ''))).join(','));

  if (queryRes.rows.length > 0) {
    const totals = exportTotals(fields, queryRes.rows);
    const labelIdx = totals.findIndex((t) => t === null);
    lines.push(totals.map((t, i) => (i === labelIdx ? quote('TOTAL') : cell(t))).join(','));
  }

  // The byte order mark lets Excel open the file as UTF-8.
  return `﻿${[headers, ...lines].join('\r\n')}\r\n`;
}
