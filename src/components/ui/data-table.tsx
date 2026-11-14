'use client';

import * as React from 'react';
import { ChevronDown, Columns3, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { EmptyState, ErrorState } from './empty-state';
import { SkeletonTable } from './loaders';
import { Pagination, usePagedRows } from './pagination';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { TableWrapper } from './table-wrapper';
import { DEFAULT_PAGE_SIZE, PHONE_PAGE_SIZE } from '@/lib/pagination';
import { formatLabel } from '@/lib/format';

export interface DataColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Plain-text name, used for the phone card label and the column picker. */
  label?: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** The main line of the phone row, usually the name or code. */
  primary?: boolean;
  /** Buttons and menus. On phones they show when the row is opened. */
  actions?: boolean;
  /** Leave this column out of the phone row. */
  hideOnCard?: boolean;
  /** Starts hidden in the column picker. */
  defaultHidden?: boolean;
  /** Shown under the main item on the phone row, before other details. */
  cardAlways?: boolean;
}


export interface BulkAction<T> {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  onRun: (rows: T[]) => void | Promise<void>;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Dims rows while newer data loads, so the list does not jump. */
  stale?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Shown under a row when it returns content, such as expanded details. */
  renderExpanded?: (row: T) => React.ReactNode;
  bulkActions?: BulkAction<T>[];
  /** Saves the column choice on this device under this name. Leave out to hide the picker. */
  columnPickerId?: string;
  /** How much width the table needs before phone rows turn into columns. */
  tableFrom?: 'md' | 'lg';
  /** The screen's own pagination bar or infinite scroll loader. Turns off the built-in pages. */
  footer?: React.ReactNode;
  /** Set false when the screen already pages, or every row must stay in view. */
  paginate?: boolean;
  /** Rows per page for the built-in pages. */
  pageSize?: number;
  /** What the rows are called in the count, such as "vehicles". */
  noun?: string;
  className?: string;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const CARD_CLASS = { md: '@3xl:hidden', lg: '@5xl:hidden' } as const;
const TABLE_CLASS = { md: 'hidden @3xl:block', lg: 'hidden @5xl:block' } as const;
/** The widths behind @3xl and @5xl, in pixels. */
const TABLE_FROM_PX = { md: 768, lg: 1024 } as const;

/**
 * Width of an element, kept current. Null until measured, so the first paint from the server and the browser match;
 * the CSS classes pick the right layout for that moment, and then only that layout is built.
 */
function useWidth(el: HTMLElement | null): number | null {
  const [width, setWidth] = React.useState<number | null>(null);
  // Watches the element itself, so it starts when the table appears, not while the loading skeleton shows.
  React.useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

function readHidden(id: string | undefined): string[] | null {
  if (!id || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`table-columns:${id}`);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * The one table for lists. Follows the width of its container, not the screen:
 * short rows that open on tap when narrow, columns when wide. Nothing is cut off at any width.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading,
  stale,
  error,
  onRetry,
  emptyTitle = 'No records',
  emptyDescription,
  emptyAction,
  onRowClick,
  rowClassName,
  renderExpanded,
  bulkActions,
  columnPickerId,
  tableFrom = 'md',
  footer,
  paginate = true,
  pageSize,
  noun,
  className,
}: DataTableProps<T>) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [openCards, setOpenCards] = React.useState<ReadonlySet<string>>(new Set());
  const toggleCard = (id: string) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [running, setRunning] = React.useState(false);
  const [hidden, setHidden] = React.useState<string[]>(
    () => readHidden(columnPickerId) ?? columns.filter((c) => c.defaultHidden).map((c) => c.key)
  );

  const toggleColumn = (key: string) => {
    setHidden((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(`table-columns:${columnPickerId}`, JSON.stringify(next));
      } catch {
        // The choice just will not be remembered.
      }
      return next;
    });
  };

  const topRef = React.useRef<HTMLDivElement | null>(null);
  const [topEl, setTopEl] = React.useState<HTMLDivElement | null>(null);
  const attachTop = React.useCallback((el: HTMLDivElement | null) => {
    topRef.current = el;
    setTopEl(el);
  }, []);
  const width = useWidth(topEl);
  const showCards = width === null || width < TABLE_FROM_PX[tableFrom];
  const showTable = width === null || width >= TABLE_FROM_PX[tableFrom];
  // Fewer rows per page in the phone layout (10 cards), so a page stays short.
  const isSmallContainer = width !== null ? width < TABLE_FROM_PX[tableFrom] : undefined;
  const paged = usePagedRows(
    rows,
    getRowId,
    pageSize ?? (isSmallContainer !== undefined ? (isSmallContainer ? PHONE_PAGE_SIZE : DEFAULT_PAGE_SIZE) : undefined)
  );
  const usePages = paginate && !footer;
  const shownRows = usePages ? paged.pageRows : rows;
  const goToPage = (next: number) => {
    paged.setPage(next);
    topRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  const visible = columns.filter((c) => !hidden.includes(c.key));
  const canSelect = !!bulkActions?.length;
  const ids = shownRows.map(getRowId);
  // A selection only applies to rows on screen: rows on other pages, or gone from the list, are never acted on.
  const pickedRows = shownRows.filter((r) => selected.has(getRowId(r)));
  const allPicked = ids.length > 0 && ids.every((id) => selected.has(id));

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: BulkAction<T>) => {
    setRunning(true);
    try {
      await action.onRun(pickedRows);
      setSelected(new Set());
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <SkeletonTable className={className} />;
  if (error) return <ErrorState description={error} onRetry={onRetry} className={className} />;

  const primary = visible.find((c) => c.primary) ?? visible.find((c) => !c.actions);
  const actionCols = visible.filter((c) => c.actions);
  const detailCols = visible.filter((c) => c !== primary && !c.actions && !c.hideOnCard);
  // Phone row: the main item, one figure on the right, two short details under it. Everything else opens on tap.
  const trailing = detailCols.find((c) => c.align === 'right' && !c.cardAlways);
  const subtitleCols = [...detailCols.filter((c) => c.cardAlways), ...detailCols.filter((c) => !c.cardAlways && c !== trailing)].slice(0, 2);
  const openCols = detailCols.filter((c) => c !== trailing);
  const hasMore = detailCols.some((c) => c !== trailing && !subtitleCols.includes(c)) || actionCols.length > 0;
  const interactive = (e: React.MouseEvent) => (e.target as Element).closest('button,a,input,select,label,[role="menu"],[role="menuitem"]');

  return (
    <div ref={attachTop} className={cn('@container min-w-0 scroll-mt-20 space-y-2', className)}>
      {columnPickerId ? (
        <div className="flex justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                <Columns3 />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              {columns
                .filter((c) => !c.actions && !c.primary)
                .map((c) => (
                  <label key={c.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
                    <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} className="h-4 w-4 shrink-0 accent-primary" />
                    <span className="min-w-0">{c.label ?? (typeof c.header === 'string' && c.header ? c.header : formatLabel(c.key))}</span>
                  </label>
                ))}
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <>
          {/* Narrow container: short rows. Only one layout is built once the width is known. */}
          {showCards ? (
          <ul data-layout="rows" className={cn('min-w-0 divide-y overflow-hidden rounded-2xl border bg-card shadow-2xs', CARD_CLASS[tableFrom], stale && 'opacity-60')}>
            {shownRows.map((row) => {
              const id = getRowId(row);
              const expanded = renderExpanded?.(row);
              const isOpen = openCards.has(id);
              const onMain = onRowClick ? () => onRowClick(row) : hasMore ? () => toggleCard(id) : undefined;
              return (
                <li key={id} className={cn('min-w-0', rowClassName?.(row))}>
                  <div className="flex min-h-11 min-w-0 items-center gap-1 pl-3 pr-1">
                    {canSelect ? (
                      <label className="-ml-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                        <input type="checkbox" aria-label="Select row" checked={selected.has(id)} onChange={() => toggleRow(id)} className="h-4 w-4 accent-primary" />
                      </label>
                    ) : null}
                    <div
                      onClick={onMain ? (e) => !interactive(e) && onMain() : undefined}
                      className={cn('min-w-0 flex-1 py-2', onMain && 'cursor-pointer')}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3 text-sm">
                        <div className="min-w-0 break-words font-medium text-foreground">{primary?.cell(row)}</div>
                        {trailing ? <div className="shrink-0 text-right tabular-nums text-foreground">{trailing.cell(row)}</div> : null}
                      </div>
                      {/* The detail line wraps instead of cutting: a cut phone number or figure would be a wrong one. */}
                      {subtitleCols.length ? (
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {subtitleCols.map((c) => (
                            <span key={c.key} className="min-w-0 max-w-full break-words">
                              {c.cell(row)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {hasMore ? (
                      <button
                        type="button"
                        onClick={() => toggleCard(id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Hide details' : 'Show details'}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {isOpen && hasMore ? (
                    <div className="min-w-0 space-y-3 bg-subtle px-3 pb-3 pt-2">
                      {openCols.length ? (
                        <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-2 text-sm">
                          {openCols.map((c) => (
                            <div key={c.key} className="min-w-0">
                              <dt className="text-xs text-muted-foreground">{c.label ?? (typeof c.header === 'string' && c.header ? c.header : formatLabel(c.key))}</dt>
                              <dd className="min-w-0 break-words text-foreground">{c.cell(row)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {actionCols.length ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {actionCols.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {expanded ? <div className="min-w-0 border-t bg-subtle px-3 py-3">{expanded}</div> : null}
                </li>
              );
            })}
          </ul>
          ) : null}

          {/* Wide container: columns */}
          {showTable ? (
          <div className={TABLE_CLASS[tableFrom]}>
            <TableWrapper className="rounded-2xl">
              <table className={cn('w-full text-sm', stale && 'opacity-60')}>
                <thead className="border-b bg-subtle text-xs text-muted-foreground">
                  <tr>
                    {canSelect ? (
                      <th className="w-11 p-0">
                        <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            aria-label="Select all rows"
                            checked={allPicked}
                            onChange={() => setSelected(allPicked ? new Set() : new Set(ids))}
                            className="h-4 w-4 accent-primary"
                          />
                        </label>
                      </th>
                    ) : null}
                    {visible.map((c) => (
                      <th key={c.key} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap', ALIGN[c.align ?? 'left'])}>
                        {c.actions ? <span className="sr-only">{c.label ?? 'Actions'}</span> : c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shownRows.map((row) => {
                    const id = getRowId(row);
                    const expanded = renderExpanded?.(row);
                    return (
                      <React.Fragment key={id}>
                        <tr
                          onClick={onRowClick ? (e) => !interactive(e) && onRowClick(row) : undefined}
                          className={cn('align-top transition-colors hover:bg-subtle', onRowClick && 'cursor-pointer', rowClassName?.(row))}
                        >
                          {canSelect ? (
                            <td className="w-11 p-0">
                              <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                                <input type="checkbox" aria-label="Select row" checked={selected.has(id)} onChange={() => toggleRow(id)} className="h-4 w-4 accent-primary" />
                              </label>
                            </td>
                          ) : null}
                          {visible.map((c) => (
                            <td key={c.key} className={cn('px-3 py-2', ALIGN[c.align ?? 'left'], c.className)}>
                              {c.cell(row)}
                            </td>
                          ))}
                        </tr>
                        {expanded ? (
                          <tr>
                            <td colSpan={visible.length + (canSelect ? 1 : 0)} className="bg-subtle px-3 py-2">
                              {expanded}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </TableWrapper>
          </div>
          ) : null}
        </>
      )}

      {footer}
      {usePages && paged.totalPages > 1 ? (
        <Pagination page={paged.page} totalPages={paged.totalPages} totalRecords={paged.totalRecords} pageSize={paged.pageSize} noun={noun} onPageChange={goToPage} />
      ) : null}

      {canSelect && pickedRows.length > 0 ? (
        <div role="region" aria-label="Bulk actions" className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-sticky flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border bg-card p-2 shadow-lg">
          <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 text-sm font-medium tabular-nums">{pickedRows.length} selected</span>
          {bulkActions!.map((a) => (
            <Button key={a.label} variant={a.destructive ? 'destructive' : 'outline'} disabled={running} onClick={() => void runBulk(a)}>
              {a.icon}
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
