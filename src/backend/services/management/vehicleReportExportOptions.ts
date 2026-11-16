/** What the person can choose for the Excel file. No server code here, so the screen can import it. */

export const EXPORT_MAX_ROWS = 50_000;

export const EXPORT_GROUPS = [
  { key: 'vehicle', label: 'Vehicle papers' },
  { key: 'portion', label: 'Portion and seals' },
  { key: 'quality', label: 'Fat, LR, SNF, TS' },
  { key: 'tests', label: 'All lab tests' },
  { key: 'quantity', label: 'Quantity and variance' },
  { key: 'weights', label: 'Weights' },
  { key: 'timings', label: 'Timings' },
] as const;

export type ExportGroupKey = (typeof EXPORT_GROUPS)[number]['key'];
