import { formatLossGain, formatLossGainPercent, lossGainKind } from '@/lib/lossGain';

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

/**
 * Loss and gain follow one rule everywhere: difference = received minus sent (later stage minus earlier stage).
 * net: the signed difference, where a total over many records is the net of gains and losses.
 * loss_only: the size of each loss (rows with a gain are blank). gain_only: the size of each gain.
 */
export type LossGainKind = 'net' | 'loss_only' | 'gain_only';

/** One cell of a report row. */
export type ReportCellValue = string | number | boolean | null;
export type ReportRow = Record<string, ReportCellValue>;

/** What a filter compares with. */
export type FilterValue = string | number | null;

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
  /** Set on loss and gain fields: shows as "Loss 120 L" or "Gain 35 L" and exports as a signed number. */
  lossGain?: LossGainKind;
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
  value: FilterValue;
  valueSecondary?: FilterValue; // Used for BETWEEN operator
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
  /** Pivot settings: row field, column field, buckets, value field and how it is added up. */
  pivot?: PivotRequest;
  /** A quick range such as Last 7 Days is saved by name, so it moves with today when the template is opened. */
  datePreset?: DatePreset;
  /** A custom range (Pakistan days, YYYY-MM-DD). Used when no preset is saved. */
  dateFrom?: string;
  dateTo?: string;
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
  /** Set on loss and gain cards: the value is signed (received minus sent). */
  lossGain?: LossGainKind;
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
  rows: ReportRow[];
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

// ============================================================================
// Date range (Pakistan days) shared by the screen, the saved templates and the tests
// ============================================================================

export type DatePreset = 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'LAST_30' | 'MTD';

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_7: 'Last 7 Days',
  LAST_30: 'Last 30 Days',
  MTD: 'MTD',
};

export const DATE_PRESETS = Object.keys(DATE_PRESET_LABELS) as DatePreset[];

/** The longest range one report may cover. */
export const MAX_DATE_RANGE_DAYS = 366;

export interface DateRange {
  from: string;
  to: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

const dayMs = (day: string) => new Date(`${day}T00:00:00.000Z`).getTime();

/** The calendar day n days after (or before) a YYYY-MM-DD day. */
export function shiftDay(day: string, n: number): string {
  return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** How many calendar days a range covers, both ends included. */
export function daysInRange(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
}

/** The days a quick range covers, counted back from today (a Pakistan day). */
export function resolveDatePreset(preset: DatePreset, today: string): DateRange {
  if (preset === 'TODAY') return { from: today, to: today };
  if (preset === 'YESTERDAY') {
    const y = shiftDay(today, -1);
    return { from: y, to: y };
  }
  if (preset === 'LAST_7') return { from: shiftDay(today, -6), to: today };
  if (preset === 'LAST_30') return { from: shiftDay(today, -29), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** The quick range that covers exactly these days, if any. */
export function detectDatePreset(range: DateRange, today: string): DatePreset | null {
  return (
    DATE_PRESETS.find((p) => {
      const r = resolveDatePreset(p, today);
      return r.from === range.from && r.to === range.to;
    }) ?? null
  );
}

/** A plain-words problem with a custom range, or null when it can be used. */
export function checkDateRange(from: string, to: string): string | null {
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) return 'Pick both dates.';
  if (from > to) return 'The start date is after the end date.';
  const days = daysInRange(from, to);
  if (days > MAX_DATE_RANGE_DAYS) return `Pick at most ${MAX_DATE_RANGE_DAYS} days. You picked ${days}.`;
  return null;
}

/** The field a date range filters: the first calendar-day field of the report type. Tanks have none. */
export function pickDateFieldId(fields: ReportFieldDefinition[]): string | undefined {
  return (fields.find((f) => f.dataType === 'date') ?? fields.find((f) => f.id.includes('date')))?.id;
}

/** The filter that keeps one day, or the days from..to, of a date field. */
export function buildDateClause(fieldId: string, range: DateRange): DynamicFilterClause {
  if (range.from === range.to) return { id: `flt-date-${fieldId}`, fieldId, operator: 'EQUALS', value: range.from };
  return { id: `flt-date-${fieldId}`, fieldId, operator: 'BETWEEN', value: range.from, valueSecondary: range.to };
}

/** The days a date filter covers, read back from the filter list. Null when there is no complete date filter. */
export function readDateRange(filters: DynamicFilterClause[], fieldId: string | undefined): DateRange | null {
  if (!fieldId) return null;
  const clause = filters.find((f) => f.fieldId === fieldId && (f.operator === 'EQUALS' || f.operator === 'BETWEEN'));
  if (!clause || typeof clause.value !== 'string' || !DAY_PATTERN.test(clause.value)) return null;
  if (clause.operator === 'EQUALS') return { from: clause.value, to: clause.value };
  const to = clause.valueSecondary;
  return typeof to === 'string' && DAY_PATTERN.test(to) ? { from: clause.value, to } : null;
}

/** The filter list with the date range of this field replaced (or removed when range is null). */
export function withDateRange(filters: DynamicFilterClause[], fieldId: string, range: DateRange | null): DynamicFilterClause[] {
  const others = filters.filter((f) => f.fieldId !== fieldId);
  return range ? [...others, buildDateClause(fieldId, range)] : others;
}

// ============================================================================
// Loss and gain: signed difference = received minus sent
// ============================================================================

export type LossGainTone = 'loss' | 'gain' | 'even';

/** The tone of a value of a loss or gain field. Net values follow the app-wide rule in src/lib/lossGain.ts. */
export function lossGainToneOf(value: number, kind: LossGainKind = 'net'): LossGainTone {
  if (kind === 'loss_only') return value > 0 ? 'loss' : 'even';
  if (kind === 'gain_only') return value > 0 ? 'gain' : 'even';
  return lossGainKind(value) ?? 'even';
}

/** "Loss 120 L", "Gain 35 L" or "Even". For loss_only and gain_only fields the value is already a size. */
export function formatLossGainText(value: number, unit: string, kind: LossGainKind = 'net'): string {
  if (kind === 'net') return (unit === '%' ? formatLossGainPercent(value) : formatLossGain(value, ` ${unit}`)) || 'Even';
  const tone = lossGainToneOf(value, kind);
  if (tone === 'even') return 'Even';
  const amount = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: unit === '%' ? 2 : 0, maximumFractionDigits: 2 });
  return `${tone === 'loss' ? 'Loss' : 'Gain'} ${amount}${unit === '%' ? '%' : ` ${unit}`}`;
}

/** The unit a loss or gain field is shown in. */
export const lossGainUnit = (f: Pick<ReportFieldDefinition, 'format'>): string => (f.format === 'percent' ? '%' : 'L');

// ============================================================================
// Old field ids that still load: a loss-only field became a signed Loss / Gain field
// ============================================================================

export const FIELD_ID_ALIASES: Partial<Record<ReportDomain, Record<string, string>>> = {
  PLANT_TRANSIT: {
    transit_loss_liters: 'transit_diff_liters',
    transit_loss_pct: 'transit_diff_pct',
  },
  JOURNEY_RECONCILIATION: {
    loss_liters: 'route_diff_liters',
    loss_pct: 'route_diff_pct',
  },
};

/** The current id of a field that may have an old name. */
export function canonicalFieldId(domain: ReportDomain, id: string): string {
  return FIELD_ID_ALIASES[domain]?.[id] ?? id;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TIME_BUCKET_VALUES: TimeBucket[] = ['DAY', 'WEEK', 'MONTH'];
const AGGREGATION_VALUES: AggregationType[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
const OPERATOR_VALUES: FilterOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'GREATER_THAN',
  'LESS_THAN',
  'GREATER_EQUAL',
  'LESS_EQUAL',
  'BETWEEN',
  'IN_LIST',
];
const DOMAIN_VALUES: ReportDomain[] = [
  'MOT_COLLECTIONS',
  'HC_SUPPLIERS',
  'JOURNEY_RECONCILIATION',
  'TANK_STORAGE',
  'PLANT_TRANSIT',
  'QUALITY_SCREENING',
  'VEHICLE_DISPATCH',
];

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function normalizePivot(domain: ReportDomain, raw: unknown): PivotRequest | undefined {
  if (!isRecord(raw)) return undefined;
  const rowFieldId = text(raw.rowFieldId);
  const colFieldId = text(raw.colFieldId);
  const aggregation = AGGREGATION_VALUES.find((a) => a === raw.aggregation);
  if (!rowFieldId || !colFieldId || !aggregation) return undefined;
  const metric = text(raw.metricFieldId);
  const rowBucket = TIME_BUCKET_VALUES.find((b) => b === raw.rowBucket);
  const colBucket = TIME_BUCKET_VALUES.find((b) => b === raw.colBucket);
  return {
    rowFieldId: canonicalFieldId(domain, rowFieldId),
    colFieldId: canonicalFieldId(domain, colFieldId),
    aggregation,
    ...(metric ? { metricFieldId: canonicalFieldId(domain, metric) } : {}),
    ...(rowBucket ? { rowBucket } : {}),
    ...(colBucket ? { colBucket } : {}),
  };
}

/**
 * A saved template read back from storage. Keys an older template does not have fall back to defaults,
 * and old field ids become their current ids. Returns null when it is not a template at all.
 */
export function normalizeSavedTemplate(raw: unknown): SavedReportTemplate | null {
  if (!isRecord(raw)) return null;
  const domain = DOMAIN_VALUES.find((d) => d === raw.domain);
  const id = text(raw.id);
  if (!domain || !id) return null;
  const ids = (list: unknown) =>
    Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').map((x) => canonicalFieldId(domain, x)) : [];
  const filters: DynamicFilterClause[] = Array.isArray(raw.filters)
    ? raw.filters.filter(isRecord).flatMap((f) => {
        const fieldId = text(f.fieldId);
        const operator = OPERATOR_VALUES.find((o) => o === f.operator);
        if (!fieldId || !operator) return [];
        const clause: DynamicFilterClause = {
          id: text(f.id) ?? `flt-${fieldId}`,
          fieldId: canonicalFieldId(domain, fieldId),
          operator,
          value: typeof f.value === 'string' || typeof f.value === 'number' ? f.value : null,
        };
        if (typeof f.valueSecondary === 'string' || typeof f.valueSecondary === 'number') clause.valueSecondary = f.valueSecondary;
        return [clause];
      })
    : [];
  const group = text(raw.groupByFieldId);
  const sort = text(raw.sortFieldId);
  const preset = DATE_PRESETS.find((p) => p === raw.datePreset);
  const dateFrom = text(raw.dateFrom);
  const dateTo = text(raw.dateTo);
  const hasRange = !!dateFrom && !!dateTo && checkDateRange(dateFrom, dateTo) === null;
  return {
    id,
    name: text(raw.name) ?? 'Saved view',
    description: typeof raw.description === 'string' ? raw.description : '',
    domain,
    selectedFieldIds: ids(raw.selectedFieldIds),
    filters,
    groupByFieldId: group ? canonicalFieldId(domain, group) : undefined,
    sortFieldId: sort ? canonicalFieldId(domain, sort) : undefined,
    sortDirection: raw.sortDirection === 'asc' || raw.sortDirection === 'desc' ? raw.sortDirection : undefined,
    timeBucket: TIME_BUCKET_VALUES.find((b) => b === raw.timeBucket),
    pivot: normalizePivot(domain, raw.pivot),
    datePreset: preset,
    dateFrom: !preset && hasRange ? dateFrom : undefined,
    dateTo: !preset && hasRange ? dateTo : undefined,
    isSystemDefault: raw.isSystemDefault === true,
    createdAt: text(raw.createdAt),
  };
}

/** What a template stores about the date range: a quick range by name, or the two days. The date filter itself is left out of filters. */
export function dateSettingsForTemplate(
  filters: DynamicFilterClause[],
  dateFieldId: string | undefined,
  today: string
): { datePreset?: DatePreset; dateFrom?: string; dateTo?: string; filters: DynamicFilterClause[] } {
  const range = readDateRange(filters, dateFieldId);
  if (!range || !dateFieldId) return { filters };
  const rest = filters.filter((f) => f.fieldId !== dateFieldId);
  const preset = detectDatePreset(range, today);
  return preset ? { datePreset: preset, filters: rest } : { dateFrom: range.from, dateTo: range.to, filters: rest };
}

/** The filter list a template opens with: its own filters plus its date range (a quick range counts back from today). */
export function filtersForTemplate(template: SavedReportTemplate, dateFieldId: string | undefined, today: string): DynamicFilterClause[] {
  const filters = template.filters ?? [];
  if (!dateFieldId) return filters;
  if (template.datePreset) return withDateRange(filters, dateFieldId, resolveDatePreset(template.datePreset, today));
  if (template.dateFrom && template.dateTo) return withDateRange(filters, dateFieldId, { from: template.dateFrom, to: template.dateTo });
  return filters;
}
