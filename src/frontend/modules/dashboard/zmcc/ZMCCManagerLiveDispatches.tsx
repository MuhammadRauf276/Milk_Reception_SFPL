'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { buildVehicleVisitGroups } from './zmccManagerHelpers';
import { ManagerLifecycleTracker } from './ManagerLifecycleTracker';
import {
  Truck,
  Search,
  Eye,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface ZMCCManagerLiveDispatchesProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

type LiveLifecycleFilter =
  | 'ALL_ACTIVE'
  | 'GATE_ENTERED'
  | 'PLANT_QA'
  | 'WEIGHBRIDGE'
  | 'UNLOADING'
  | 'AWAITING_RECEIPT';

const CARDS_PER_PAGE = 6;

export const ZMCCManagerLiveDispatches: React.FC<ZMCCManagerLiveDispatchesProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lifecycleFilter, setLifecycleFilter] = useState<LiveLifecycleFilter>('ALL_ACTIVE');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Build vehicle visit groups (independent of historical Business Date filter)
  const allGroups = useMemo(() => {
    return buildVehicleVisitGroups(logs);
  }, [logs]);

  // Active in-plant groups (prioritize active workflow state irrespective of midnight/08:00 date boundary)
  const activeGroups = useMemo(() => {
    return allGroups.filter((g) => {
      const isInPlant = g.lifecycle.isInPlant;
      const isDispatched = g.overallStatus === 'DISPATCHED';
      const isNotComplete = !g.lifecycle.isComplete;
      return (isInPlant || isDispatched) && isNotComplete;
    });
  }, [allGroups]);

  // Filtered active groups
  const filteredActiveGroups = useMemo(() => {
    return activeGroups.filter((g) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchVehicle = g.vehicleNumber.toLowerCase().includes(q);
        const matchToken = g.tokenNumber ? g.tokenNumber.toLowerCase().includes(q) : false;
        if (!matchVehicle && !matchToken) return false;
      }

      // 2. Lifecycle Filter
      if (lifecycleFilter === 'ALL_ACTIVE') return true;
      if (lifecycleFilter === 'GATE_ENTERED') return g.lifecycle.currentStageId === 'GATE_ENTRY';
      if (lifecycleFilter === 'PLANT_QA') return g.lifecycle.currentStageId === 'PLANT_QA';
      if (lifecycleFilter === 'WEIGHBRIDGE')
        return (
          g.lifecycle.currentStageId === 'FIRST_WEIGHT' ||
          g.lifecycle.currentStageId === 'SECOND_WEIGHT'
        );
      if (lifecycleFilter === 'UNLOADING') return g.lifecycle.currentStageId === 'UNLOADING';
      if (lifecycleFilter === 'AWAITING_RECEIPT')
        return g.lifecycle.currentStageId === 'FINAL_RECEIPT';

      return true;
    });
  }, [activeGroups, searchQuery, lifecycleFilter]);

  // Reset to first page when search query or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, lifecycleFilter]);

  // Pagination calculation: exactly 6 cards per screen/page
  const totalPages = Math.max(1, Math.ceil(filteredActiveGroups.length / CARDS_PER_PAGE));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const paginatedGroups = useMemo(() => {
    const startIdx = (validCurrentPage - 1) * CARDS_PER_PAGE;
    return filteredActiveGroups.slice(startIdx, startIdx + CARDS_PER_PAGE);
  }, [filteredActiveGroups, validCurrentPage]);

  // Error State
  if (error) {
    return (
      <div className="bg-card border-border p-8 rounded-xl border text-center space-y-3" role="alert">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto border border-rose-200">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h4 className="text-base font-semibold text-rose-800">Unable to load dispatches</h4>
        <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition min-h-11"
          >
            <span>Retry Loading</span>
          </button>
        )}
      </div>
    );
  }

  // Loading State
  if (isLoading && logs.length === 0) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading live dispatches">
        <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs animate-pulse space-y-3">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="h-10 bg-slate-100 rounded w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="region" aria-label="ZMCC Manager Live Dispatches">
      <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
          <div className="flex items-center space-x-2">
            <Truck className="w-5 h-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Live vehicles
              </h3>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-start sm:self-auto">
            <span className="px-3 py-1 rounded-full text-xs tabular-nums font-semibold bg-blue-50 text-primary-hover border border-blue-200">
              {activeGroups.length} active
            </span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicle number, token #…"
              aria-label="Search live vehicles"
              className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden shadow-2xs min-h-11"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Stage filters">
            <button
              onClick={() => setLifecycleFilter('ALL_ACTIVE')}
              className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition ${
                lifecycleFilter === 'ALL_ACTIVE'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-slate-600 border border-border/80 hover:bg-muted/60'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setLifecycleFilter('GATE_ENTERED')}
              className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition ${
                lifecycleFilter === 'GATE_ENTERED'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-slate-600 border border-border/80 hover:bg-muted/60'
              }`}
            >
              Gate
            </button>
            <button
              onClick={() => setLifecycleFilter('PLANT_QA')}
              className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition ${
                lifecycleFilter === 'PLANT_QA'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-slate-600 border border-border/80 hover:bg-muted/60'
              }`}
            >
              QA
            </button>
            <button
              onClick={() => setLifecycleFilter('WEIGHBRIDGE')}
              className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition ${
                lifecycleFilter === 'WEIGHBRIDGE'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-slate-600 border border-border/80 hover:bg-muted/60'
              }`}
            >
              Scale
            </button>
            <button
              onClick={() => setLifecycleFilter('UNLOADING')}
              className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition ${
                lifecycleFilter === 'UNLOADING'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-slate-600 border border-border/80 hover:bg-muted/60'
              }`}
            >
              Silo
            </button>
            <button
              onClick={() => setLifecycleFilter('AWAITING_RECEIPT')}
              className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition ${
                lifecycleFilter === 'AWAITING_RECEIPT'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-subtle text-slate-600 border border-border/80 hover:bg-muted/60'
              }`}
            >
              Receipt
            </button>
          </div>
        </div>
      </div>

      {filteredActiveGroups.length === 0 ? (
        <div className="p-8 rounded-xl bg-card border border-border/80 shadow-xs text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto border border-slate-200">
            <Truck className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">No Active Dispatches in Pipeline</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {searchQuery
              ? `No active dispatches match search query "${searchQuery}".`
              : 'There are currently no tankers from this ZMCC source in plant reception.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedGroups.map((group, idx) => {
              const lc = group.lifecycle;
              const primary = group.primaryLog;
              const overallIdx = (validCurrentPage - 1) * CARDS_PER_PAGE + idx;
              const isFirst = overallIdx === 0;

              return (
                <div
                  key={group.visitId}
                  className={`p-5 rounded-xl border transition-all flex flex-col justify-between space-y-3.5 shadow-2xs ${
                    isFirst
                      ? 'bg-primary/5 border-primary ring-1 ring-primary'
                      : 'bg-card border-border/80 hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums tracking-wide shadow-2xs ${
                          isFirst
                            ? 'bg-primary text-white'
                            : 'bg-muted text-slate-700 border border-border'
                        }`}
                      >
                        {isFirst ? 'NEXT IN LINE' : `POSITION #${overallIdx + 1}`}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600 tabular-nums uppercase bg-subtle px-2 py-0.5 rounded border border-border">
                        Visit #{group.visitId}
                      </span>
                    </div>

                    <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 tabular-nums text-[10px] font-semibold text-emerald-800">
                      {group.portions.length} Portion{group.portions.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-foreground">
                        {group.vehicleNumber}
                      </h4>
                      {lc.elapsedInPlant && (
                        <div className="flex items-center space-x-1 text-[11px] tabular-nums font-semibold text-slate-500">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{lc.elapsedInPlant}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-slate-500 font-semibold mt-0.5">
                      <span>Token: <strong className="text-foreground">{group.tokenNumber || 'PENDING'}</strong></span>
                      <span>·</span>
                      <span className="truncate">Source: <strong className="text-foreground">{group.sourceName}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-subtle/80 border border-border/60 text-xs">
                    <span className="text-slate-500 font-semibold text-[11px]">Station / Stage:</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                      {lc.currentStageLabel}
                    </span>
                  </div>

                  <div className="py-1">
                    <ManagerLifecycleTracker lifecycle={lc} compact={true} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums pt-2 border-t border-border/80 bg-subtle/40 -mx-5 -mb-3.5 p-3 rounded-b-xl">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Dispatch Qty:</span>
                      <span className="font-semibold text-foreground">
                        {group.vehicleDispatchQuantityValue != null
                          ? `${group.vehicleDispatchQuantityValue.toLocaleString()} ${group.vehicleDispatchQuantityUnit || ''}`
                          : group.totalDispatchGrossLiters != null
                          ? `${group.totalDispatchGrossLiters.toLocaleString()} L`
                          : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 block">First Weight:</span>
                      <span className="font-semibold text-foreground">
                        {group.firstWeightKg != null ? `${group.firstWeightKg.toLocaleString()} KG` : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-500 block">Second Weight:</span>
                      <span className="font-semibold text-foreground">
                        {group.secondWeightKg != null ? `${group.secondWeightKg.toLocaleString()} KG` : '—'}
                      </span>
                    </div>

                    <div className="flex items-end justify-end">
                      <button
                        onClick={() => onInspectDetails(primary)}
                        className="w-full py-1 px-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-semibold transition flex items-center justify-center space-x-1 shadow-2xs min-h-11"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Inspect</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="p-3.5 rounded-xl bg-card border border-border/80 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-slate-600 font-semibold tabular-nums">
                Showing{' '}
                <strong className="text-foreground">
                  {(validCurrentPage - 1) * CARDS_PER_PAGE + 1}–
                  {Math.min(validCurrentPage * CARDS_PER_PAGE, filteredActiveGroups.length)}
                </strong>{' '}
                of <strong className="text-foreground">{filteredActiveGroups.length}</strong> active vehicles
                {' '}(Page {validCurrentPage} of {totalPages})
              </span>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={validCurrentPage === 1}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs min-h-11"
                  aria-label="Previous Page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center space-x-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                    <button
                      key={`page-${pg}`}
                      onClick={() => setCurrentPage(pg)}
                      className={`w-7 h-7 rounded-lg text-xs font-semibold tabular-nums transition ${
                        validCurrentPage === pg
                          ? 'bg-primary text-white shadow-2xs'
                          : 'bg-subtle text-slate-600 border border-border hover:bg-muted'
                      }`}
                    >
                      {pg}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={validCurrentPage === totalPages}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-border bg-subtle hover:bg-muted text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs min-h-11"
                  aria-label="Next Page"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
