'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export const DEFAULT_PAGE_SIZE = 25;

/** Number of pages for `total` rows (at least 1). */
export const pageCount = (total: number, pageSize = DEFAULT_PAGE_SIZE) => Math.max(1, Math.ceil(total / pageSize));

/** Rows of the given 1-based page. */
export function paginate<T>(rows: T[], page: number, pageSize = DEFAULT_PAGE_SIZE): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

/** Simple previous / next pager. Renders nothing when there is a single page. */
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
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-2">
      <span className="text-xs text-slate-500">
        Page {page} of {totalPages}
        {total !== undefined ? ` (${total} total)` : ''}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border hover:bg-subtle disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border hover:bg-subtle disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
