export const DEFAULT_PAGE_SIZE = 25;

export function totalPagesFor(totalRecords: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalRecords / Math.max(1, pageSize)));
}

/** A page outside the list moves to the nearest real page, for example after rows were removed. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, totalPages));
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** The first and last row shown on a page, counting from 1. Both are 0 for an empty list. */
export function pageRange(page: number, pageSize: number, totalRecords: number): { from: number; to: number } {
  if (totalRecords <= 0) return { from: 0, to: 0 };
  return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, totalRecords) };
}
