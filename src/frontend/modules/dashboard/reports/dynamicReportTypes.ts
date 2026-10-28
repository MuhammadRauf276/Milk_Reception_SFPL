export type ReportDomain =
  | 'MOT_COLLECTIONS'
  | 'HC_SUPPLIERS'
  | 'JOURNEY_RECONCILIATION'
  | 'TANK_STORAGE'
  | 'PLANT_TRANSIT'
  | 'QUALITY_SCREENING';

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
  isSystemDefault?: boolean;
  createdAt?: string;
}

export interface DynamicQueryRequest {
  domain: ReportDomain;
  selectedFieldIds: string[];
  filters: DynamicFilterClause[];
  groupByFieldId?: string;
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
}

export interface DynamicExportRequest {
  domain: ReportDomain;
  selectedFieldIds: string[];
  filters: DynamicFilterClause[];
  groupByFieldId?: string;
  sortFieldId?: string;
  sortDirection?: 'asc' | 'desc';
  zmccId?: string;
  exportFormat: 'XLSX' | 'CSV';
  reportTitle?: string;
}
