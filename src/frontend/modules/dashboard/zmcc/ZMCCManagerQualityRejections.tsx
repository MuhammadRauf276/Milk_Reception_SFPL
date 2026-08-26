'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  QualityRejectionFilter,
} from './zmccManagerTypes';
import {
  deriveQualityRejectionItems,
  deriveQualityRejectionSummary,
  filterQualityRejectionItems,
} from './zmccManagerHelpers';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import {
  FlaskConical,
  Search,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  FileSpreadsheet,
} from 'lucide-react';

interface ZMCCManagerQualityRejectionsProps {
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

const FILTER_OPTIONS: { id: QualityRejectionFilter; label: string }[] = [
  { id: 'ALL', label: 'All Portions' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'HOLD', label: 'Hold' },
  { id: 'ACCEPTED', label: 'Accepted' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'HAS_QUALITY_DIFF', label: 'Quality Differences' },
];

export const ZMCCManagerQualityRejections: React.FC<ZMCCManagerQualityRejectionsProps> = ({
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
  const [filterState, setFilterState] = useState<QualityRejectionFilter>('ALL');

  // Derive flat portion quality items
  const items = useMemo(() => deriveQualityRejectionItems(logs), [logs]);
  const summary = useMemo(() => deriveQualityRejectionSummary(items), [items]);
  const filteredItems = useMemo(
    () => filterQualityRejectionItems(items, searchQuery, filterState),
    [items, searchQuery, filterState]
  );

  const showKpiPlaceholders = isLoading || error != null;

  return (
    <div className="space-y-6">
      {/* 1. Header & Summary Banner */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#6B21A8]/10 text-[#6B21A8]">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#111311]">
                Quality Analysis & Portion Rejections: {assignedSourceName}
              </h2>
              <p className="text-xs text-[#475569]">
                Portion-wise chemical measurements, official Plant QA decisions, and quarantine reasons.
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
            <span className="text-[10px] font-sans text-slate-500 block uppercase font-bold">Total Portions</span>
            <span className="text-lg font-black text-slate-900">
              {showKpiPlaceholders ? '—' : summary.totalPortions}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
            <span className="text-[10px] font-sans text-emerald-700 block uppercase font-bold">Accepted</span>
            <span className="text-lg font-black text-emerald-800">
              {showKpiPlaceholders ? '—' : summary.acceptedCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA]">
            <span className="text-[10px] font-sans text-red-700 block uppercase font-bold">Rejected</span>
            <span className="text-lg font-black text-red-800">
              {showKpiPlaceholders ? '—' : summary.rejectedCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
            <span className="text-[10px] font-sans text-amber-700 block uppercase font-bold">Hold</span>
            <span className="text-lg font-black text-amber-800">
              {showKpiPlaceholders ? '—' : summary.holdCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#F1F5F9] border border-[#CBD5E1]">
            <span className="text-[10px] font-sans text-slate-600 block uppercase font-bold">Pending</span>
            <span className="text-lg font-black text-slate-800">
              {showKpiPlaceholders ? '—' : summary.pendingCount}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF]">
            <span className="text-[10px] font-sans text-purple-700 block uppercase font-bold">Quality Diff</span>
            <span className="text-lg font-black text-purple-800">
              {showKpiPlaceholders ? '—' : summary.qualityDiffCount}
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
              placeholder="Search vehicle #, token #, portion #..."
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
          <span>Loading quality records...</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-12 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-extrabold text-slate-800">No quality records found</h3>
          <p className="text-xs text-slate-500">
            No quality analysis or rejection records found matching your filters for this reporting period.
          </p>
        </div>
      )}

      {/* 6. Portion Quality & Rejection Cards */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isRejected = item.qaDecision === 'REJECTED';
            const isHold = item.qaDecision === 'HOLD';
            const isAccepted = item.qaDecision === 'ACCEPTED';

            return (
              <div
                key={`${item.visitId}-${item.portionNumber}`}
                className={`p-4 rounded-xl bg-[#FFFFFF] border shadow-xs space-y-3 transition-all ${
                  isRejected
                    ? 'border-red-300 bg-red-50/20'
                    : isHold
                    ? 'border-amber-300 bg-amber-50/20'
                    : 'border-[#EAE4D5]/80 hover:border-[#1E3A8A]/40'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#EAE4D5]/60">
                  <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                    <span className="text-base font-black font-mono text-[#111311] tracking-tight">
                      {item.vehicleNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white">
                      {item.portionNumber}
                    </span>
                    {item.tokenNumber && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        Token: {item.tokenNumber}
                      </span>
                    )}
                    <span className="text-xs font-mono font-bold text-slate-600">
                      Business Date: {item.businessDate}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        isAccepted
                          ? 'bg-emerald-100 text-emerald-800'
                          : isRejected
                          ? 'bg-red-100 text-red-800'
                          : isHold
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {item.qaDecision}
                    </span>
                  </div>

                  <div>
                    <button
                      onClick={() => onInspectDetails(item.log)}
                      className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-bold text-[#1E3A8A] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] transition-all"
                    >
                      <span>View Details</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Rejection / Remarks Alert Banner */}
                {(item.rejectionReasons || item.qaDecisionRemarks) && (
                  <div
                    className={`p-2.5 rounded-lg text-xs font-semibold flex items-start gap-2 ${
                      isRejected
                        ? 'bg-red-100/70 border border-red-200 text-red-900'
                        : isHold
                        ? 'bg-amber-100/70 border border-amber-200 text-amber-900'
                        : 'bg-slate-100 border border-slate-200 text-slate-800'
                    }`}
                  >
                    <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isRejected ? 'text-red-700' : 'text-amber-700'}`} />
                    <div>
                      <span className="font-extrabold uppercase text-[10px] block">
                        {isRejected ? 'Official Plant Rejection Reason:' : 'Quality Decision Remarks:'}
                      </span>
                      <span>{item.rejectionReasons || item.qaDecisionRemarks}</span>
                    </div>
                  </div>
                )}

                {/* Chemical Lab Measurements & Comparison Table */}
                <div className="overflow-x-auto rounded-lg border border-[#EAE4D5]/80">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#F8FAFC] text-[10px] font-sans font-black uppercase tracking-wider text-slate-600 border-b border-[#EAE4D5]/80">
                      <tr>
                        <th className="py-1.5 px-3">Parameter</th>
                        <th className="py-1.5 px-3">Dispatch QA</th>
                        <th className="py-1.5 px-3">Plant QA (Authoritative)</th>
                        <th className="py-1.5 px-3">Difference</th>
                        <th className="py-1.5 px-3 font-sans">QA Event Date/Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4D5]/40 text-xs">
                      <tr className="hover:bg-[#FDFBF9] transition-colors">
                        <td className="py-1.5 px-3 font-sans font-extrabold text-slate-800">
                          LR (Lactometer Reading)
                        </td>
                        <td className="py-1.5 px-3 text-slate-700">
                          {item.dispatchLr != null ? item.dispatchLr : '—'}
                        </td>
                        <td className="py-1.5 px-3 font-bold text-slate-900">
                          {item.plantLr != null ? item.plantLr : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-3 font-black ${
                            item.lrDiff == null || item.lrDiff === 0
                              ? 'text-slate-500'
                              : item.lrDiff > 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {item.lrDiffText}
                        </td>
                        <td className="py-1.5 px-3 font-sans text-slate-600 text-[11px]">
                          {item.qaEventTimestamp ? formatOperationalDatetime(item.qaEventTimestamp) : '—'}
                        </td>
                      </tr>
                      <tr className="hover:bg-[#FDFBF9] transition-colors">
                        <td className="py-1.5 px-3 font-sans font-extrabold text-slate-800">
                          Fat Percentage (%)
                        </td>
                        <td className="py-1.5 px-3 text-slate-700">
                          {item.dispatchFat != null ? `${item.dispatchFat}%` : '—'}
                        </td>
                        <td className="py-1.5 px-3 font-bold text-slate-900">
                          {item.plantFat != null ? `${item.plantFat}%` : '—'}
                        </td>
                        <td
                          className={`py-1.5 px-3 font-black ${
                            item.fatDiff == null || item.fatDiff === 0
                              ? 'text-slate-500'
                              : item.fatDiff > 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {item.fatDiffText}
                        </td>
                        <td className="py-1.5 px-3 font-sans text-slate-600 text-[11px]">
                          {item.qaEventTimestamp ? formatOperationalDatetime(item.qaEventTimestamp) : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
