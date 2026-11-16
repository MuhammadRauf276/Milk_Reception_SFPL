export type ReportDomain =
  | 'MOT_COLLECTIONS'
  | 'HC_SUPPLIERS'
  | 'JOURNEY_RECONCILIATION'
  | 'TANK_STORAGE'
  | 'PLANT_TRANSIT'
  | 'QUALITY_SCREENING'
  | 'VEHICLE_DISPATCH';

export type FieldCategory =
  | 'IDENTIFICATION'
  | 'TIMING'
  | 'OPERATIONAL'
  | 'VOLUMES'
  | 'QUALITY'
  | 'LOSS_FINANCIAL'
  | 'GEOLOCATION';

export type FieldDataType = 'string' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum';

export type FieldFormat =
  | 'text'
  | 'number'
  | 'liters'
  | 'percent'
  | 'temperature'
  | 'date'
  | 'datetime'
  | 'status_pill';

export type AggregationType = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';

export interface ReportFieldDefinition {
  id: string;
  label: string;
  category: FieldCategory;
  dataType: FieldDataType;
  format?: FieldFormat;
  unit?: string;
  align?: 'left' | 'right' | 'center';
  defaultSelected?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  aggregations?: AggregationType[];
  enumValues?: string[];
  description?: string;
  /** Averages of this field are weighted by the litres in this other field. */
  weightFieldId?: string;
  /** A percentage that is a ratio: its total is 100 x sum(numerator) / sum(denominator), not an average of row percentages. */
  ratioOf?: { numerator: string; denominator: string };
}

export type FilterOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'CONTAINS'
  | 'STARTS_WITH'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'GREATER_EQUAL'
  | 'LESS_EQUAL'
  | 'BETWEEN'
  | 'IN_LIST';

export interface DynamicFilterClause {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value: any;
  valueSecondary?: any; // Used for BETWEEN operator
}

export interface SavedReportTemplate {
  id: string;
  name: string;
  description: string;
  domain: ReportDomain;
  selectedFieldIds: string[];
  filters: DynamicFilterClause[];
  groupByFieldId?: string;
  sortFieldId?: string;
  sortDirection?: 'asc' | 'desc';
  timeBucket?: TimeBucket;
  isSystemDefault?: boolean;
  createdAt?: string;
}

export type TimeBucket = 'DAY' | 'WEEK' | 'MONTH';

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = { DAY: 'Day', WEEK: 'Week', MONTH: 'Month' };

/** True for fields whose values are calendar days or moments, so they can be bucketed. */
export const isTimeField = (f: { dataType: FieldDataType } | undefined): boolean =>
  f?.dataType === 'date' || f?.dataType === 'datetime';

const PAKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * The group key of one value. Days and moments become a Pakistan calendar day, week (Monday's date) or month.
 * Other values become their text; empty values become "Unassigned".
 */
export function reportGroupKey(value: unknown, dataType: FieldDataType, bucket?: TimeBucket): string {
  if (value === null || value === undefined || value === '') return 'Unassigned';
  if (dataType !== 'date' && dataType !== 'datetime') return String(value);
  let day: string;
  if (dataType === 'date') {
    day = String(value).slice(0, 10);
  } else {
    const t = new Date(String(value)).getTime();
    if (Number.isNaN(t)) return 'Unassigned';
    day = new Date(t + PAKISTAN_OFFSET_MS).toISOString().slice(0, 10);
  }
  const b = bucket ?? 'DAY';
  if (b === 'MONTH') return day.slice(0, 7);
  if (b === 'WEEK') {
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}

export interface PivotRequest {
  rowFieldId: string;
  colFieldId: string;
  /** Not needed for COUNT, which counts rows. */
  metricFieldId?: string;
  aggregation: AggregationType;
  rowBucket?: TimeBucket;
  colBucket?: TimeBucket;
}

export interface PivotResult {
  rowKeys: string[];
  colKeys: string[];
  cells: Record<string, Record<string, number | null>>;
  rowTotals: Record<string, number | null>;
  colTotals: Record<string, number | null>;
  grandTotal: number | null;
  /** True when more than 49 columns were folded into one "Other" column. */
  hasOther: boolean;
}

export interface DynamicQueryRequest {
  domain: ReportDomain;
  selectedFieldIds: string[];
  filters: DynamicFilterClause[];
  groupByFieldId?: string;
  timeBucket?: TimeBucket;
  pivot?: PivotRequest;
  sortFieldId?: string;
  sortDirection?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  zmccId?: string;
}

export interface DynamicSummaryKpi {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  format?: FieldFormat;
  changeVsPriorPct?: number;
}

export interface GroupedSubtotal {
  groupKey: string;
  groupLabel: string;
  recordCount: number;
  aggregations: Record<string, number>;
}

export interface DynamicQueryResponse {
  domain: ReportDomain;
  fields: ReportFieldDefinition[];
  rows: Record<string, any>[];
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  summaryKpis: DynamicSummaryKpi[];
  groupedSubtotals?: GroupedSubtotal[];
  /** One total per numeric selected field over the whole filter, not just this page. Absent when it was not computed. */
  columnTotals?: Record<string, number>;
  pivot?: PivotResult;
  /** The dates a vehicle report covers (Pakistan days), and whether the default was applied. */
  dateRange?: { from: string; to: string; defaulted: boolean };
}

export interface DynamicExportRequest {
  domain: ReportDomain;
  selectedFieldIds: string[];
  filters: DynamicFilterClause[];
  groupByFieldId?: string;
  timeBucket?: TimeBucket;
  sortFieldId?: string;
  sortDirection?: 'asc' | 'desc';
  zmccId?: string;
  exportFormat: 'XLSX' | 'CSV';
  reportTitle?: string;
}
