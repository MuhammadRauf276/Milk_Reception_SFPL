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
  AggregationType,
  PivotRequest,
  PivotResult,
  TimeBucket,
} from '@/frontend/modules/dashboard/reports/dynamicReportTypes';
import { reportGroupKey } from '@/frontend/modules/dashboard/reports/dynamicReportTypes';

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
  { id: 'completion_rate', label: 'Completion %', category: 'OPERATIONAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['AVG'], ratioOf: { numerator: 'visited_stops', denominator: 'planned_stops' } },
  { id: 'shop_liters', label: 'Shop Collected (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['SUM', 'AVG'] },
  { id: 'gate_liters', label: 'Gate Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'loss_liters', label: 'Route Loss (L)', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['SUM', 'AVG'] },
  { id: 'loss_pct', label: 'Route Loss %', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: false, filterable: false, aggregations: ['AVG'], ratioOf: { numerator: 'loss_liters', denominator: 'shop_liters' } },
  { id: 'dispatched_at', label: 'Dispatched At', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
  { id: 'returned_at', label: 'Returned At', category: 'TIMING', dataType: 'datetime', format: 'datetime', defaultSelected: false, sortable: true, filterable: true },
];

export const TANK_STORAGE_FIELDS: ReportFieldDefinition[] = [
  { id: 'tank_code', label: 'Tank Code', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'tank_name', label: 'Tank Name', category: 'IDENTIFICATION', dataType: 'string', format: 'text', defaultSelected: true, sortable: true, filterable: true },
  { id: 'capacity_liters', label: 'Capacity (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'current_stock_liters', label: 'Current Stock (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM'] },
  { id: 'fill_pct', label: 'Fill %', category: 'VOLUMES', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'], ratioOf: { numerator: 'current_stock_liters', denominator: 'capacity_liters' } },
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
  { id: 'dispatched_13ts_liters', label: 'Dispatched 13% TS (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'plant_received_liters', label: 'Plant Received (L)', category: 'VOLUMES', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'transit_loss_liters', label: 'Transit Loss (L)', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'liters', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['SUM', 'AVG'] },
  { id: 'transit_loss_pct', label: 'Transit Loss %', category: 'LOSS_FINANCIAL', dataType: 'number', format: 'percent', align: 'right', defaultSelected: true, sortable: true, filterable: true, aggregations: ['AVG'], ratioOf: { numerator: 'transit_loss_liters', denominator: 'dispatched_liters' } },
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

const vehicleField = (
  id: string,
  label: string,
  category: ReportFieldDefinition['category'],
  dataType: ReportFieldDefinition['dataType'],
  format: ReportFieldDefinition['format'],
  extra: Partial<ReportFieldDefinition> = {}
): ReportFieldDefinition => ({
  id,
  label,
  category,
  dataType,
  format,
  ...(dataType === 'number' ? { align: 'right' as const } : {}),
  defaultSelected: false,
  sortable: true,
  filterable: true,
  ...extra,
});

/** One row per vehicle dispatched by a ZMCC or contractor, with what the plant measured on arrival. */
export const VEHICLE_DISPATCH_FIELDS: ReportFieldDefinition[] = [
  vehicleField('dispatch_date', 'Dispatch Date', 'TIMING', 'date', 'date', { defaultSelected: true }),
  vehicleField('dispatched_at', 'Dispatched At', 'TIMING', 'datetime', 'datetime'),
  vehicleField('visit_number', 'Visit #', 'IDENTIFICATION', 'string', 'text', { defaultSelected: true }),
  vehicleField('vehicle_number', 'Vehicle #', 'IDENTIFICATION', 'string', 'text', { defaultSelected: true }),
  vehicleField('token_number', 'Token #', 'IDENTIFICATION', 'string', 'text'),
  vehicleField('dispatch_note_number', 'Dispatch Slip #', 'IDENTIFICATION', 'string', 'text'),
  vehicleField('reception_number', 'Reception #', 'IDENTIFICATION', 'string', 'text'),
  vehicleField('weight_ticket_number', 'Weight Ticket #', 'IDENTIFICATION', 'string', 'text'),
  vehicleField('driver_name', 'Driver', 'OPERATIONAL', 'string', 'text'),
  vehicleField('source_name', 'Source', 'OPERATIONAL', 'string', 'text', { defaultSelected: true }),
  vehicleField('source_code', 'Source Code', 'OPERATIONAL', 'string', 'text'),
  vehicleField('source_type', 'Source Type', 'OPERATIONAL', 'enum', 'status_pill', { enumValues: ['ZMCC', 'CONTRACTOR'] }),
  vehicleField('stage', 'Stage', 'OPERATIONAL', 'string', 'text'),
  vehicleField('decision', 'Decision', 'OPERATIONAL', 'enum', 'status_pill', { defaultSelected: true, enumValues: ['ACCEPTED', 'REJECTED', 'PARTLY ACCEPTED', 'PENDING'] }),
  vehicleField('approval_status', 'Approval', 'OPERATIONAL', 'string', 'text'),
  vehicleField('dispatch_person_decision', 'Dispatch Decision', 'OPERATIONAL', 'string', 'text'),
  vehicleField('dispatch_system_outcome', 'System Outcome', 'OPERATIONAL', 'string', 'text'),
  vehicleField('tanker_washed', 'Tanker Washed', 'OPERATIONAL', 'enum', 'text', { enumValues: ['YES', 'NO'] }),
  vehicleField('portions', 'Portions', 'OPERATIONAL', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('plant_added_portions', 'Plant Added Portions', 'OPERATIONAL', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('accepted_portions', 'Accepted Portions', 'OPERATIONAL', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('rejected_portions', 'Rejected Portions', 'OPERATIONAL', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('dispatch_quantity_value', 'Dispatch Quantity', 'VOLUMES', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('dispatch_quantity_unit', 'Quantity Unit', 'VOLUMES', 'string', 'text'),
  vehicleField('dispatch_gross_liters', 'Dispatched Gross (L)', 'VOLUMES', 'number', 'liters', { defaultSelected: true, aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('received_gross_liters', 'Plant Received (L)', 'VOLUMES', 'number', 'liters', { defaultSelected: true, aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('dispatch_at_13ts_liters', 'Dispatched 13% TS (L)', 'VOLUMES', 'number', 'liters', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('received_at_13ts_liters', 'Received 13% TS (L)', 'VOLUMES', 'number', 'liters', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('gross_weight_kg', 'Gross Weight (kg)', 'VOLUMES', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('tare_weight_kg', 'Tare Weight (kg)', 'VOLUMES', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('net_weight_kg', 'Net Weight (kg)', 'VOLUMES', 'number', 'number', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('dispatch_fat', 'Dispatch Fat %', 'QUALITY', 'number', 'percent', { defaultSelected: true, aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'dispatch_gross_liters' }),
  vehicleField('plant_fat', 'Plant Fat %', 'QUALITY', 'number', 'percent', { defaultSelected: true, aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('fat_diff', 'Fat Diff (plant - dispatch)', 'QUALITY', 'number', 'number', { defaultSelected: true, aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('dispatch_lr', 'Dispatch LR', 'QUALITY', 'number', 'number', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'dispatch_gross_liters' }),
  vehicleField('plant_lr', 'Plant LR', 'QUALITY', 'number', 'number', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('lr_diff', 'LR Diff (plant - dispatch)', 'QUALITY', 'number', 'number', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('dispatch_snf', 'Dispatch SNF %', 'QUALITY', 'number', 'percent', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'dispatch_gross_liters' }),
  vehicleField('plant_snf', 'Plant SNF %', 'QUALITY', 'number', 'percent', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('snf_diff', 'SNF Diff (plant - dispatch)', 'QUALITY', 'number', 'number', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('dispatch_ts', 'Dispatch TS %', 'QUALITY', 'number', 'percent', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'dispatch_gross_liters' }),
  vehicleField('plant_ts', 'Plant TS %', 'QUALITY', 'number', 'percent', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('ts_diff', 'TS Diff (plant - dispatch)', 'QUALITY', 'number', 'number', { aggregations: ['AVG', 'MIN', 'MAX'], weightFieldId: 'received_gross_liters' }),
  vehicleField('gross_variance_liters', 'Variance (L)', 'LOSS_FINANCIAL', 'number', 'liters', { defaultSelected: true, aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('gross_variance_percent', 'Variance %', 'LOSS_FINANCIAL', 'number', 'percent', {
    defaultSelected: true,
    aggregations: ['AVG', 'MIN', 'MAX'],
    ratioOf: { numerator: 'gross_variance_liters', denominator: 'dispatch_gross_liters' },
  }),
  vehicleField('at_13ts_variance_liters', '13% TS Variance (L)', 'LOSS_FINANCIAL', 'number', 'liters', { aggregations: ['SUM', 'AVG', 'MIN', 'MAX'] }),
  vehicleField('at_13ts_variance_percent', '13% TS Variance %', 'LOSS_FINANCIAL', 'number', 'percent', {
    aggregations: ['AVG', 'MIN', 'MAX'],
    ratioOf: { numerator: 'at_13ts_variance_liters', denominator: 'dispatch_at_13ts_liters' },
  }),
  vehicleField('gate_in_at', 'Gate In', 'TIMING', 'datetime', 'datetime'),
  vehicleField('first_weight_at', 'First Weight', 'TIMING', 'datetime', 'datetime'),
  vehicleField('second_weight_at', 'Second Weight', 'TIMING', 'datetime', 'datetime'),
  vehicleField('gate_out_at', 'Gate Out', 'TIMING', 'datetime', 'datetime'),
  vehicleField('reconciled_at', 'Reconciled', 'TIMING', 'datetime', 'datetime'),
];

export const DOMAIN_FIELD_MAP: Record<ReportDomain, ReportFieldDefinition[]> = {
  MOT_COLLECTIONS: MOT_COLLECTIONS_FIELDS,
  HC_SUPPLIERS: HC_SUPPLIERS_FIELDS,
  JOURNEY_RECONCILIATION: JOURNEY_RECONCILIATION_FIELDS,
  TANK_STORAGE: TANK_STORAGE_FIELDS,
  PLANT_TRANSIT: PLANT_TRANSIT_FIELDS,
  QUALITY_SCREENING: QUALITY_SCREENING_FIELDS,
  VEHICLE_DISPATCH: VEHICLE_DISPATCH_FIELDS,
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
  {
    id: 'sys-preset-vehicle-by-source',
    name: 'Dispatch vs Plant by Source',
    description: 'Vehicles dispatched in the last 30 days, grouped by source: dispatched and received litres, variance, and fat difference.',
    domain: 'VEHICLE_DISPATCH',
    selectedFieldIds: ['dispatch_date', 'vehicle_number', 'source_name', 'decision', 'dispatch_gross_liters', 'received_gross_liters', 'gross_variance_liters', 'gross_variance_percent', 'dispatch_fat', 'plant_fat', 'fat_diff'],
    filters: [],
    groupByFieldId: 'source_name',
    sortFieldId: 'dispatched_at',
    sortDirection: 'desc',
    isSystemDefault: true,
  },
  {
    id: 'sys-preset-vehicle-monthly',
    name: 'Dispatch vs Plant by Month',
    description: 'Dispatched and received litres, variance and quality differences per month. Widen the date filter for more months.',
    domain: 'VEHICLE_DISPATCH',
    selectedFieldIds: ['dispatch_date', 'vehicle_number', 'source_name', 'dispatch_gross_liters', 'received_gross_liters', 'gross_variance_liters', 'gross_variance_percent', 'fat_diff', 'snf_diff', 'ts_diff'],
    filters: [],
    groupByFieldId: 'dispatched_at',
    timeBucket: 'MONTH',
    sortFieldId: 'dispatched_at',
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
  const timeBucket = req.timeBucket && TIME_BUCKETS.includes(req.timeBucket) ? req.timeBucket : undefined;
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
  const groupField = groupByFieldId ? allDomainFields.find((f) => f.id === groupByFieldId) : undefined;
  if (groupByFieldId && !groupField) throw new ReportRequestError('This field cannot be grouped.');
  const pivotPlan = req.pivot && !light ? resolvePivot(req.pivot, allDomainFields) : undefined;
  // Set by the two raw SQL domains: lets groups, totals and the pivot be computed by the database over the whole filter.
  let sqlCtx: SqlContext | undefined;
  let dateRange: DynamicQueryResponse['dateRange'];

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
      at_13ts_liters: r.at_13ts_liters != null ? Number(r.at_13ts_liters) : null,
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
        gross_liters: a.lab_session?.gross_liters != null ? Number(a.lab_session.gross_liters) : null,
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
      const clause = sqlFilterClause(TRANSIT_SPECS, flt, params);
      if (clause) conditions.push(clause);
    }
    const whereSql = conditions.join(' AND ');
    sqlCtx = { from: LIVE_PLANT_TRANSIT_SQL, whereSql, params, columns: TRANSIT_SPECS };

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
  // DOMAIN 7: VEHICLE_DISPATCH (one row per dispatched vehicle, read from the vehicle report view)
  // --------------------------------------------------------------------------
  else if (domain === 'VEHICLE_DISPATCH') {
    dateRange = resolveVehicleDateRange(filters);
    const conditions: string[] = [];
    const params: any[] = [];
    // The dispatch time range always comes first: it is the indexed condition.
    params.push(`${dateRange.from}T00:00:00.000+05:00`, `${addDays(dateRange.to, 1)}T00:00:00.000+05:00`);
    conditions.push("dispatched_at >= ($1::timestamptz AT TIME ZONE 'UTC')", "dispatched_at < ($2::timestamptz AT TIME ZONE 'UTC')");
    if (effectiveZmccId) {
      params.push(effectiveZmccId);
      conditions.push(`source_id = $${params.length}`);
    }
    for (const flt of filters) {
      const clause = sqlFilterClause(VEHICLE_SPECS, flt, params);
      if (clause) conditions.push(clause);
    }
    const whereSql = conditions.join(' AND ');
    sqlCtx = { from: VEHICLE_VIEW_SQL, whereSql, params, columns: VEHICLE_SPECS };

    const countRes = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text as count FROM ${VEHICLE_VIEW_SQL} WHERE ${whereSql}`,
      ...params
    )) as { count: string }[];
    totalCount = Number(countRes[0]?.count || 0);

    const sortDef = allDomainFields.find((f) => f.id === sortFieldId && f.sortable !== false);
    const sortExpr = sortDef ? VEHICLE_SPECS[sortDef.id]?.expr : undefined;
    const orderSql = sortExpr
      ? `${sortExpr} ${sortDirection === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, visit_id DESC`
      : 'dispatched_at DESC NULLS LAST, visit_id DESC';

    const selectSql = Object.entries(VEHICLE_SPECS)
      .map(([id, c]) => `${c.kind === 'date' ? `to_char(${c.expr}, 'YYYY-MM-DD')` : c.expr} AS "${id}"`)
      .join(', ');
    const records = (await prisma.$queryRawUnsafe(
      `SELECT visit_id, ${selectSql} FROM ${VEHICLE_VIEW_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      ...params
    )) as Record<string, any>[];

    rawRows = records.map((r) => {
      const row: Record<string, any> = { id: String(r.visit_id) };
      for (const f of VEHICLE_DISPATCH_FIELDS) {
        const v = r[f.id];
        if (v === null || v === undefined) row[f.id] = null;
        else if (f.dataType === 'number') row[f.id] = Number(v);
        else if (f.dataType === 'datetime') row[f.id] = v instanceof Date ? v.toISOString() : String(v);
        else row[f.id] = String(v);
      }
      return row;
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

  // Groups, totals and the pivot cover the WHOLE filtered result, never just the current page.
  let groupedSubtotals: GroupedSubtotal[] | undefined;
  let columnTotals: Record<string, number> | undefined;
  let pivot: PivotResult | undefined;
  if (!light) {
    if (sqlCtx) {
      const ctx = sqlCtx;
      const [groups, totals, extraKpis, pivotResult] = await Promise.all([
        groupField ? sqlGroupSubtotals(ctx, groupField, timeBucket, activeFields) : undefined,
        sqlColumnTotals(ctx, activeFields),
        sqlSummaryKpis(ctx, domain),
        pivotPlan ? sqlPivot(ctx, pivotPlan) : undefined,
      ]);
      groupedSubtotals = groups;
      columnTotals = totals;
      pivot = pivotResult;
      kpiTotals = { ...kpiTotals, extra: extraKpis };
    } else if (groupField || pivotPlan) {
      // Prisma domains: read every matching row in chunks (capped), then add up here.
      const all = await collectExportRows(req, currentUser);
      if (groupField) {
        groupedSubtotals = computeGroupedSubtotals(all.rows, groupField, timeBucket, activeFields);
        columnTotals = computeColumnTotals(all.rows, activeFields);
      }
      if (pivotPlan) pivot = computePivotFromRows(all.rows, pivotPlan);
    }
  }

  const summaryKpis = light ? [] : computeDynamicSummaryKpis(totalCount, kpiTotals);

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
    columnTotals,
    pivot,
    dateRange,
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

/** A raw SQL column: its kind and a fixed SQL expression written in this file, never user text. */
interface SqlColumn {
  kind: FilterKind;
  expr: string;
}

/** What a SQL domain is read from: FROM text, the WHERE built so far, its bound parameters, and the column allow-list. */
interface SqlContext {
  from: string;
  whereSql: string;
  params: any[];
  columns: Record<string, SqlColumn>;
}

/** A timestamp stored as UTC (no zone) shown as Pakistan local time. */
const karachiTime = (col: string) => `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')`;

const TRANSIT_SPECS: Record<string, SqlColumn> = {
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

// --- Vehicle dispatch: one fixed column list over the vehicle report view ----------------------------

const VEHICLE_VIEW_SQL = 'vw_vehicle_visit_report';

const vehicleText = (column: string): SqlColumn => ({ kind: 'string', expr: column });
const vehicleNumber = (column: string): SqlColumn => ({ kind: 'number', expr: column });
const vehicleTime = (column: string): SqlColumn => ({ kind: 'datetime', expr: column });
const vehicleDiff = (plant: string, dispatch: string): SqlColumn => ({ kind: 'number', expr: `(${plant} - ${dispatch})` });

/** Field id to SQL column. Anything not listed here can never reach the query. */
const VEHICLE_SPECS: Record<string, SqlColumn> = {
  dispatch_date: { kind: 'date', expr: `${karachiTime('dispatched_at')}::date` },
  dispatched_at: vehicleTime('dispatched_at'),
  visit_number: vehicleText('visit_number'),
  vehicle_number: vehicleText('vehicle_number'),
  token_number: vehicleText('token_number'),
  dispatch_note_number: vehicleText('dispatch_note_number'),
  reception_number: vehicleText('reception_number'),
  weight_ticket_number: vehicleText('weight_ticket_number'),
  driver_name: vehicleText('driver_name'),
  source_name: vehicleText('source_name'),
  source_code: vehicleText('source_code'),
  source_type: { kind: 'enum', expr: 'source_type' },
  stage: vehicleText('stage'),
  decision: { kind: 'enum', expr: 'decision' },
  approval_status: vehicleText('approval_status'),
  dispatch_person_decision: vehicleText('dispatch_person_decision'),
  dispatch_system_outcome: vehicleText('dispatch_system_outcome'),
  tanker_washed: { kind: 'enum', expr: `(CASE WHEN tanker_washed THEN 'YES' WHEN tanker_washed IS NOT NULL THEN 'NO' END)` },
  portions: vehicleNumber('portions'),
  plant_added_portions: vehicleNumber('plant_added_portions'),
  accepted_portions: vehicleNumber('accepted_portions'),
  rejected_portions: vehicleNumber('rejected_portions'),
  dispatch_quantity_value: vehicleNumber('dispatch_quantity_value'),
  dispatch_quantity_unit: vehicleText('dispatch_quantity_unit'),
  dispatch_gross_liters: vehicleNumber('dispatch_gross_liters'),
  received_gross_liters: vehicleNumber('received_gross_liters'),
  dispatch_at_13ts_liters: vehicleNumber('dispatch_at_13ts_liters'),
  received_at_13ts_liters: vehicleNumber('received_at_13ts_liters'),
  gross_weight_kg: vehicleNumber('gross_weight_kg'),
  tare_weight_kg: vehicleNumber('tare_weight_kg'),
  net_weight_kg: vehicleNumber('net_weight_kg'),
  dispatch_fat: vehicleNumber('dispatch_fat'),
  plant_fat: vehicleNumber('plant_fat'),
  fat_diff: vehicleDiff('plant_fat', 'dispatch_fat'),
  dispatch_lr: vehicleNumber('dispatch_lr'),
  plant_lr: vehicleNumber('plant_lr'),
  lr_diff: vehicleDiff('plant_lr', 'dispatch_lr'),
  dispatch_snf: vehicleNumber('dispatch_snf'),
  plant_snf: vehicleNumber('plant_snf'),
  snf_diff: vehicleDiff('plant_snf', 'dispatch_snf'),
  dispatch_ts: vehicleNumber('dispatch_ts'),
  plant_ts: vehicleNumber('plant_ts'),
  ts_diff: vehicleDiff('plant_ts', 'dispatch_ts'),
  gross_variance_liters: vehicleNumber('gross_variance_liters'),
  gross_variance_percent: vehicleNumber('gross_variance_percent'),
  at_13ts_variance_liters: vehicleNumber('at_13ts_variance_liters'),
  at_13ts_variance_percent: vehicleNumber('at_13ts_variance_percent'),
  gate_in_at: vehicleTime('gate_in_at'),
  first_weight_at: vehicleTime('first_weight_at'),
  second_weight_at: vehicleTime('second_weight_at'),
  gate_out_at: vehicleTime('gate_out_at'),
  reconciled_at: vehicleTime('reconciled_at'),
};

const MAX_VEHICLE_RANGE_DAYS = 366;

/** The calendar day n days after (or before) a YYYY-MM-DD day. */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The Pakistan days a vehicle report covers, taken from the filters on the dispatch date.
 * With no date filter it is the last 30 days. More than 366 days is refused.
 */
function resolveVehicleDateRange(filters: DynamicFilterClause[]): { from: string; to: string; defaulted: boolean } {
  const today = getPakistanCalendarDate();
  const bound: { lo: string | null; hi: string | null } = { lo: null, hi: null };
  const lower = (d: string) => {
    if (bound.lo === null || d > bound.lo) bound.lo = d;
  };
  const upper = (d: string) => {
    if (bound.hi === null || d < bound.hi) bound.hi = d;
  };
  for (const flt of filters) {
    if ((flt.fieldId !== 'dispatch_date' && flt.fieldId !== 'dispatched_at') || !hasValue(flt.value)) continue;
    const day = dayOf(flt.value);
    if (flt.operator === 'EQUALS') {
      lower(day);
      upper(day);
    } else if (flt.operator === 'BETWEEN') {
      needSecond(flt);
      lower(day);
      upper(dayOf(flt.valueSecondary));
    } else if (flt.operator === 'GREATER_EQUAL') lower(day);
    else if (flt.operator === 'GREATER_THAN') lower(addDays(day, 1));
    else if (flt.operator === 'LESS_EQUAL') upper(day);
    else if (flt.operator === 'LESS_THAN') upper(addDays(day, -1));
  }
  const { lo, hi } = bound;
  const defaulted = lo === null && hi === null;
  let from: string;
  let to: string;
  if (lo === null && hi === null) {
    to = today;
    from = addDays(today, -29);
  } else if (lo === null) {
    to = hi as string;
    from = addDays(to, -29);
  } else if (hi === null) {
    from = lo;
    to = from > today ? from : today;
  } else {
    from = lo;
    to = hi;
  }
  if (from > to) throw new ReportRequestError('The start date is after the end date.');
  const days = Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86400000) + 1;
  if (days > MAX_VEHICLE_RANGE_DAYS) {
    throw new ReportRequestError(`Pick at most ${MAX_VEHICLE_RANGE_DAYS} days of dispatches. You picked ${days}.`);
  }
  return { from, to, defaulted };
}

/** SQL condition for one filter on a raw SQL domain; the values go in as bound parameters. */
function sqlFilterClause(specs: Record<string, SqlColumn>, flt: DynamicFilterClause, params: any[]): string | null {
  if (!hasValue(flt.value)) return null;
  const spec = Object.prototype.hasOwnProperty.call(specs, flt.fieldId) ? specs[flt.fieldId] : undefined;
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
  // Days and moments are compared by Pakistan calendar day.
  const dayExpr = spec.kind === 'datetime' ? `${karachiTime(spec.expr)}::date` : spec.expr;
  if (op === 'BETWEEN') {
    needSecond(flt);
    return `${dayExpr} BETWEEN ${bind(dayOf(flt.value))}::date AND ${bind(dayOf(flt.valueSecondary))}::date`;
  }
  if (compare[op]) return `${dayExpr} ${compare[op]} ${bind(dayOf(flt.value))}::date`;
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
  /** Ready-made cards (the SQL domains add their own). */
  extra?: DynamicSummaryKpi[];
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

  if (totals.extra) kpis.push(...totals.extra);

  return kpis;
}

/** Weighted by litres for the quality readings, so a small load does not count as much as a big one. */
const LITER_WEIGHTED_FIELDS = new Set(['fat', 'lr', 'snf']);

const TIME_BUCKETS: TimeBucket[] = ['DAY', 'WEEK', 'MONTH'];
const AGGREGATIONS: AggregationType[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];

/** Most groups, pivot rows and pivot columns one report may return. */
const MAX_GROUPS = 1000;
const MAX_PIVOT_ROWS = 500;
const MAX_PIVOT_COLUMNS = 50;

/** A usable number, or null. Blank, missing and non-numeric values are never zero. */
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const roundTotal = (n: number): number => Number(n.toFixed(3));

/** The field whose litres weight an average of this field, if any. */
function weightFieldIdOf(f: ReportFieldDefinition): string | undefined {
  return f.weightFieldId ?? (LITER_WEIGHTED_FIELDS.has(f.id) ? 'gross_liters' : undefined);
}

/** How a number column is totalled when the user did not pick: a sum, or an average where a sum means nothing. */
function defaultAggregation(f: ReportFieldDefinition): AggregationType | null {
  if (f.dataType !== 'number') return null;
  if (f.aggregations?.includes('SUM') || f.format === 'liters') return 'SUM';
  if (f.aggregations?.includes('AVG') || f.format === 'percent' || f.format === 'temperature') return 'AVG';
  return null;
}

/**
 * One figure over a set of rows. Missing values are skipped, never counted as zero.
 * An average of a ratio field is sum(numerator) / sum(denominator); an average of a weighted field is weighted by litres.
 */
function aggregateValues(rows: Record<string, any>[], f: ReportFieldDefinition, agg: AggregationType): number | null {
  const values: number[] = [];
  for (const r of rows) {
    const n = finiteNumber(r[f.id]);
    if (n !== null) values.push(n);
  }
  if (agg === 'COUNT') return values.length;
  if (values.length === 0) return null;
  if (agg === 'SUM') return roundTotal(values.reduce((a, b) => a + b, 0));
  if (agg === 'MIN') return roundTotal(Math.min(...values));
  if (agg === 'MAX') return roundTotal(Math.max(...values));

  if (f.ratioOf) {
    let num = 0;
    let den = 0;
    for (const r of rows) {
      const n = finiteNumber(r[f.ratioOf.numerator]);
      const d = finiteNumber(r[f.ratioOf.denominator]);
      if (n === null || d === null || !(d > 0)) continue;
      num += n;
      den += d;
    }
    if (den > 0) return roundTotal((num / den) * 100);
  }
  const weightId = weightFieldIdOf(f);
  if (weightId) {
    const avg = weightedAverage(rows.map((r): [number | null, number] => [finiteNumber(r[f.id]), finiteNumber(r[weightId]) ?? 0]));
    if (avg !== null) return roundTotal(avg);
  }
  return roundTotal(values.reduce((a, b) => a + b, 0) / values.length);
}

/** One total for a column: a sum, or an average where a sum means nothing. Null when there is nothing to total. */
function aggregateColumn(rows: Record<string, any>[], f: ReportFieldDefinition): number | null {
  const agg = defaultAggregation(f);
  return agg ? aggregateValues(rows, f, agg) : null;
}

/** One total per numeric selected field. */
function computeColumnTotals(rows: Record<string, any>[], fields: ReportFieldDefinition[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const f of fields) {
    const total = aggregateColumn(rows, f);
    if (total !== null) totals[f.id] = total;
  }
  return totals;
}

/** Groups the rows by one field (days, weeks or months for date fields) and totals each numeric selected field. */
function computeGroupedSubtotals(
  rows: Record<string, any>[],
  groupField: ReportFieldDefinition,
  bucket: TimeBucket | undefined,
  fields: ReportFieldDefinition[]
): GroupedSubtotal[] {
  const groups = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const key = reportGroupKey(r[groupField.id], groupField.dataType, bucket);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  if (groups.size > MAX_GROUPS) throw new ReportRequestError(tooManyGroupsMessage());

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, records]) => ({
      groupKey: key,
      groupLabel: key,
      recordCount: records.length,
      aggregations: computeColumnTotals(records, fields),
    }));
}

function tooManyGroupsMessage(): string {
  return `More than ${MAX_GROUPS} groups. Pick a broader field or narrow the filters.`;
}

// --- Pivot --------------------------------------------------------------------------------------------

interface PivotPlan {
  rowField: ReportFieldDefinition;
  colField: ReportFieldDefinition;
  /** Absent only for COUNT, which counts rows. */
  metricField?: ReportFieldDefinition;
  aggregation: AggregationType;
  rowBucket?: TimeBucket;
  colBucket?: TimeBucket;
}

/** Checks a pivot request against the field list; anything unknown is refused. */
function resolvePivot(pivot: PivotRequest, fields: ReportFieldDefinition[]): PivotPlan {
  const find = (id: unknown) => fields.find((f) => f.id === id);
  const rowField = find(pivot.rowFieldId);
  const colField = find(pivot.colFieldId);
  if (!rowField || !colField) throw new ReportRequestError('Pick valid fields for the pivot rows and columns.');
  const aggregation = pivot.aggregation;
  if (!AGGREGATIONS.includes(aggregation)) throw new ReportRequestError('Pick Sum, Average, Count, Min or Max.');
  let metricField: ReportFieldDefinition | undefined;
  if (hasValue(pivot.metricFieldId)) {
    metricField = find(pivot.metricFieldId);
    if (!metricField || metricField.dataType !== 'number') throw new ReportRequestError('Pick a number field for the pivot value.');
  } else if (aggregation !== 'COUNT') {
    throw new ReportRequestError('Pick a number field for the pivot value.');
  }
  const rowBucket = pivot.rowBucket && TIME_BUCKETS.includes(pivot.rowBucket) ? pivot.rowBucket : undefined;
  const colBucket = pivot.colBucket && TIME_BUCKETS.includes(pivot.colBucket) ? pivot.colBucket : undefined;
  if (rowField.id === colField.id && rowBucket === colBucket) throw new ReportRequestError('Pick different fields for rows and columns.');
  return { rowField, colField, metricField, aggregation, rowBucket, colBucket };
}

/** The figure of one pivot cell, row, column or the whole result. */
function pivotValue(rows: Record<string, any>[], plan: PivotPlan): number | null {
  if (!plan.metricField) return rows.length;
  return aggregateValues(rows, plan.metricField, plan.aggregation);
}

/** Pivot from rows already in memory (the Prisma domains). Columns beyond the top 49 become one "Other" column. */
function computePivotFromRows(rows: Record<string, any>[], plan: PivotPlan): PivotResult {
  const keyOf = (r: Record<string, any>, f: ReportFieldDefinition, bucket?: TimeBucket) => reportGroupKey(r[f.id], f.dataType, bucket);

  const byRow = new Map<string, Record<string, any>[]>();
  const byCol = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const rk = keyOf(r, plan.rowField, plan.rowBucket);
    const ck = keyOf(r, plan.colField, plan.colBucket);
    (byRow.get(rk) ?? byRow.set(rk, []).get(rk)!).push(r);
    (byCol.get(ck) ?? byCol.set(ck, []).get(ck)!).push(r);
  }
  if (byRow.size > MAX_PIVOT_ROWS) throw new ReportRequestError(`More than ${MAX_PIVOT_ROWS} pivot rows. Pick a broader field or narrow the filters.`);

  // Keep the 49 columns with the biggest totals; the rest are folded into "Other".
  let keptCols = new Set(byCol.keys());
  let hasOther = false;
  if (byCol.size > MAX_PIVOT_COLUMNS) {
    hasOther = true;
    const ranked = [...byCol.entries()]
      .map(([k, list]) => [k, pivotValue(list, plan)] as const)
      .sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity) || (a[0] < b[0] ? -1 : 1));
    keptCols = new Set(ranked.slice(0, MAX_PIVOT_COLUMNS - 1).map(([k]) => k));
  }
  const colOf = (r: Record<string, any>) => {
    const k = keyOf(r, plan.colField, plan.colBucket);
    return keptCols.has(k) ? k : 'Other';
  };

  const colKeys = [...keptCols].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (hasOther) colKeys.push('Other');
  const rowKeys = [...byRow.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const cells: Record<string, Record<string, number | null>> = {};
  const rowTotals: Record<string, number | null> = {};
  const colRows = new Map<string, Record<string, any>[]>();
  for (const rk of rowKeys) {
    const list = byRow.get(rk)!;
    rowTotals[rk] = pivotValue(list, plan);
    const perCol = new Map<string, Record<string, any>[]>();
    for (const r of list) {
      const ck = colOf(r);
      (perCol.get(ck) ?? perCol.set(ck, []).get(ck)!).push(r);
      (colRows.get(ck) ?? colRows.set(ck, []).get(ck)!).push(r);
    }
    cells[rk] = {};
    for (const ck of colKeys) {
      const cellRows = perCol.get(ck);
      cells[rk][ck] = cellRows ? pivotValue(cellRows, plan) : null;
    }
  }
  const colTotals: Record<string, number | null> = {};
  for (const ck of colKeys) colTotals[ck] = colRows.has(ck) ? pivotValue(colRows.get(ck)!, plan) : null;

  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal: rows.length > 0 ? pivotValue(rows, plan) : null, hasOther };
}

// --- The same figures computed by the database (the raw SQL domains) -----------------------------------

/** Expression of a field's column; refuses an id the allow-list does not know. */
function sqlColumnOf(ctx: SqlContext, id: string): SqlColumn {
  const col = Object.prototype.hasOwnProperty.call(ctx.columns, id) ? ctx.columns[id] : undefined;
  if (!col) throw new ReportRequestError('This field cannot be used here.');
  return col;
}

/** SQL for one aggregate of one field, matching aggregateValues (missing values skipped, ratios and weights respected). */
function sqlAggregate(ctx: SqlContext, f: ReportFieldDefinition, agg: AggregationType): string {
  const e = sqlColumnOf(ctx, f.id).expr;
  if (agg === 'COUNT') return `COUNT(${e})::float8`;
  if (agg === 'SUM') return `SUM(${e})::float8`;
  if (agg === 'MIN') return `MIN(${e})::float8`;
  if (agg === 'MAX') return `MAX(${e})::float8`;
  const plain = `AVG(${e})`;
  let best = plain;
  const weightId = weightFieldIdOf(f);
  if (weightId && Object.prototype.hasOwnProperty.call(ctx.columns, weightId)) {
    const w = ctx.columns[weightId].expr;
    const ok = `${e} IS NOT NULL AND ${w} > 0`;
    best = `COALESCE(SUM((${e}) * (${w})) FILTER (WHERE ${ok}) / NULLIF(SUM(${w}) FILTER (WHERE ${ok}), 0), ${plain})`;
  }
  if (f.ratioOf) {
    const n = sqlColumnOf(ctx, f.ratioOf.numerator).expr;
    const d = sqlColumnOf(ctx, f.ratioOf.denominator).expr;
    const ok = `${n} IS NOT NULL AND ${d} > 0`;
    best = `COALESCE(100.0 * SUM(${n}) FILTER (WHERE ${ok}) / NULLIF(SUM(${d}) FILTER (WHERE ${ok}), 0), ${best})`;
  }
  return `(${best})::float8`;
}

/** SQL text of the group key: a Pakistan day, week or month for date fields; the value as text (or Unassigned) otherwise. */
function sqlKeyExpr(ctx: SqlContext, f: ReportFieldDefinition, bucket?: TimeBucket): string {
  const col = sqlColumnOf(ctx, f.id);
  if (col.kind === 'date' || col.kind === 'datetime') {
    const day = col.kind === 'datetime' ? `${karachiTime(col.expr)}::date` : `(${col.expr})::date`;
    if (bucket === 'MONTH') return `COALESCE(to_char(${day}, 'YYYY-MM'), 'Unassigned')`;
    if (bucket === 'WEEK') return `COALESCE(to_char(date_trunc('week', ${day}::timestamp), 'YYYY-MM-DD'), 'Unassigned')`;
    return `COALESCE(to_char(${day}, 'YYYY-MM-DD'), 'Unassigned')`;
  }
  return `COALESCE(NULLIF((${col.expr})::text, ''), 'Unassigned')`;
}

const sqlNumber = (v: unknown): number | null => (v === null || v === undefined ? null : roundTotal(Number(v)));

/** Aggregates of the numeric selected fields, as "<sql> AS a0, <sql> AS a1". */
function sqlFieldAggregates(ctx: SqlContext, fields: ReportFieldDefinition[]): Array<{ field: ReportFieldDefinition; alias: string; sql: string }> {
  const out: Array<{ field: ReportFieldDefinition; alias: string; sql: string }> = [];
  for (const f of fields) {
    const agg = defaultAggregation(f);
    if (!agg || !Object.prototype.hasOwnProperty.call(ctx.columns, f.id)) continue;
    out.push({ field: f, alias: `a${out.length}`, sql: sqlAggregate(ctx, f, agg) });
  }
  return out;
}

/** One GROUP BY query over the whole filter. */
async function sqlGroupSubtotals(
  ctx: SqlContext,
  groupField: ReportFieldDefinition,
  bucket: TimeBucket | undefined,
  fields: ReportFieldDefinition[]
): Promise<GroupedSubtotal[]> {
  const aggs = sqlFieldAggregates(ctx, fields);
  const key = sqlKeyExpr(ctx, groupField, bucket);
  const select = [`${key} AS k`, 'COUNT(*)::int AS n', ...aggs.map((a) => `${a.sql} AS ${a.alias}`)].join(', ');
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT ${select} FROM ${ctx.from} WHERE ${ctx.whereSql} GROUP BY 1 ORDER BY 1 LIMIT ${MAX_GROUPS + 1}`,
    ...ctx.params
  )) as Record<string, any>[];
  if (rows.length > MAX_GROUPS) throw new ReportRequestError(tooManyGroupsMessage());

  return rows.map((r) => {
    const aggregations: Record<string, number> = {};
    for (const a of aggs) {
      const v = sqlNumber(r[a.alias]);
      if (v !== null) aggregations[a.field.id] = v;
    }
    return { groupKey: String(r.k), groupLabel: String(r.k), recordCount: Number(r.n), aggregations };
  });
}

/** One total per numeric selected field over the whole filter. */
async function sqlColumnTotals(ctx: SqlContext, fields: ReportFieldDefinition[]): Promise<Record<string, number>> {
  const aggs = sqlFieldAggregates(ctx, fields);
  if (aggs.length === 0) return {};
  const select = aggs.map((a) => `${a.sql} AS ${a.alias}`).join(', ');
  const rows = (await prisma.$queryRawUnsafe(`SELECT ${select} FROM ${ctx.from} WHERE ${ctx.whereSql}`, ...ctx.params)) as Record<string, any>[];
  const totals: Record<string, number> = {};
  for (const a of aggs) {
    const v = sqlNumber(rows[0]?.[a.alias]);
    if (v !== null) totals[a.field.id] = v;
  }
  return totals;
}

/** The KPI cards of a SQL domain: litres sent, litres received and the loss or variance. */
async function sqlSummaryKpis(ctx: SqlContext, domain: ReportDomain): Promise<DynamicSummaryKpi[]> {
  const spec =
    domain === 'VEHICLE_DISPATCH'
      ? [
          { id: 'kpi-dispatched', label: 'Dispatched', fieldId: 'dispatch_gross_liters' },
          { id: 'kpi-received', label: 'Plant Received', fieldId: 'received_gross_liters' },
          { id: 'kpi-variance', label: 'Net Variance', fieldId: 'gross_variance_liters' },
        ]
      : domain === 'PLANT_TRANSIT'
      ? [
          { id: 'kpi-dispatched', label: 'Dispatched', fieldId: 'dispatched_liters' },
          { id: 'kpi-received', label: 'Plant Received', fieldId: 'plant_received_liters' },
          { id: 'kpi-transit-loss', label: 'Transit Loss', fieldId: 'transit_loss_liters' },
        ]
      : [];
  if (spec.length === 0) return [];
  const sums = spec.map((s, i) => `SUM(${sqlColumnOf(ctx, s.fieldId).expr})::float8 AS s${i}`).join(', ');
  const rows = (await prisma.$queryRawUnsafe(`SELECT ${sums} FROM ${ctx.from} WHERE ${ctx.whereSql}`, ...ctx.params)) as Record<string, any>[];
  const kpis: DynamicSummaryKpi[] = [];
  spec.forEach((s, i) => {
    const v = sqlNumber(rows[0]?.[`s${i}`]);
    if (v !== null) kpis.push({ id: s.id, label: s.label, value: v, unit: 'L', format: 'liters' });
  });
  return kpis;
}

/**
 * Pivot over the whole filter: one query for the column totals (to pick the top 49), one to count the rows,
 * one GROUPING SETS query for the cells with their row, column and grand totals.
 */
async function sqlPivot(ctx: SqlContext, plan: PivotPlan): Promise<PivotResult> {
  const agg = plan.metricField ? sqlAggregate(ctx, plan.metricField, plan.aggregation) : 'COUNT(*)::float8';
  const rowKey = sqlKeyExpr(ctx, plan.rowField, plan.rowBucket);
  const colKey = sqlKeyExpr(ctx, plan.colField, plan.colBucket);
  const base = `FROM ${ctx.from} WHERE ${ctx.whereSql}`;

  const rowCount = (await prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT ${rowKey})::int AS n ${base}`, ...ctx.params)) as { n: number }[];
  if (Number(rowCount[0]?.n ?? 0) > MAX_PIVOT_ROWS) {
    throw new ReportRequestError(`More than ${MAX_PIVOT_ROWS} pivot rows. Pick a broader field or narrow the filters.`);
  }

  const colTotalRows = (await prisma.$queryRawUnsafe(
    `SELECT ${colKey} AS c, ${agg} AS v ${base} GROUP BY 1 LIMIT ${MAX_GROUPS * 20 + 1}`,
    ...ctx.params
  )) as { c: string; v: number | null }[];
  if (colTotalRows.length > MAX_GROUPS * 20) throw new ReportRequestError(tooManyGroupsMessage());

  const params = [...ctx.params];
  let colExpr = colKey;
  let kept = colTotalRows.map((r) => String(r.c));
  const hasOther = colTotalRows.length > MAX_PIVOT_COLUMNS;
  if (hasOther) {
    kept = [...colTotalRows]
      .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || (String(a.c) < String(b.c) ? -1 : 1))
      .slice(0, MAX_PIVOT_COLUMNS - 1)
      .map((r) => String(r.c));
    params.push(kept);
    colExpr = `(CASE WHEN ${colKey} = ANY($${params.length}::text[]) THEN ${colKey} ELSE 'Other' END)`;
  }

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT ${rowKey} AS r, ${colExpr} AS c, ${agg} AS v ${base} GROUP BY GROUPING SETS ((1, 2), (1), (2), ())`,
    ...params
  )) as { r: string | null; c: string | null; v: number | null }[];

  const colKeys = [...kept].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (hasOther) colKeys.push('Other');
  const cells: Record<string, Record<string, number | null>> = {};
  const rowTotals: Record<string, number | null> = {};
  const colTotals: Record<string, number | null> = {};
  let grandTotal: number | null = null;
  const rowSet = new Set<string>();
  for (const r of rows) {
    const v = sqlNumber(r.v);
    if (r.r !== null && r.c !== null) {
      rowSet.add(r.r);
      (cells[r.r] ??= {})[r.c] = v;
    } else if (r.r !== null) {
      rowSet.add(r.r);
      rowTotals[r.r] = v;
    } else if (r.c !== null) colTotals[r.c] = v;
    else grandTotal = v;
  }
  const rowKeys = [...rowSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const rk of rowKeys) {
    cells[rk] ??= {};
    for (const ck of colKeys) cells[rk][ck] ??= null;
  }
  for (const ck of colKeys) colTotals[ck] ??= null;
  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal, hasOther };
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
async function collectExportRows(
  req: Pick<DynamicQueryRequest, 'domain' | 'selectedFieldIds' | 'filters' | 'sortFieldId' | 'sortDirection' | 'zmccId'>,
  currentUser: User | null
) {
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
