'use client';

import React, { useState, useMemo } from 'react';
import type {
  ReportFieldDefinition,
  GroupedSubtotal,
} from '../dynamicReportTypes';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  ChevronDown,
  ChevronRight as ChevronExpand,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DynamicReportTableProps {
  fields: ReportFieldDefinition[];
  rows: Record<string, any>[];
  totalRecords: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  sortFieldId?: string;
  sortDirection?: 'asc' | 'desc';
  onSort: (fieldId: string) => void;
  groupByFieldId?: string;
  groupedSubtotals?: GroupedSubtotal[];
  isLoading?: boolean;
}

export function DynamicReportTable({
  fields,
  rows,
  totalRecords,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sortFieldId,
  sortDirection,
  onSort,
  groupByFieldId,
  groupedSubtotals,
  isLoading,
}: DynamicReportTableProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  // Group rows if groupByFieldId is set
  const groupedData = useMemo(() => {
    if (!groupByFieldId) return null;
    const map = new Map<string, Record<string, any>[]>();
    for (const r of rows) {
      const key = String(r[groupByFieldId] || 'Unassigned');
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [rows, groupByFieldId]);

  // Overall totals for numeric columns
  const columnTotals = useMemo(() => {
    const totals: Record<string, number | null> = {};
    for (const f of fields) {
      if (f.dataType === 'number') {
        const nums = rows.map((r) => Number(r[f.id])).filter((n) => !isNaN(n));
        if (nums.length > 0) {
          if (f.aggregations?.includes('SUM') || f.format === 'liters') {
            totals[f.id] = Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
          } else if (f.aggregations?.includes('AVG') || f.format === 'percent' || f.format === 'temperature') {
            totals[f.id] = Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
          }
        }
      }
    }
    return totals;
  }, [fields, rows]);

  const renderCellValue = (value: any, field: ReportFieldDefinition) => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-slate-400 font-mono">—</span>;
    }

    if (field.format === 'status_pill') {
      const strVal = String(value).toUpperCase();
      let colorClass = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
      if (strVal === 'ACCEPTED' || strVal === 'COMPLETED' || strVal === 'RECEIVED_AT_PLANT' || strVal === 'ISSUED' || strVal === 'TRUE') {
        colorClass = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800';
      } else if (strVal === 'REJECTED' || strVal === 'FLAGGED' || strVal === 'CANCELLED') {
        colorClass = 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800';
      } else if (strVal === 'IN_TRANSIT' || strVal === 'COLLECTING' || strVal === 'PENDING') {
        colorClass = 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800';
      }
      return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${colorClass}`}>
          {String(value)}
        </span>
      );
    }

    if (field.format === 'liters') {
      return (
        <span className="tabular-nums font-mono font-medium text-foreground">
          {Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
        </span>
      );
    }

    if (field.format === 'percent') {
      return (
        <span className="tabular-nums font-mono font-medium text-foreground">
          {Number(value).toFixed(2)}%
        </span>
      );
    }

    if (field.format === 'temperature') {
      return (
        <span className="tabular-nums font-mono font-medium text-foreground">
          {Number(value).toFixed(1)}°C
        </span>
      );
    }

    if (field.dataType === 'number') {
      return (
        <span className="tabular-nums font-mono font-medium text-foreground">
          {Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    }

    if (field.format === 'date') {
      return <span className="tabular-nums text-foreground">{String(value)}</span>;
    }

    if (field.format === 'datetime') {
      try {
        const d = new Date(value);
        return (
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {d.toISOString().slice(0, 16).replace('T', ' ')}
          </span>
        );
      } catch {
        return <span className="text-muted-foreground">{String(value)}</span>;
      }
    }

    return <span className="text-foreground">{String(value)}</span>;
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-xs overflow-hidden flex flex-col">
      {/* Table Container */}
      <div className="overflow-x-auto min-h-[300px] relative">
        {isLoading && (
          <div className="absolute inset-0 bg-background/60 backdrop-blur-2xs z-20 flex items-center justify-center">
            <div className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-xl shadow-lg">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <span className="text-xs font-medium text-foreground">Updating report data…</span>
            </div>
          </div>
        )}

        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-muted-foreground font-semibold uppercase text-[10px] tracking-wider sticky top-0 z-10">
              {fields.map((f) => {
                const isSorted = sortFieldId === f.id;
                return (
                  <th
                    key={f.id}
                    onClick={() => f.sortable !== false && onSort(f.id)}
                    className={`py-3 px-3.5 transition-colors select-none ${
                      f.sortable !== false ? 'cursor-pointer hover:bg-muted/80 hover:text-foreground' : ''
                    } ${f.align === 'right' ? 'text-right' : f.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    <div
                      className={`inline-flex items-center gap-1.5 ${
                        f.align === 'right' ? 'justify-end' : f.align === 'center' ? 'justify-center' : 'justify-start'
                      }`}
                    >
                      <span>{f.label}</span>
                      {f.sortable !== false && (
                        <span className="text-slate-400">
                          {isSorted ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="w-3 h-3 text-primary stroke-[2.5]" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-primary stroke-[2.5]" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-100" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={fields.length} className="py-12 text-center text-muted-foreground text-xs">
                  No records matching the selected dynamic filters and criteria.
                </td>
              </tr>
            ) : groupedData ? (
              // Grouped Rendering
              Array.from(groupedData.entries()).map(([groupKey, groupRows]) => {
                const isCollapsed = collapsedGroups.has(groupKey);
                const subtotal = groupedSubtotals?.find((s) => s.groupKey === groupKey);

                return (
                  <React.Fragment key={groupKey}>
                    {/* Group Header Row */}
                    <tr
                      onClick={() => toggleGroup(groupKey)}
                      className="bg-muted/40 hover:bg-muted/70 cursor-pointer border-t border-b border-border select-none"
                    >
                      <td colSpan={fields.length} className="py-2.5 px-3.5 font-semibold text-foreground text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isCollapsed ? (
                              <ChevronExpand className="w-4 h-4 text-primary shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-primary shrink-0" />
                            )}
                            <span>{groupKey}</span>
                            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                              {groupRows.length} records
                            </span>
                          </div>

                          {subtotal && (
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                              {Object.entries(subtotal.aggregations).map(([fId, val]) => {
                                const fDef = fields.find((d) => d.id === fId);
                                if (!fDef) return null;
                                return (
                                  <span key={fId} className="bg-background px-2 py-0.5 rounded-md border border-border">
                                    {fDef.label}: <strong className="text-foreground">{val}</strong>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Group Rows (if not collapsed) */}
                    {!isCollapsed &&
                      groupRows.map((row, rIdx) => (
                        <tr
                          key={`${groupKey}-${rIdx}`}
                          className="hover:bg-muted/30 transition-colors bg-card"
                        >
                          {fields.map((f) => (
                            <td
                              key={f.id}
                              className={`py-2.5 px-3.5 ${
                                f.align === 'right' ? 'text-right' : f.align === 'center' ? 'text-center' : 'text-left'
                              }`}
                            >
                              {renderCellValue(row[f.id], f)}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })
            ) : (
              // Flat Rendering
              rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-muted/30 transition-colors">
                  {fields.map((f) => (
                    <td
                      key={f.id}
                      className={`py-2.5 px-3.5 ${
                        f.align === 'right' ? 'text-right' : f.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {renderCellValue(row[f.id], f)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>

          {/* Table Footer with Grand Totals */}
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/60 font-semibold text-xs sticky bottom-0 z-10 shadow-2xs">
                {fields.map((f, idx) => {
                  if (idx === 0) {
                    return (
                      <td key={f.id} className="py-3 px-3.5 text-foreground uppercase tracking-wider text-[11px] font-bold">
                        TOTAL ({totalRecords})
                      </td>
                    );
                  }
                  const tot = columnTotals[f.id];
                  return (
                    <td
                      key={f.id}
                      className={`py-3 px-3.5 ${
                        f.align === 'right' ? 'text-right' : f.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {tot !== undefined && tot !== null ? renderCellValue(tot, f) : <span className="text-slate-400 font-mono">—</span>}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination Toolbar */}
      <div className="px-4 py-3 border-t border-border bg-card flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs font-medium text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="ml-2 font-mono">
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-2 font-medium text-foreground font-mono">
            Page {currentPage} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
