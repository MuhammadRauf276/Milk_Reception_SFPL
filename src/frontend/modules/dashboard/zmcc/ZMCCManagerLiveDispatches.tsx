'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { buildVehicleVisitGroups } from './zmccManagerHelpers';
import { ManagerLifecycleTracker } from './ManagerLifecycleTracker';
import { HorizontalScrollRow } from '@/components/ui/horizontal-scroll-row';
import { useListPageSize } from '@/components/ui/pagination';
import {
  Truck,
  Search,
  Eye,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { ErrorState } from '@/components/ui/empty-state';

interface ZMCCManagerLiveDispatchesProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /**
   * The server pages and searches the list, for a window longer than the live queue. These vehicles are not a queue,
   * so the queue position and the stage filters (which could only see the current page) are left out.
   */
  serverPaging?: {
    title: string;
    page: number;
    pageSize: number;
    totalPages: number;
    totalVehicles: number;
    search: string;
    onSearchChange: (search: string) => void;
    onPageChange: (page: number) => void;
  };
}

type LiveLifecycleFilter =
  | 'ALL_ACTIVE'
  | 'GATE_ENTERED'
  | 'PLANT_QA'
  | 'WEIGHBRIDGE'
  | 'UNLOADING'
  | 'AWAITING_RECEIPT';

export const ZMCCManagerLiveDispatches: React.FC<ZMCCManagerLiveDispatchesProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
  serverPaging,
}) => {
  const [localSearch, setLocalSearch] = useState<string>('');
  const searchQuery = serverPaging ? serverPaging.search : localSearch;
  const setSearchQuery = serverPaging ? serverPaging.onSearchChange : setLocalSearch;
  const [lifecycleFilter, setLifecycleFilter] = useState<LiveLifecycleFilter>('ALL_ACTIVE');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const defaultCardsPerPage = useListPageSize(25);

  // Build vehicle visit groups (independent of historical Business Date filter)
  const allGroups = useMemo(() => {
    return buildVehicleVisitGroups(logs);
  }, [logs]);

  // The live feed already holds only visits that have not left the gate, so every group in it is shown
  // (including a vehicle whose receipt is posted and is awaiting gate exit). Filtering on a derived
  // "in plant / not complete" state hid vehicles the In-Transit count still included.
  const activeGroups = allGroups;

  // Filtered active groups
  const filteredActiveGroups = useMemo(() => {
    if (serverPaging) return activeGroups;
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
        return g.lifecycle.currentStageId === 'FINAL_RECEIPT' || g.lifecycle.currentStageId === 'GATE_EXIT';

      return true;
    });
  }, [activeGroups, searchQuery, lifecycleFilter, serverPaging]);

  // Reset to first page when search query or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, lifecycleFilter]);

  // Pagination calculation: responsive page size (10 on mobile, 25 on desktop)
  const perPage = serverPaging?.pageSize ?? defaultCardsPerPage;
  const totalVehicles = serverPaging?.totalVehicles ?? filteredActiveGroups.length;
  const totalPages = serverPaging?.totalPages ?? Math.max(1, Math.ceil(filteredActiveGroups.length / defaultCardsPerPage));
  const validCurrentPage = serverPaging?.page ?? Math.min(currentPage, totalPages);
  const goToPage = serverPaging?.onPageChange ?? setCurrentPage;
  const paginatedGroups = useMemo(() => {
    if (serverPaging) return filteredActiveGroups;
    const startIdx = (validCurrentPage - 1) * defaultCardsPerPage;
    return filteredActiveGroups.slice(startIdx, startIdx + defaultCardsPerPage);
  }, [filteredActiveGroups, validCurrentPage, serverPaging, defaultCardsPerPage]);

  // Could not load: a quiet placeholder with Try again, and the problem itself as a popup.
  if (error) {
    return <ErrorState title="Dispatches did not load" description={error} onRetry={onRetry} />;
  }

  // Loading State
  if (isLoading && logs.length === 0) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading live dispatches">
        <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs animate-pulse space-y-3">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-10 bg-muted rounded w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="region" aria-label="Live dispatches">
      <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
          <div className="flex items-center space-x-2">
            <Truck className="w-5 h-5 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {serverPaging?.title ?? 'Live vehicles'}
              </h3>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-start sm:self-auto">
            <span className="px-3 py-1 rounded-md text-xs tabular-nums font-semibold bg-blue-50 text-primary-hover border border-blue-200">
              {serverPaging ? `${totalVehicles} vehicles` : `${activeGroups.length} active`}
            </span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicle number, token #…"
              aria-label="Search live vehicles"
              className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden shadow-2xs min-h-11"
            />
          </div>

          {!serverPaging && (
          <HorizontalScrollRow className="min-w-0 lg:flex-1">
            <div className="flex items-center gap-2 min-w-max" role="toolbar" aria-label="Stage filters">
              <button
                onClick={() => setLifecycleFilter('ALL_ACTIVE')}
                className={`px-3 py-2 min-h-11 shrink-0 rounded-lg text-xs font-semibold transition ${
                  lifecycleFilter === 'ALL_ACTIVE'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-secondary-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setLifecycleFilter('GATE_ENTERED')}
                className={`px-3 py-2 min-h-11 shrink-0 rounded-lg text-xs font-semibold transition ${
                  lifecycleFilter === 'GATE_ENTERED'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-secondary-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                Gate
              </button>
              <button
                onClick={() => setLifecycleFilter('PLANT_QA')}
                className={`px-3 py-2 min-h-11 shrink-0 rounded-lg text-xs font-semibold transition ${
                  lifecycleFilter === 'PLANT_QA'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-secondary-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                QA
              </button>
              <button
                onClick={() => setLifecycleFilter('WEIGHBRIDGE')}
                className={`px-3 py-2 min-h-11 shrink-0 rounded-lg text-xs font-semibold transition ${
                  lifecycleFilter === 'WEIGHBRIDGE'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-secondary-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                Scale
              </button>
              <button
                onClick={() => setLifecycleFilter('UNLOADING')}
                className={`px-3 py-2 min-h-11 shrink-0 rounded-lg text-xs font-semibold transition ${
                  lifecycleFilter === 'UNLOADING'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-secondary-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                Silo
              </button>
              <button
                onClick={() => setLifecycleFilter('AWAITING_RECEIPT')}
                className={`px-3 py-2 min-h-11 shrink-0 rounded-lg text-xs font-semibold transition ${
                  lifecycleFilter === 'AWAITING_RECEIPT'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-subtle text-secondary-foreground border border-border/80 hover:bg-muted/60'
                }`}
              >
                Receipt
              </button>
            </div>
          </HorizontalScrollRow>
          )}
        </div>
      </div>

      {filteredActiveGroups.length === 0 ? (
        <div className="p-8 rounded-2xl bg-card border border-border/80 shadow-xs text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto border border-border">
            <Truck className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">{serverPaging ? 'No vehicles yet' : 'No Active Dispatches in Pipeline'}</h4>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {searchQuery
              ? `No ${serverPaging ? 'vehicles' : 'active dispatches'} match search query "${searchQuery}".`
              : serverPaging
              ? 'No vehicles were dispatched in this period.'
              : 'There are currently no tankers in plant reception.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
            {paginatedGroups.map((group, idx) => {
              const lc = group.lifecycle;
              const primary = group.primaryLog;
              const overallIdx = (validCurrentPage - 1) * perPage + idx;
              const isFirst = !serverPaging && overallIdx === 0;

              return (
                <div
                  key={group.visitId}
                  className={`p-5 rounded-xl border transition-[color,background-color,border-color,box-shadow,opacity,transform] flex flex-col justify-between space-y-3.5 shadow-2xs ${
                    isFirst
                      ? 'bg-primary/5 border-primary ring-1 ring-primary'
                      : 'bg-card border-border/80 hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      {!serverPaging && (
                        <span
                          className={`px-3 py-0.5 rounded-md text-xs font-semibold tabular-nums  shadow-2xs ${
                            isFirst
                              ? 'bg-primary text-white'
                              : 'bg-muted text-secondary-foreground border border-border'
                          }`}
                        >
                          {isFirst ? 'NEXT IN LINE' : `POSITION #${overallIdx + 1}`}
                        </span>
                      )}
                    </div>

                    <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 tabular-nums text-xs font-semibold text-emerald-800">
                      {group.portions.length} Portion{group.portions.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-xl sm:text-2xl font-semibold tabular-nums text-foreground">
                        {group.vehicleNumber}
                      </h4>
                      {lc.elapsedInPlant && (
                        <div className="flex items-center space-x-1 text-xs tabular-nums font-semibold text-muted-foreground">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span>{lc.elapsedInPlant}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-muted-foreground font-semibold mt-0.5">
                      <span>Token: <strong className="text-foreground">{group.tokenNumber || 'PENDING'}</strong></span>
                      <span>·</span>
                      <span className="min-w-0 break-words">Source: <strong className="text-foreground">{group.sourceName}</strong></span>
                    </div>
                  </div>

                  <div className="py-1">
                    <ManagerLifecycleTracker lifecycle={lc} compact={true} />
                  </div>

                  <div className="pt-3 border-t border-border/80 bg-subtle/40 -mx-5 -mb-3.5 p-3 rounded-b-xl space-y-2.5 text-xs tabular-nums">
                    <HorizontalScrollRow>
                      <div className="flex items-start gap-4 min-w-max pr-1">
                        <div className="min-w-25 shrink-0">
                          <span className="text-xs text-muted-foreground block">Dispatch (@13 TS):</span>
                          <span className="font-semibold text-foreground">
                            {group.totalDispatch13TsLiters != null
                              ? `${group.totalDispatch13TsLiters.toLocaleString()} L @13 TS`
                              : '—'}
                          </span>
                        </div>

                        <div className="min-w-22 shrink-0">
                          <span className="text-xs text-muted-foreground block">Dispatch (gross):</span>
                          <span className="font-semibold text-foreground">
                            {group.totalDispatchGrossLiters != null
                              ? `${group.totalDispatchGrossLiters.toLocaleString()} L`
                              : '—'}
                          </span>
                        </div>

                        <div className="min-w-21 shrink-0">
                          <span className="text-xs text-muted-foreground block">First Weight:</span>
                          <span className="font-semibold text-foreground">
                            {group.firstWeightKg != null ? `${group.firstWeightKg.toLocaleString()} KG` : '—'}
                          </span>
                        </div>

                        <div className="min-w-21 shrink-0">
                          <span className="text-xs text-muted-foreground block">Second Weight:</span>
                          <span className="font-semibold text-foreground">
                            {group.secondWeightKg != null ? `${group.secondWeightKg.toLocaleString()} KG` : '—'}
                          </span>
                        </div>
                      </div>
                    </HorizontalScrollRow>

                    <button
                      onClick={() => onInspectDetails(primary)}
                      className="w-full py-1 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition flex items-center justify-center space-x-1.5 shadow-2xs min-h-11"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-secondary-foreground font-semibold tabular-nums">
                Showing{' '}
                <strong className="text-foreground">
                  {(validCurrentPage - 1) * perPage + 1}–
                  {Math.min(validCurrentPage * perPage, totalVehicles)}
                </strong>{' '}
                of <strong className="text-foreground">{totalVehicles}</strong> {serverPaging ? 'vehicles' : 'active vehicles'}
                {' '}(Page {validCurrentPage} of {totalPages})
              </span>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => goToPage(Math.max(1, validCurrentPage - 1))}
                  disabled={validCurrentPage === 1}
                  className="inline-flex items-center space-x-1 px-3 py-2 rounded-lg border border-action/30 bg-action-soft hover:bg-action-soft text-xs font-semibold text-action disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs min-h-11"
                  aria-label="Previous Page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center space-x-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                    <button
                      key={`page-${pg}`}
                      onClick={() => goToPage(pg)}
                      className={`min-w-11 min-h-11 rounded-lg text-xs font-semibold tabular-nums transition ${
                        validCurrentPage === pg
                          ? 'bg-primary text-white shadow-2xs'
                          : 'bg-subtle text-secondary-foreground border border-border hover:bg-muted'
                      }`}
                    >
                      {pg}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => goToPage(Math.min(totalPages, validCurrentPage + 1))}
                  disabled={validCurrentPage === totalPages}
                  className="inline-flex items-center space-x-1 px-3 py-2 rounded-lg border border-action/30 bg-action-soft hover:bg-action-soft text-xs font-semibold text-action disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs min-h-11"
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
