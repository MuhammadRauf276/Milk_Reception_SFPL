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
  RefreshCw,
  AlertTriangle,
  Scale,
  Warehouse,
  ExternalLink,
  FileSpreadsheet,
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
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#166534]/10 text-[#166534]">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#111311]">
                Receipts & Physical Performance: {assignedSourceName}
              </h2>
              <p className="text-xs text-[#475569]">
                Authoritative Silo intake records, scale weighbridge reconciliation, and paired quantity performance.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1E3A8A] ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary KPI Cards (Shows placeholder '—' during loading/error) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
          <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[10px] font-sans text-slate-500 block uppercase font-bold">Completed Receipts</span>
            <span className="text-lg font-black text-slate-900">
              {showKpiPlaceholders ? '—' : summary.completedReceiptCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
            <span className="text-[10px] font-sans text-emerald-700 block uppercase font-bold">Physical Received Liters</span>
            <span className="text-lg font-black text-emerald-800">
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.finalPhysicalReceivedLiters != null
                ? `${summary.pairedComparison.finalPhysicalReceivedLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE]">
            <span className="text-[10px] font-sans text-blue-700 block uppercase font-bold">Dispatch Gross Liters</span>
            <span className="text-lg font-black text-blue-800">
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.dispatchGrossLiters != null
                ? `${summary.pairedComparison.dispatchGrossLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF]">
            <span className="text-[10px] font-sans text-purple-700 block uppercase font-bold">Quantity Difference</span>
            <span
              className={`text-lg font-black ${
                showKpiPlaceholders || summary.pairedComparison.differenceLiters == null
                  ? 'text-slate-900'
                  : summary.pairedComparison.differenceLiters >= 0
                  ? 'text-emerald-800'
                  : 'text-red-800'
              }`}
            >
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.differenceLiters != null
                ? `${summary.pairedComparison.differenceLiters > 0 ? '+' : ''}${summary.pairedComparison.differenceLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FDF4FF] border border-[#F5D0FE]">
            <span className="text-[10px] font-sans text-fuchsia-700 block uppercase font-bold">Final Liters @ 13% TS</span>
            <span className="text-lg font-black text-fuchsia-800">
              {showKpiPlaceholders
                ? '—'
                : summary.pairedComparison.plant13TsLiters != null
                ? `${summary.pairedComparison.plant13TsLiters.toLocaleString()} L`
                : '—'}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
            <span className="text-[10px] font-sans text-amber-700 block uppercase font-bold">Receipt Pending</span>
            <span className="text-lg font-black text-amber-800">
              {showKpiPlaceholders ? '—' : summary.receiptPendingCount}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Filters & Controls */}
      <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicle #, token #, silo, tx #..."
              className="w-full pl-9 pr-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
            />
          </div>

          {/* Date Filter */}
          {onDateFilterChange && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-600 text-[11px]">From:</span>
                <input
                  type="date"
                  value={currentFromDate}
                  onChange={(e) => onDateFilterChange(e.target.value || null, currentToDate || null)}
                  className="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]"
                />
                <span className="font-bold text-slate-600 text-[11px]">To:</span>
                <input
                  type="date"
                  value={currentToDate}
                  onChange={(e) => onDateFilterChange(currentFromDate || null, e.target.value || null)}
                  className="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]"
                />
                {(currentFromDate || currentToDate) && (
                  <button
                    onClick={() => onDateFilterChange(null, null)}
                    className="px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 rounded"
                  >
                    Clear
                  </button>
                )}
              </div>
              <span className="text-[10px] text-slate-400 font-sans hidden md:inline">
                (Completed receipts use Final Receipt Business Date; Pending receipts use Visit / Dispatch Business Date)
              </span>
            </div>
          )}
        </div>

        {/* Filter State Tabs/Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-[#EAE4D5]/60 text-xs">
          <span className="text-[11px] font-bold text-slate-500 mr-1 uppercase">Filter:</span>
          {FILTER_OPTIONS.map((opt) => {
            const isActive = filterState === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setFilterState(opt.id)}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-slate-600 hover:bg-slate-200/70 border border-slate-200'
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
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button onClick={onRetry} className="underline hover:text-red-950">
              Retry
            </button>
          )}
        </div>
      )}

      {/* 4. Loading State */}
      {isLoading && (
        <div className="p-8 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 text-xs text-slate-500 font-bold flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#1E3A8A]" />
          <span>Loading receipt records...</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-12 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-extrabold text-slate-800">No receipt records found</h3>
          <p className="text-xs text-slate-500">
            No completed receipt or receipt-pending records found matching your filters.
          </p>
        </div>
      )}

      {/* 6. Receipt Performance Cards */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div
              key={item.visitId}
              className={`p-5 rounded-xl bg-[#FFFFFF] border shadow-xs space-y-4 transition-all ${
                item.isCompletedReceipt
                  ? 'border-emerald-200 hover:border-emerald-400'
                  : item.isReceiptPending
                  ? 'border-amber-200 hover:border-amber-400'
                  : 'border-[#EAE4D5]/80 hover:border-[#1E3A8A]/40'
              }`}
            >
              {/* Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#EAE4D5]/80">
                <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                  <span className="text-base font-black font-mono text-[#111311] tracking-tight">
                    {item.vehicleNumber}
                  </span>
                  {item.tokenNumber && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      Token: {item.tokenNumber}
                    </span>
                  )}
                  {item.isCompletedReceipt && item.finalReceiptBusinessDate ? (
                    <span className="text-xs font-mono font-bold text-emerald-800">
                      Final Receipt Business Date: {item.finalReceiptBusinessDate}
                    </span>
                  ) : (
                    <span className="text-xs font-mono font-bold text-slate-600">
                      Visit / Dispatch Business Date: {item.dispatchBusinessDate}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
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
                    className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-bold text-[#1E3A8A] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] transition-all"
                  >
                    <span>View Details</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Two-Column Grid: Quantity Performance vs Weighbridge & Storage */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 font-mono text-xs">
                {/* Column A: Quantity & 13% TS Performance */}
                <div className="p-3.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
                  <div className="flex items-center justify-between font-sans pb-1.5 border-b border-[#EAE4D5]/60">
                    <span className="text-xs font-extrabold text-[#111311] flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-[#166534]" />
                      <span>Intake Quantity Performance</span>
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">Dispatch vs Final Receipt</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">Dispatch Gross Liters:</span>
                      <span className="font-black text-[#111311]">
                        {item.dispatchGrossLiters != null ? `${item.dispatchGrossLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">Physical Received Liters:</span>
                      <span className="font-black text-[#166534]">
                        {item.physicalReceivedLiters != null ? `${item.physicalReceivedLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">Quantity Difference:</span>
                      <span
                        className={`font-black ${
                          item.quantityDifferenceLiters == null
                            ? 'text-slate-500'
                            : item.quantityDifferenceLiters >= 0
                            ? 'text-[#166534]'
                            : 'text-[#991B1B]'
                        }`}
                      >
                        {item.quantityDifferenceText}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#EAE4D5]/40 text-[11px]">
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">Dispatch Liters @ 13% TS:</span>
                      <span className="font-bold text-slate-800">
                        {item.dispatch13TsLiters != null ? `${item.dispatch13TsLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">Final Liters @ 13% TS:</span>
                      <span className="font-bold text-[#6B21A8]">
                        {item.plant13TsLiters != null ? `${item.plant13TsLiters.toLocaleString()} L` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">Diff @ 13% TS:</span>
                      <span
                        className={`font-bold ${
                          item.tsDifferenceLiters == null
                            ? 'text-slate-500'
                            : item.tsDifferenceLiters >= 0
                            ? 'text-[#166534]'
                            : 'text-[#991B1B]'
                        }`}
                      >
                        {item.tsDifferenceText}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Column B: Weighbridge & Silo Destination */}
                <div className="p-3.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
                  <div className="flex items-center justify-between font-sans pb-1.5 border-b border-[#EAE4D5]/60">
                    <span className="text-xs font-extrabold text-[#111311] flex items-center gap-1.5">
                      <Warehouse className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      <span>Weighbridge & Storage Allocation</span>
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">Official Scale Records</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">First Weight (Loaded Vehicle):</span>
                      <span className="font-black text-[#111311]">
                        {item.firstWeightKg != null ? `${item.firstWeightKg.toLocaleString()} kg` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">Second Weight (After Unloading):</span>
                      <span className="font-black text-slate-800">
                        {item.secondWeightKg != null ? `${item.secondWeightKg.toLocaleString()} kg` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">Net Milk Weight:</span>
                      <span className="font-black text-[#1E3A8A]">
                        {item.netMilkWeightKg != null ? `${item.netMilkWeightKg.toLocaleString()} kg` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#EAE4D5]/40 text-[11px]">
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">Destination Silo:</span>
                      <span className="font-bold text-slate-900">
                        {item.destinationSilo || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-sans text-slate-500 block">Final Receipt Date/Time:</span>
                      <span className="font-bold text-slate-800">
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
