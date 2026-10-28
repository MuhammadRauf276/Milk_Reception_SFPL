'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  ReceiptsPerformanceFilter,
} from './zmccManagerTypes';
import {
  buildVehicleVisitGroups,
  deriveReceiptPerformanceItems,
  deriveReceiptsPerformanceSummary,
  filterReceiptPerformanceItems,
  filterReceiptPerformanceItemsByDate,
} from './zmccManagerHelpers';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import {
  Receipt,
  Search,
  AlertTriangle,
  Scale,
  Warehouse,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';

interface ZMCCManagerReceiptsPerformanceProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  currentFromDate?: string;
  currentToDate?: string;
  onDateFilterChange?: (from: string | null, to: string | null) => void;
}

const FILTER_OPTIONS: { id: ReceiptsPerformanceFilter; label: string }[] = [
  { id: 'ALL', label: 'All Records' },
  { id: 'COMPLETED', label: 'Completed Receipts' },
  { id: 'RECEIPT_PENDING', label: 'Receipt Pending' },
  { id: 'HAS_QUANTITY_DIFF', label: 'Quantity Differences' },
  { id: 'HAS_TS_DIFF', label: '13% TS Differences' },
];

export const ZMCCManagerReceiptsPerformance: React.FC<ZMCCManagerReceiptsPerformanceProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
  currentFromDate = '',
  currentToDate = '',
  onDateFilterChange,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterState, setFilterState] = useState<ReceiptsPerformanceFilter>('ALL');

  // Build groups and derive receipt performance items
  const groups = useMemo(() => buildVehicleVisitGroups(logs), [logs]);
  const items = useMemo(() => deriveReceiptPerformanceItems(groups), [groups]);

  // Compute paired summary for the selected Final Receipt Business Date period
  const summary = useMemo(
    () => deriveReceiptsPerformanceSummary(items, currentFromDate, currentToDate),
    [items, currentFromDate, currentToDate]
  );

  // Filter items by authoritative date basis (Final Receipt Business Date for completed, Visit / Dispatch Business Date for pending)
  const dateFilteredItems = useMemo(
    () => filterReceiptPerformanceItemsByDate(items, currentFromDate, currentToDate),
    [items, currentFromDate, currentToDate]
  );

  const filteredItems = useMemo(
    () => filterReceiptPerformanceItems(dateFilteredItems, searchQuery, filterState),
    [dateFilteredItems, searchQuery, filterState]
  );

  const showKpiPlaceholders = isLoading || error != null;

  return (
    <div className="space-y-6">
      {/* 1. Header & Summary Banner */}
      <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-emerald-800/10 text-emerald-800">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Receipts & Physical Performance: {assignedSourceName}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-subtle border border-border/80 text-xs font-semibold text-foreground hover:bg-muted/60 transition-all disabled:opacity-50 min-h-11"
              >
                <span>{isLoading ? 'Syncing…' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary KPI Cards (Shows placeholder '—' during loading/error) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 tabular-nums">
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-slate-500 block uppercase font-semibold">Completed Receipts</span>
            <span className="text-lg font-semibold text-slate-900">
              {showKpiPlaceholders ? '—' : summary.completedReceiptCount}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-emerald-700 block uppercase font-semibold">Physical Received Liters</span>
            <span className="text-lg font-semibold text-emerald-800">
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.finalPhysicalReceivedLiters != null
                ? `${summary.pairedComparison.finalPhysicalReceivedLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-blue-700 block uppercase font-semibold">Dispatch Gross Liters</span>
            <span className="text-lg font-semibold text-blue-800">
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.dispatchGrossLiters != null
                ? `${summary.pairedComparison.dispatchGrossLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-slate-700 block uppercase font-semibold">Quantity Difference</span>
            <span
              className={`text-lg font-semibold ${
                showKpiPlaceholders || summary.pairedComparison.differenceLiters == null
                  ? 'text-slate-900'
                  : summary.pairedComparison.differenceLiters >= 0
                  ? 'text-emerald-800'
                  : 'text-rose-800'
              }`}
            >
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.differenceLiters != null
                ? `${summary.pairedComparison.differenceLiters > 0 ? '+' : ''}${summary.pairedComparison.differenceLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-blue-700 block uppercase font-semibold">Final Liters @ 13% TS</span>
            <span className="text-lg font-semibold text-blue-900">
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.plant13TsLiters != null
                ? `${summary.pairedComparison.plant13TsLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="bg-card border-border p-3 rounded-lg border">
            <span className="text-xs font-sans text-amber-700 block uppercase font-semibold">Receipt Pending</span>
            <span className="text-lg font-semibold text-amber-800">
              {showKpiPlaceholders ? '—' : summary.receiptPendingCount}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Filters & Controls */}
      <div className="p-4 rounded-xl bg-card border border-border/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-1.5 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden min-h-11"
            />
          </div>

          {/* Date Filter */}
          {onDateFilterChange && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-600 text-[11px]">From:</span>
                <input
                  type="date"
                  value={currentFromDate}
                  onChange={(e) => onDateFilterChange(e.target.value || null, currentToDate || null)}
                  className="px-2.5 py-1 text-xs tabular-nums font-semibold rounded-lg bg-subtle border border-border/80 text-foreground min-h-11"
                />
                <span className="font-semibold text-slate-600 text-[11px]">To:</span>
                <input
                  type="date"
                  value={currentToDate}
                  onChange={(e) => onDateFilterChange(currentFromDate || null, e.target.value || null)}
                  className="px-2.5 py-1 text-xs tabular-nums font-semibold rounded-lg bg-subtle border border-border/80 text-foreground min-h-11"
                />
                {(currentFromDate || currentToDate) && (
                  <button
                    onClick={() => onDateFilterChange(null, null)}
                    className="px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded min-h-11 min-w-11"
                  >
                    Clear
                  </button>
                )}
              </div>
              <span className="text-xs text-slate-400 font-sans hidden md:inline">
                (Completed receipts use Final Receipt Business Date; Pending receipts use Visit / Dispatch Business Date)
              </span>
            </div>
          )}
        </div>

        {/* Filter State Tabs/Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-border/60 text-xs">
          <span className="text-[11px] font-semibold text-slate-500 mr-1 uppercase">Filter:</span>
          {FILTER_OPTIONS.map((opt) => {
            const isActive = filterState === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setFilterState(opt.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Error Banner */}
      {error && (
        <div className="bg-card border-border p-4 rounded-xl border text-rose-800 text-xs font-semibold flex items-center justify-between animate-panel-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button onClick={onRetry} className="underline hover:text-rose-950 min-h-11 min-w-11">
              Retry
            </button>
          )}
        </div>
      )}

      {/* 4. Loading State */}
      {isLoading && (
        <div className="p-8 text-center bg-card rounded-xl border border-border/80 text-xs text-slate-500 font-semibold flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>Loading receipt records…</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-12 text-center bg-card rounded-xl border border-border/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-800">No receipt records found</h3>
          <p className="text-xs text-slate-500">
            No records
          </p>
        </div>
      )}

      {/* 6. Receipt Performance Cards */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div
              key={item.visitId}
              className={`p-5 rounded-xl bg-card border shadow-2xs space-y-4 transition-all ${
                item.isCompletedReceipt
                  ? 'border-emerald-200 hover:border-emerald-400'
                  : item.isReceiptPending
                  ? 'border-amber-200 hover:border-amber-400'
                  : 'border-border/80 hover:border-primary/40'
              }`}
            >
              {/* Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/80">
                <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                  <span className="text-base font-semibold tabular-nums text-foreground tracking-tight">
                    {item.vehicleNumber}
                  </span>
                  {item.tokenNumber && (
                    <span className="px-2 py-0.5 rounded text-xs tabular-nums font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                      Token: {item.tokenNumber}
                    </span>
                  )}
                  {item.isCompletedReceipt && item.finalReceiptDate ? (
                    <span className="text-xs tabular-nums font-semibold text-emerald-800">
                      Final Receipt Date: {item.finalReceiptDate}
                    </span>
                  ) : (
                    <span className="text-xs tabular-nums font-semibold text-slate-600">
                      Dispatch Date: {item.dispatchDate || 'Pending plant completion'}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                      item.isCompletedReceipt
                        ? 'bg-emerald-100 text-emerald-800'
                        : item.isReceiptPending
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {item.lifecycleStatus}
                  </span>
                </div>

                <div>
                  <button
                    onClick={() => onInspectDetails(item.group.primaryLog)}
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-primary hover:bg-blue-50 hover:border-blue-200 transition-all min-h-11"
                  >
                    <span>View Details</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Two-Column Grid: Quantity Performance vs Weighbridge & Storage */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 tabular-nums text-xs">
                {/* Column A: Quantity & 13% TS Performance */}
                <div className="bg-card border-border p-3.5 rounded-lg border space-y-2">
                  <div className="flex items-center justify-between font-sans pb-1.5 border-b border-border/60">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-emerald-800" />
                      <span>Intake Quantity Performance</span>
                    </span>
                    <span className="text-xs font-semibold text-slate-500">Dispatch vs Final Receipt</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Dispatch Gross Liters:</span>
                      <span className="font-semibold text-foreground">
                        {item.dispatchGrossLiters != null ? `${item.dispatchGrossLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Physical Received Liters:</span>
                      <span className="font-semibold text-emerald-800">
                        {item.physicalReceivedLiters != null ? `${item.physicalReceivedLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Quantity Difference:</span>
                      <span
                        className={`font-semibold ${
                          item.quantityDifferenceLiters == null
                            ? 'text-slate-500'
                            : item.quantityDifferenceLiters >= 0
                            ? 'text-emerald-800'
                            : 'text-rose-800'
                        }`}
                      >
                        {item.quantityDifferenceText}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40 text-[11px]">
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Dispatch Liters @ 13% TS:</span>
                      <span className="font-semibold text-slate-800">
                        {item.dispatch13TsLiters != null ? `${item.dispatch13TsLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Final Liters @ 13% TS:</span>
                      <span className="font-semibold text-slate-800">
                        {item.plant13TsLiters != null ? `${item.plant13TsLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Diff @ 13% TS:</span>
                      <span
                        className={`font-semibold ${
                          item.tsDifferenceLiters == null
                            ? 'text-slate-500'
                            : item.tsDifferenceLiters >= 0
                            ? 'text-emerald-800'
                            : 'text-rose-800'
                        }`}
                      >
                        {item.tsDifferenceText}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Column B: Weighbridge & Silo Destination */}
                <div className="bg-card border-border p-3.5 rounded-lg border space-y-2">
                  <div className="flex items-center justify-between font-sans pb-1.5 border-b border-border/60">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Warehouse className="w-3.5 h-3.5 text-primary" />
                      <span>Weighbridge & Storage Allocation</span>
                    </span>
                    <span className="text-xs font-semibold text-slate-500">Official Scale Records</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">First Weight (Loaded Vehicle):</span>
                      <span className="font-semibold text-foreground">
                        {item.firstWeightKg != null ? `${item.firstWeightKg.toLocaleString()} kg` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Second Weight (After Unloading):</span>
                      <span className="font-semibold text-slate-800">
                        {item.secondWeightKg != null ? `${item.secondWeightKg.toLocaleString()} kg` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Net Milk Weight:</span>
                      <span className="font-semibold text-primary">
                        {item.netMilkWeightKg != null ? `${item.netMilkWeightKg.toLocaleString()} kg` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40 text-[11px]">
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Destination Silo:</span>
                      <span className="font-semibold text-slate-900">
                        {item.destinationSilo || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-sans text-slate-500 block">Final Receipt Date/Time:</span>
                      <span className="font-semibold text-slate-800">
                        {item.finalReceiptTimestamp
                          ? formatOperationalDatetime(item.finalReceiptTimestamp)
                          : item.isReceiptPending
                          ? 'Pending Silo Receipt'
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
