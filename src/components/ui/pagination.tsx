'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clampPage, DEFAULT_PAGE_SIZE, PHONE_PAGE_SIZE, PHONE_QUERY, pageRange, pageSlice, totalPagesFor } from '@/lib/pagination';
import { formatNumber } from '@/lib/format';
import { Button } from './button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalRecords: number;
  /** Rows per page. Adds "26 to 50 of 120" when known. */
  pageSize?: number;
  noun?: string;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Previous and Next with large touch targets. Shows only the count when there is one page. */
export function Pagination({ page, totalPages, totalRecords, pageSize, noun = 'records', disabled, onPageChange, className }: PaginationProps) {
  const count = `${formatNumber(totalRecords)} ${noun}`;
  if (totalPages <= 1) {
    return <p className={cn('px-3 py-2 text-xs text-muted-foreground tabular-nums', className)}>{count}</p>;
  }
  const range = pageSize ? pageRange(page, pageSize, totalRecords) : null;
  return (
    <nav aria-label="Pages" className={cn('flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2', className)}>
      <p className="min-w-0 text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {range ? `${formatNumber(range.from)} to ${formatNumber(range.to)} of ${count}` : count}
        <span className="font-medium whitespace-nowrap text-foreground"> · Page {page} of {totalPages}</span>
      </p>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" className="h-11 px-3" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button type="button" variant="outline" className="h-11 px-3" disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** Rows per page: fewer on a phone. Starts at the desktop size, as the server does, then follows the screen. */
export function useListPageSize(desktop: number = DEFAULT_PAGE_SIZE): number {
  const isPhone = React.useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  return isPhone ? Math.min(PHONE_PAGE_SIZE, desktop) : desktop;
}

/**
 * Pages through a list already on screen. Stays on the page when a live refresh brings the same rows,
 * and goes back to page 1 when the list really changes, such as after a search or filter.
 */
export function usePagedRows<T>(rows: readonly T[], getId: (row: T) => string, pageSizeOverride?: number) {
  const screenSize = useListPageSize();
  const pageSize = pageSizeOverride ?? screenSize;
  const [wanted, setWanted] = React.useState(1);
  const totalPages = totalPagesFor(rows.length, pageSize);
  const page = clampPage(wanted, totalPages);
  const pageRows = React.useMemo(() => pageSlice(rows, page, pageSize), [rows, page, pageSize]);

  const firstShown = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (page > 1 && firstShown.current !== null && !rows.some((r) => getId(r) === firstShown.current)) setWanted(1);
    firstShown.current = pageRows.length > 0 ? getId(pageRows[0]) : null;
    // Only a new list should run this, not a new getId function from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, page, pageRows]);

  return { page, totalPages, pageRows, setPage: setWanted, pageSize, totalRecords: rows.length };
}
