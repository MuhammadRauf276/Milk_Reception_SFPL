'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  buildVehicleVisitGroups,
  deriveVehicleReconciliationItems,
} from './zmccManagerHelpers';
import {
  ArrowRightLeft,
  Search,
  RefreshCw,
  AlertTriangle,
  Scale,
  FlaskConical,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  XCircle,
  Warehouse,
} from 'lucide-react';

export type ReconciliationFilter =
  | 'ALL'
  | 'COMPLETED'
  | 'RECEIPT_PENDING'
  | 'HAS_QUANTITY_DIFF'
  | 'HAS_TS_DIFF'
  | 'HAS_REJECTION';

interface ZMCCManagerReconciliationProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pagination?: {
    page: number;
    totalPages: number;
    totalRecords: number;
    hasMore: boolean;
  };
}

const FILTER_OPTIONS: { id: ReconciliationFilter; label: string }[] = [
  { id: 'ALL', label: 'All on Page' },
  { id: 'COMPLETED', label: 'Completed Receipts' },
  { id: 'RECEIPT_PENDING', label: 'Receipt Pending' },
  { id: 'HAS_QUANTITY_DIFF', label: 'Quantity Differences' },
  { id: 'HAS_TS_DIFF', label: '13% TS Differences' },
  { id: 'HAS_REJECTION', label: 'QA Rejected' },
];

export const ZMCCManagerReconciliation: React.FC<ZMCCManagerReconciliationProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
  pagination,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterState, setFilterState] = useState<ReconciliationFilter>('ALL');
  const [expandedVisitId, setExpandedVisitId] = useState<number | null>(null);

  // Build groups and derive reconciliation models
  const groups = useMemo(() => buildVehicleVisitGroups(logs), [logs]);
  const reconciliationItems = useMemo(() => deriveVehicleReconciliationItems(groups), [groups]);

  // Compute calculated fields for each item
  const enrichedItems = useMemo(() => {
    return reconciliationItems.map((item) => {
      let tsDelta: number | null = null;
      let tsDeltaText = '—';
      if (item.plant13TsLiters != null && item.dispatch13TsLiters != null) {
        tsDelta = Number((item.plant13TsLiters - item.dispatch13TsLiters).toFixed(2));
        if (tsDelta === 0) {
          tsDeltaText = '0 L';
        } else if (tsDelta > 0) {
          tsDeltaText = `+${tsDelta.toLocaleString()} L`;
        } else {
          tsDeltaText = `${tsDelta.toLocaleString()} L`;
        }
      }

      const hasTsDifference = tsDelta != null && tsDelta !== 0;

      return {
        ...item,
        tsDelta,
        tsDeltaText,
        hasTsDifference,
      };
    });
  }, [reconciliationItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return enrichedItems.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchVehicle = item.vehicleNumber.toLowerCase().includes(q);
        const matchToken = item.tokenNumber ? item.tokenNumber.toLowerCase().includes(q) : false;
        if (!matchVehicle && !matchToken) return false;
      }

      // 2. Filter State
      if (filterState === 'ALL') return true;
      if (filterState === 'COMPLETED') return item.isCompletedReceipt;
      if (filterState === 'RECEIPT_PENDING') return item.isReceiptPending;
      if (filterState === 'HAS_QUANTITY_DIFF') return item.hasQuantityDifference;
      if (filterState === 'HAS_TS_DIFF') return item.hasTsDifference;
      if (filterState === 'HAS_REJECTION') return item.hasRejection;

      return true;
    });
  }, [enrichedItems, searchQuery, filterState]);

  // Summary Metrics
  const summary = useMemo(() => {
    const total = enrichedItems.length;
    const completed = enrichedItems.filter((i) => i.isCompletedReceipt).length;
    const pendingReceipt = enrichedItems.filter((i) => i.isReceiptPending).length;
    const qtyDiffCount = enrichedItems.filter((i) => i.hasQuantityDifference).length;
    const tsDiffCount = enrichedItems.filter((i) => i.hasTsDifference).length;
    const rejectedCount = enrichedItems.filter((i) => i.hasRejection).length;
    return { total, completed, pendingReceipt, qtyDiffCount, tsDiffCount, rejectedCount };
  }, [enrichedItems]);

  const showKpiPlaceholders = isLoading || error != null;

  return (
    <div className="space-y-6" role="region" aria-label="ZMCC Manager Reconciliation">
      {/* 1. Header & Summary Banner */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A]">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#111311]">
                Reconciliation Ledger: {assignedSourceName}
              </h2>
              <p className="text-xs text-[#475569]">
                Vehicle-level comparison of declared ZMCC dispatches against official factory received quantities, 13% TS solids, and QA decisions.
              </p>
              <p className="text-[11px] text-slate-500 italic mt-0.5">
                Metrics, filters, and search below apply to the current bounded server page. Use the server pagination controls below to review additional records.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
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

        {/* Bounded Page Notice */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Reconciliation metrics, filters, and search below apply to the visible page ({pagination.page} of {pagination.totalPages}). The full query contains {pagination.totalRecords} visits.
              </span>
            </div>
            <span className="text-[11px] font-bold text-amber-700">Bounded page metrics</span>
          </div>
        )}

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
          <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
            <span className="text-[10px] font-sans text-slate-500 block uppercase font-bold">Visits on Page</span>
            <span className="text-lg font-black text-slate-900">
              {showKpiPlaceholders ? '—' : summary.total}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
            <span className="text-[10px] font-sans text-emerald-700 block uppercase font-bold">Completed on Page</span>
            <span className="text-lg font-black text-emerald-900">
              {showKpiPlaceholders ? '—' : summary.completed}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
            <span className="text-[10px] font-sans text-amber-700 block uppercase font-bold">Pending on Page</span>
            <span className="text-lg font-black text-amber-900">
              {showKpiPlaceholders ? '—' : summary.pendingReceipt}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FDF2F8] border border-[#FBCFE8]">
            <span className="text-[10px] font-sans text-pink-700 block uppercase font-bold">Qty Delta on Page</span>
            <span className="text-lg font-black text-pink-900">
              {showKpiPlaceholders ? '—' : summary.qtyDiffCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF]">
            <span className="text-[10px] font-sans text-purple-700 block uppercase font-bold">13% TS Delta on Page</span>
            <span className="text-lg font-black text-purple-900">
              {showKpiPlaceholders ? '—' : summary.tsDiffCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA]">
            <span className="text-[10px] font-sans text-red-700 block uppercase font-bold">QA Rejections on Page</span>
            <span className="text-lg font-black text-red-900">
              {showKpiPlaceholders ? '—' : summary.rejectedCount}
            </span>
          </div>
        </div>

        {/* 2. Controls & Filter Pills */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            {FILTER_OPTIONS.map((opt) => {
              const active = filterState === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilterState(opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all ${
                    active
                      ? 'bg-[#1E3A8A] text-white shadow-xs'
                      : 'bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] border border-[#EAE4D5]/80'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search current page vehicle or token..."
              aria-label="Search current page vehicle or token"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5] text-xs text-[#111311] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            />
          </div>
        </div>
      </div>

      {/* 3. Error Alert */}
      {error && (
        <div className="p-6 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-center space-y-2" role="alert">
          <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-extrabold text-[#991B1B]">Unable to Load Reconciliation Ledger</h4>
          <p className="text-xs text-red-700 max-w-md mx-auto">{error}</p>
        </div>
      )}

      {/* 4. Loading Skeleton */}
      {isLoading && enrichedItems.length === 0 && (
        <div className="p-8 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 space-y-4 animate-pulse">
          <div className="h-6 bg-slate-200 rounded w-1/4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-10 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 text-center space-y-2">
          <ArrowRightLeft className="w-8 h-8 text-slate-300 mx-auto" />
          <h4 className="text-sm font-extrabold text-slate-700">No Reconciliation Records Found</h4>
          <p className="text-xs text-slate-500">
            No vehicle records match the selected filter criteria for this reporting period.
          </p>
        </div>
      )}

      {/* 6. Canonical Reconciliation Table */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="bg-[#FFFFFF] border border-[#EAE4D5] rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#EAE4D5] text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-3">Vehicle</th>
                  <th className="py-3 px-3 text-right">Dispatch Gross (L)</th>
                  <th className="py-3 px-3 text-right">Plant Received (L)</th>
                  <th className="py-3 px-3 text-right">Gross Delta</th>
                  <th className="py-3 px-3 text-right">Dispatch @13TS</th>
                  <th className="py-3 px-3 text-right">Plant @13TS</th>
                  <th className="py-3 px-3 text-right">@13TS Delta</th>
                  <th className="py-3 px-3 text-center">QA Summary</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE4D5]/60 font-mono text-xs">
                {filteredItems.map((item) => {
                  const isExpanded = expandedVisitId === item.visitId;
                  const qaSummary = item.group.lifecycle.portionQA;

                  return (
                    <React.Fragment key={item.visitId}>
                      <tr className={`hover:bg-[#FDFBF9] transition-colors ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                        {/* 1. Vehicle */}
                        <td className="py-3 px-3">
                          <div className="flex items-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => setExpandedVisitId(isExpanded ? null : item.visitId)}
                              className="p-1 rounded hover:bg-slate-200 text-slate-500"
                              title={isExpanded ? 'Collapse row' : 'Expand details'}
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                            <div>
                              <span className="font-black text-slate-900 block">{item.vehicleNumber}</span>
                              {item.tokenNumber && (
                                <span className="text-[10px] text-slate-500 block">Tk: {item.tokenNumber}</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 2. Dispatch Gross Liters */}
                        <td className="py-3 px-3 text-right font-black text-slate-900">
                          {item.dispatchGrossLiters != null ? `${item.dispatchGrossLiters.toLocaleString()} L` : '—'}
                        </td>

                        {/* 3. Plant Received Gross Liters */}
                        <td className="py-3 px-3 text-right font-black">
                          {item.physicalReceivedLiters != null ? (
                            <span className="text-[#166534]">{item.physicalReceivedLiters.toLocaleString()} L</span>
                          ) : item.isReceiptPending ? (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-sans font-bold">
                              Pending Scale/Offloading
                            </span>
                          ) : (
                            <span className="text-slate-400 font-sans text-[11px]">Pending Reception</span>
                          )}
                        </td>

                        {/* 4. Gross Delta */}
                        <td className="py-3 px-3 text-right font-black">
                          {item.quantityDifferenceLiters != null ? (
                            <span
                              className={
                                item.quantityDifferenceLiters === 0
                                  ? 'text-slate-600'
                                  : item.quantityDifferenceLiters > 0
                                  ? 'text-[#166534]'
                                  : 'text-[#991B1B]'
                              }
                            >
                              {item.quantityDifferenceText}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* 5. Dispatch @13TS */}
                        <td className="py-3 px-3 text-right text-slate-800">
                          {item.dispatch13TsLiters != null ? `${item.dispatch13TsLiters.toLocaleString()} L` : '—'}
                        </td>

                        {/* 6. Plant @13TS */}
                        <td className="py-3 px-3 text-right font-black">
                          {item.plant13TsLiters != null ? (
                            <span className="text-[#6B21A8]">{item.plant13TsLiters.toLocaleString()} L</span>
                          ) : (
                            <span className="text-slate-400 font-sans text-[11px]">Pending</span>
                          )}
                        </td>

                        {/* 7. @13TS Delta */}
                        <td className="py-3 px-3 text-right font-black">
                          {item.tsDelta != null ? (
                            <span
                              className={
                                item.tsDelta === 0
                                  ? 'text-slate-600'
                                  : item.tsDelta > 0
                                  ? 'text-[#166534]'
                                  : 'text-[#991B1B]'
                              }
                            >
                              {item.tsDeltaText}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* 8. QA Summary */}
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-sans font-bold ${
                              qaSummary.badgeType === 'ALL_ACCEPTED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : qaSummary.badgeType === 'ALL_REJECTED' || qaSummary.badgeType === 'MIXED'
                                ? 'bg-red-100 text-red-800'
                                : qaSummary.badgeType === 'HAS_HOLD'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {qaSummary.summaryText}
                          </span>
                        </td>

                        {/* 9. Status */}
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-sans font-black uppercase tracking-wider ${
                              item.isCompletedReceipt
                                ? 'bg-emerald-100 text-emerald-800'
                                : item.isReceiptPending
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {item.lifecycleStatus}
                          </span>
                        </td>

                        {/* Action */}
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => onInspectDetails(item.group.primaryLog)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-sans font-bold text-[#1E3A8A] hover:bg-[#EFF6FF] transition"
                            title="Inspect full details"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Sub-Row: Detailed Breakdown */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={10} className="p-4 border-b border-[#EAE4D5]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              {/* Scale & Silo Weights */}
                              <div className="p-3 bg-white rounded-lg border border-[#EAE4D5] space-y-2">
                                <div className="flex items-center space-x-2 font-sans font-bold text-slate-800 pb-1 border-b border-slate-100">
                                  <Warehouse className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>Weighbridge & Destination Silo</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                                  <div>
                                    <span className="text-[10px] text-slate-500 font-sans block">1st Weight (Gross):</span>
                                    <span className="font-bold text-slate-900">
                                      {item.firstWeightKg != null ? `${item.firstWeightKg.toLocaleString()} kg` : '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-slate-500 font-sans block">2nd Weight (Tare):</span>
                                    <span className="font-bold text-slate-900">
                                      {item.secondWeightKg != null ? `${item.secondWeightKg.toLocaleString()} kg` : '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-slate-500 font-sans block">Net Milk Weight:</span>
                                    <span className="font-bold text-blue-900">
                                      {item.netMilkWeightKg != null ? `${item.netMilkWeightKg.toLocaleString()} kg` : '—'}
                                    </span>
                                  </div>
                                </div>
                                <div className="pt-1 text-[11px]">
                                  <span className="text-[10px] text-slate-500 font-sans">Destination Silo: </span>
                                  <span className="font-bold text-slate-800">{item.destinationSilo || '—'}</span>
                                </div>
                              </div>

                              {/* Portion QA Decisions */}
                              <div className="p-3 bg-white rounded-lg border border-[#EAE4D5] space-y-2">
                                <div className="flex items-center space-x-2 font-sans font-bold text-slate-800 pb-1 border-b border-slate-100">
                                  <FlaskConical className="w-3.5 h-3.5 text-purple-700" />
                                  <span>Portion QA Breakdown ({item.portions.length} Portions)</span>
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {item.portions.map((p, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center justify-between py-1 px-2 rounded bg-slate-50 text-[11px]"
                                    >
                                      <span className="font-bold text-slate-700">{p.portionNumber}</span>
                                      <span className="text-slate-600">
                                        {`Fat: ${p.dispatchFat ?? '—'}% / ${p.plantFat ?? '—'}% · LR: ${p.dispatchLr ?? '—'} / ${p.plantLr ?? '—'}`}
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[9.5px] font-sans font-extrabold ${
                                          p.qaDecision === 'ACCEPTED'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : p.qaDecision === 'REJECTED'
                                            ? 'bg-red-100 text-red-800'
                                            : 'bg-slate-100 text-slate-700'
                                        }`}
                                      >
                                        {p.qaDecision}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
