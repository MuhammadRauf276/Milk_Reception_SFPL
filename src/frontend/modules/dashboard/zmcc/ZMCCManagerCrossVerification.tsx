'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  CrossVerificationFilter,
} from './zmccManagerTypes';
import {
  buildVehicleVisitGroups,
  deriveVehicleReconciliationItems,
  filterVehicleReconciliationItems,
} from './zmccManagerHelpers';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import {
  ArrowRightLeft,
  Search,
  RefreshCw,
  AlertTriangle,
  Scale,
  FlaskConical,
  ExternalLink,
  Warehouse,
  FileSpreadsheet,
} from 'lucide-react';

interface ZMCCManagerCrossVerificationProps {
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

const FILTER_OPTIONS: { id: CrossVerificationFilter; label: string }[] = [
  { id: 'ALL', label: 'All Records' },
  { id: 'COMPLETED', label: 'Completed Receipts' },
  { id: 'RECEIPT_PENDING', label: 'Receipt Pending' },
  { id: 'HAS_QUANTITY_DIFF', label: 'Quantity Differences' },
  { id: 'HAS_QUALITY_DIFF', label: 'Quality Differences' },
  { id: 'HAS_REJECTION', label: 'QA Rejected' },
];

export const ZMCCManagerCrossVerification: React.FC<ZMCCManagerCrossVerificationProps> = ({
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
  const [filterState, setFilterState] = useState<CrossVerificationFilter>('ALL');

  // Build groups and derive reconciliation models
  const groups = useMemo(() => buildVehicleVisitGroups(logs), [logs]);
  const reconciliationItems = useMemo(() => deriveVehicleReconciliationItems(groups), [groups]);
  const filteredItems = useMemo(
    () => filterVehicleReconciliationItems(reconciliationItems, searchQuery, filterState),
    [reconciliationItems, searchQuery, filterState]
  );

  // Summary Metrics (Computed only for valid data display)
  const summary = useMemo(() => {
    const total = reconciliationItems.length;
    const completed = reconciliationItems.filter((i) => i.isCompletedReceipt).length;
    const pendingReceipt = reconciliationItems.filter((i) => i.isReceiptPending).length;
    const qtyDiffCount = reconciliationItems.filter((i) => i.hasQuantityDifference).length;
    const qualDiffCount = reconciliationItems.filter((i) => i.hasQualityDifference).length;
    const rejectedCount = reconciliationItems.filter((i) => i.hasRejection).length;
    return { total, completed, pendingReceipt, qtyDiffCount, qualDiffCount, rejectedCount };
  }, [reconciliationItems]);

  const showKpiPlaceholders = isLoading || error != null;

  return (
    <div className="space-y-6">
      {/* 1. Header & Summary Banner */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A]">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#111311]">
                Authoritative Cross-Verification Ledger: {assignedSourceName}
              </h2>
              <p className="text-xs text-[#475569]">
                Comparing declared ZMCC dispatch figures against official plant scale and laboratory measurements.
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

        {/* Quick Summary KPI Cards (Shows placeholder '—' during loading/error) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
          <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[10px] font-sans text-slate-500 block uppercase font-bold">Total Visits</span>
            <span className="text-lg font-black text-slate-900">
              {showKpiPlaceholders ? '—' : summary.total}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
            <span className="text-[10px] font-sans text-emerald-700 block uppercase font-bold">Completed</span>
            <span className="text-lg font-black text-emerald-800">
              {showKpiPlaceholders ? '—' : summary.completed}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
            <span className="text-[10px] font-sans text-amber-700 block uppercase font-bold">Receipt Pending</span>
            <span className="text-lg font-black text-amber-800">
              {showKpiPlaceholders ? '—' : summary.pendingReceipt}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE]">
            <span className="text-[10px] font-sans text-blue-700 block uppercase font-bold">Qty Diff</span>
            <span className="text-lg font-black text-blue-800">
              {showKpiPlaceholders ? '—' : summary.qtyDiffCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF]">
            <span className="text-[10px] font-sans text-purple-700 block uppercase font-bold">Quality Diff</span>
            <span className="text-lg font-black text-purple-800">
              {showKpiPlaceholders ? '—' : summary.qualDiffCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA]">
            <span className="text-[10px] font-sans text-red-700 block uppercase font-bold">QA Rejected</span>
            <span className="text-lg font-black text-red-800">
              {showKpiPlaceholders ? '—' : summary.rejectedCount}
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
              placeholder="Search vehicle #, token #..."
              className="w-full pl-9 pr-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
            />
          </div>

          {/* Date Filter */}
          {onDateFilterChange && (
            <div className="flex items-center gap-2 text-xs">
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
          <span>Loading cross-verification records...</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-12 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-extrabold text-slate-800">No records found</h3>
          <p className="text-xs text-slate-500">
            No cross-verification records found matching your filters for this reporting period.
          </p>
        </div>
      )}

      {/* 6. Vehicle Reconciliation List */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div
              key={item.visitId}
              className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-xs space-y-4 hover:border-[#1E3A8A]/40 transition-all"
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
                  <span className="text-xs font-mono font-bold text-slate-600">
                    Business Date: {item.businessDate}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#F1F5F9] text-slate-700">
                    {item.portionCount} {item.portionCount === 1 ? 'Portion' : 'Portions'}
                  </span>
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

              {/* Two-Column Reconciliation Summary (Quantity vs Weighbridge) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 font-mono text-xs">
                {/* Column A: Quantity Reconciliation */}
                <div className="p-3.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
                  <div className="flex items-center justify-between font-sans pb-1.5 border-b border-[#EAE4D5]/60">
                    <span className="text-xs font-extrabold text-[#111311] flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-[#1E3A8A]" />
                      <span>Quantity Reconciliation</span>
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">Dispatch vs Final Receipt</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <span className="text-[9.5px] font-sans text-slate-500 block">Dispatch Gross:</span>
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
                      <span className="text-[9px] font-sans text-slate-500 block">Destination Silo:</span>
                      <span className="font-bold text-slate-800">
                        {item.destinationSilo || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Column B: Weighbridge & Final Receipt Milestones */}
                <div className="p-3.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] space-y-2">
                  <div className="flex items-center justify-between font-sans pb-1.5 border-b border-[#EAE4D5]/60">
                    <span className="text-xs font-extrabold text-[#111311] flex items-center gap-1.5">
                      <Warehouse className="w-3.5 h-3.5 text-[#166534]" />
                      <span>Weighbridge & Final Receipt</span>
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

                  <div className="pt-2 border-t border-[#EAE4D5]/40 text-[11px]">
                    <span className="text-[9px] font-sans text-slate-500 block">Final Receipt Date/Time:</span>
                    <span className="font-bold text-slate-800">
                      {item.finalReceiptTimestamp
                        ? formatOperationalDatetime(item.finalReceiptTimestamp)
                        : item.isReceiptPending
                        ? 'Pending Final Silo Receipt'
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Portion-Level Quality Comparison Table */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-extrabold text-[#111311]">
                  <span className="flex items-center gap-1">
                    <FlaskConical className="w-3.5 h-3.5 text-[#6B21A8]" />
                    <span>Portion Quality Analysis (Plant QA vs ZMCC Dispatch)</span>
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">
                    Authoritative Lab Tests (LT-000008 LR · LT-000026 Fat)
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-[#EAE4D5]/80">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F8FAFC] text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-[#EAE4D5]/80">
                      <tr>
                        <th className="py-2 px-3">Portion</th>
                        <th className="py-2 px-3">Dispatch LR</th>
                        <th className="py-2 px-3">Plant LR</th>
                        <th className="py-2 px-3 font-mono">LR Diff</th>
                        <th className="py-2 px-3">Dispatch Fat</th>
                        <th className="py-2 px-3">Plant Fat</th>
                        <th className="py-2 px-3 font-mono">Fat Diff</th>
                        <th className="py-2 px-3">QA Decision</th>
                        <th className="py-2 px-3 text-right">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4D5]/40 font-mono">
                      {item.portions.map((p) => {
                        return (
                          <tr key={p.portionNumber} className="hover:bg-[#FDFBF9] transition-colors">
                            <td className="py-2 px-3 font-black text-slate-900">{p.portionNumber}</td>
                            <td className="py-2 px-3 text-slate-700">
                              {p.dispatchLr != null ? p.dispatchLr : '—'}
                            </td>
                            <td className="py-2 px-3 font-bold text-slate-900">
                              {p.plantLr != null ? p.plantLr : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 font-black ${
                                p.lrDiff == null || p.lrDiff === 0
                                  ? 'text-slate-500'
                                  : p.lrDiff > 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {p.lrDiffText}
                            </td>
                            <td className="py-2 px-3 text-slate-700">
                              {p.dispatchFat != null ? `${p.dispatchFat}%` : '—'}
                            </td>
                            <td className="py-2 px-3 font-bold text-slate-900">
                              {p.plantFat != null ? `${p.plantFat}%` : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 font-black ${
                                p.fatDiff == null || p.fatDiff === 0
                                  ? 'text-slate-500'
                                  : p.fatDiff > 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {p.fatDiffText}
                            </td>
                            <td className="py-2 px-3 font-sans">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                  p.qaDecision === 'ACCEPTED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : p.qaDecision === 'REJECTED'
                                    ? 'bg-red-100 text-red-800'
                                    : p.qaDecision === 'HOLD'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {p.qaDecision}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-sans text-right text-[11px] text-slate-600 truncate max-w-xs">
                              {p.qaDecisionRemarks || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
