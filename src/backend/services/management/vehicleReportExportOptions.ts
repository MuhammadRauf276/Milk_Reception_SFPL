/** What the person can choose for the Excel file. No server code here, so the screen can import it. */

/** Most portions one file may hold. */
export const EXPORT_MAX_ROWS = 50_000;
/** Most rows the Lab tests sheet may hold (one row per portion and test). */
export const EXPORT_MAX_TEST_ROWS = 400_000;

export const EXPORT_SHEETS = [
  { key: 'summary', label: 'Summary', hint: 'Totals per source' },
  { key: 'vehicles', label: 'Vehicles', hint: 'One row per vehicle' },
  { key: 'portions', label: 'Portions', hint: 'One row per compartment' },
  { key: 'tests', label: 'Lab tests', hint: 'One row per test' },
] as const;
export type ExportSheetKey = (typeof EXPORT_SHEETS)[number]['key'];

/** Which side of each comparison goes in the file. Fewer choices, fewer columns. */
export const EXPORT_VALUES = [
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'plant', label: 'Plant' },
  { key: 'diff', label: 'Difference' },
] as const;
export type ExportValueKey = (typeof EXPORT_VALUES)[number]['key'];

export const EXPORT_GROUPS = [
  { key: 'quality', label: 'Fat, LR, SNF, TS' },
  { key: 'quantity', label: 'Quantity and variance' },
  { key: 'weights', label: 'Weights' },
  { key: 'timings', label: 'Gate and timings' },
  { key: 'papers', label: 'Papers and decisions' },
  { key: 'seals', label: 'Seals (Portions sheet)' },
] as const;
export type ExportGroupKey = (typeof EXPORT_GROUPS)[number]['key'];

export const DEFAULT_SHEETS: ExportSheetKey[] = ['summary', 'vehicles'];
export const ALL_VALUES: ExportValueKey[] = EXPORT_VALUES.map((v) => v.key);
export const DEFAULT_GROUPS: ExportGroupKey[] = ['quality', 'quantity', 'weights', 'timings'];
