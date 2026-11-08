'use client';

import * as React from 'react';
import { Columns3, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { EmptyState, ErrorState } from './empty-state';
import { SkeletonTable } from './loaders';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { TableWrapper } from './table-wrapper';

export interface DataColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Plain-text name, used for the phone card label and the column picker. */
  label?: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** The main line of the phone card, usually the name or code. */
  primary?: boolean;
  /** Buttons and menus. Placed at the top right of the phone card, with no label. */
  actions?: boolean;
  /** Leave this column out of the phone card. */
  hideOnCard?: boolean;
  /** Starts hidden in the column picker. */
  defaultHidden?: boolean;
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
  /** How much width the table needs before phone cards turn into columns. */
  tableFrom?: 'md' | 'lg';
  /** Pagination bar or infinite scroll loader. */
  footer?: React.ReactNode;
  className?: string;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const CARD_CLASS = { md: '@3xl:hidden', lg: '@5xl:hidden' } as const;
const TABLE_CLASS = { md: 'hidden @3xl:block', lg: 'hidden @5xl:block' } as const;

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
 * cards when narrow, columns when wide. Nothing is cut off at any width.
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
  className,
}: DataTableProps<T>) {
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
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

  const visible = columns.filter((c) => !hidden.includes(c.key));
  const canSelect = !!bulkActions?.length;
  const ids = rows.map(getRowId);
  // A selection only applies to rows on screen: rows that left the list are never acted on.
  const pickedRows = rows.filter((r) => selected.has(getRowId(r)));
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
  const interactive = (e: React.MouseEvent) => (e.target as Element).closest('button,a,input,select,label,[role="menu"],[role="menuitem"]');

  return (
    <div className={cn('@container min-w-0 space-y-2', className)}>
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
                    <span className="min-w-0">{c.label ?? c.key}</span>
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
          {/* Narrow container: cards */}
          <ul className={cn('min-w-0 space-y-2', CARD_CLASS[tableFrom], stale && 'opacity-60')}>
            {rows.map((row) => {
              const id = getRowId(row);
              const expanded = renderExpanded?.(row);
              return (
                <li
                  key={id}
                  onClick={onRowClick ? (e) => !interactive(e) && onRowClick(row) : undefined}
                  className={cn('min-w-0 rounded-2xl border bg-card p-4 shadow-2xs', onRowClick && 'cursor-pointer transition-colors hover:bg-subtle', rowClassName?.(row))}
                >
                  {/* Wraps, so several action buttons drop to their own line instead of leaving the card. */}
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    {canSelect ? (
                      <label className="-ml-3 -mt-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                        <input type="checkbox" aria-label="Select row" checked={selected.has(id)} onChange={() => toggleRow(id)} className="h-4 w-4 accent-primary" />
                      </label>
                    ) : null}
                    <div className="min-w-[min(100%,8rem)] flex-1 text-sm">{primary?.cell(row)}</div>
                    {actionCols.length ? <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1">{actionCols.map((c) => <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>)}</div> : null}
                  </div>
                  {detailCols.length ? (
                    <dl className="mt-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-2 border-t pt-3 text-sm">
                      {detailCols.map((c) => (
                        <div key={c.key} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{c.label ?? c.header}</dt>
                          <dd className="min-w-0 break-words text-foreground">{c.cell(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {expanded ? <div className="mt-3 min-w-0 border-t pt-3">{expanded}</div> : null}
                </li>
              );
            })}
          </ul>

          {/* Wide container: columns */}
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
                      <th key={c.key} scope="col" className={cn('px-3 py-2 font-medium', ALIGN[c.align ?? 'left'])}>
                        {c.actions ? <span className="sr-only">{c.label ?? 'Actions'}</span> : c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => {
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
                            <td key={c.key} className={cn('px-3 py-2 break-words', ALIGN[c.align ?? 'left'], c.className)}>
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
        </>
      )}

      {footer}

      {canSelect && pickedRows.length > 0 ? (
        <div role="region" aria-label="Bulk actions" className="sticky bottom-2 z-sticky flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border bg-card p-2 shadow-lg">
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
