'use client';

import { currentPageSize } from '@/lib/pagination';
import { Pagination, useListPageSize } from '@/components/ui/pagination';

export const DEFAULT_PAGE_SIZE = 25;

/** Number of pages for `total` rows (at least 1). Fewer rows per page on a phone. */
export const pageCount = (total: number, pageSize = currentPageSize()) => Math.max(1, Math.ceil(total / pageSize));

/** Rows of the given 1-based page. */
export function paginate<T>(rows: T[], page: number, pageSize = currentPageSize()): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

/** Previous and Next, the same control as every other list. */
export function Pager({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
}) {
  const pageSize = useListPageSize(25);
  if (totalPages <= 1 && (total ?? 0) === 0) return null;
  return <Pagination page={page} totalPages={totalPages} totalRecords={total ?? 0} pageSize={pageSize} onPageChange={onPageChange} className="px-0 pt-2" />;
}
