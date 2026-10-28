'use client';

import React, { useState, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/lib/query/useDebouncedValue';
import { MilkProcessLog } from '@backend/core/types';
import {
  QualityRejectionFilter,
} from './zmccManagerTypes';
import {
  deriveQualityRejectionItems,
  deriveQualityRejectionSummary,
  filterQualityRejectionItems,
} from './zmccManagerHelpers';
import {
  FlaskConical,
  Search,
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle,
  X,
  Loader2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import type { ZmccLabSessionItem } from './zmccQualityTypes';
import { ZMCCLabSessionList } from './ZMCCLabSessionList';
import { ZMCCPlantQAList } from './ZMCCPlantQAList';
import { ZMCCManagerReviewDrawer } from './ZMCCManagerReviewDrawer';


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

const PLANT_FILTER_OPTIONS: { id: QualityRejectionFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'HOLD', label: 'Hold' },
  { id: 'ACCEPTED', label: 'Accepted' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'HAS_QUALITY_DIFF', label: 'Quality diff' },
];

type ZmccViewMode = 'ZMCC_LAB' | 'PLANT_QA';

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
  const [viewMode, setViewMode] = useState<ZmccViewMode>('ZMCC_LAB');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [plantFilterState, setPlantFilterState] = useState<QualityRejectionFilter>('ALL');

  // ZMCC Lab Sessions State
  const [labFilter, setLabFilter] = useState<'ALL' | 'PENDING_REVIEW' | 'REJECTED' | 'REVIEWED_EXITED' | 'APPROVED'>('ALL');

  // Modal Review State
  const [reviewModalSession, setReviewModalSession] = useState<ZmccLabSessionItem | null>(null);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState<string | null>(null);

  // ZMCC lab history: lazy (only for the lab view), debounced search, keeps previous rows while filtering.
  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(searchQuery);
  const labQuery = useQuery({
    queryKey: ['zmcc-manager', 'lab-history', { date: currentFromDate, search: debouncedSearch }],
    enabled: viewMode === 'ZMCC_LAB',
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      if (currentFromDate) params.set('date', currentFromDate);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return fetchJson<{ items?: ZmccLabSessionItem[] }>(`/api/zmcc/lab/history?${params.toString()}`, { signal });
    },
    placeholderData: keepPreviousData,
  });
  const labSessions = useMemo(() => labQuery.data?.items ?? [], [labQuery.data]);
  const labError = labQuery.isError ? getErrorMessage(labQuery.error) || 'Failed to fetch ZMCC lab sessions.' : null;
  const labLoading = viewMode === 'ZMCC_LAB' && labQuery.isPending;
  const fetchLabSessions = () => queryClient.invalidateQueries({ queryKey: ['zmcc-manager', 'lab-history'] });

  // Derived Plant portion quality items
  const plantItems = useMemo(() => deriveQualityRejectionItems(logs), [logs]);
  const plantSummary = useMemo(() => deriveQualityRejectionSummary(plantItems), [plantItems]);
  const filteredPlantItems = useMemo(
    () => filterQualityRejectionItems(plantItems, debouncedSearch, plantFilterState),
    [plantItems, debouncedSearch, plantFilterState]
  );

  // Filtered ZMCC Lab sessions
  const filteredLabSessions = useMemo(() => {
    return labSessions.filter((s) => {
      // Filter by status tab
      if (labFilter === 'PENDING_REVIEW') {
        const isPending =
          s.manager_review_status === 'PENDING' ||
          (s.decision === 'REJECTED' &&
            s.manager_review_status !== 'REVIEWED_EXITED' &&
            s.manager_review_status !== 'APPROVED');
        if (!isPending) return false;
      } else if (labFilter === 'REJECTED') {
        if (s.decision !== 'REJECTED') return false;
      } else if (labFilter === 'REVIEWED_EXITED') {
        if (s.manager_review_status !== 'REVIEWED_EXITED') return false;
      } else if (labFilter === 'APPROVED') {
        if (s.manager_review_status !== 'APPROVED') return false;
      }

      // Filter by search query
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase();
        const motVeh = s.mot_arrival?.journey?.mot_vehicle?.vehicle_number?.toLowerCase() || '';
        const suppVeh = s.local_supplier_arrival?.vehicle_number?.toLowerCase() || '';
        const motTok = s.mot_arrival?.zmcc_token?.toLowerCase() || '';
        const suppTok = s.local_supplier_arrival?.zmcc_token?.toLowerCase() || '';
        const rmr = s.local_supplier_arrival?.rmr_number?.toLowerCase() || '';
        const suppName = s.local_supplier_arrival?.local_supplier?.name?.toLowerCase() || '';

        const match =
          motVeh.includes(q) ||
          suppVeh.includes(q) ||
          motTok.includes(q) ||
          suppTok.includes(q) ||
          rmr.includes(q) ||
          suppName.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [labSessions, labFilter, debouncedSearch]);


  const openReviewModal = (session: ZmccLabSessionItem) => setReviewModalSession(session);

  return (
    <div className="space-y-6">
      {/* 1. Header & Mode Switch */}
      <div className="p-5 rounded-xl bg-card border border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Quality review
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switch */}
            <div className="flex items-center p-1 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="px-3 py-1 text-xs font-semibold text-slate-800">
                ZMCC lab
              </span>
            </div>

            <button
              onClick={viewMode === 'ZMCC_LAB' ? fetchLabSessions : onRetry}
              disabled={labLoading || isLoading}
              className="flex min-h-11 items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-subtle border border-border/80 text-xs font-semibold text-foreground hover:bg-muted/60 transition-all disabled:opacity-50"
            >
              <span>{labLoading || isLoading ? 'Syncing…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {reviewSuccessMsg && (
          <div className="bg-card border-border p-3 rounded-lg border text-emerald-800 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{reviewSuccessMsg}</span>
            </div>
            <button onClick={() => setReviewSuccessMsg(null)} aria-label="Dismiss" className="text-emerald-900 min-h-11 min-w-11">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Mode-Specific KPIs */}
        {viewMode === 'ZMCC_LAB' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 tabular-nums">
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-slate-500 block uppercase font-semibold">Total Lab Sessions</span>
              <span className="text-lg font-semibold text-slate-900">
                {labLoading ? '—' : labSessions.length}
              </span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-emerald-700 block uppercase font-semibold">Accepted Milk</span>
              <span className="text-lg font-semibold text-emerald-800">
                {labLoading ? '—' : labSessions.filter((s) => s.decision === 'ACCEPTED').length}
              </span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-rose-700 block uppercase font-semibold">Rejected Milk</span>
              <span className="text-lg font-semibold text-rose-800">
                {labLoading ? '—' : labSessions.filter((s) => s.decision === 'REJECTED').length}
              </span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-amber-700 block uppercase font-semibold">Pending Manager Review</span>
              <span className="text-lg font-semibold text-amber-800">
                {labLoading
                  ? '—'
                  : labSessions.filter(
                      (s) =>
                        s.manager_review_status === 'PENDING' ||
                        (s.decision === 'REJECTED' &&
                          s.manager_review_status !== 'REVIEWED_EXITED' &&
                          s.manager_review_status !== 'APPROVED')
                    ).length}
              </span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-slate-700 block uppercase font-semibold">Reviewed Exited</span>
              <span className="text-lg font-semibold text-slate-800">
                {labLoading ? '—' : labSessions.filter((s) => s.manager_review_status === 'REVIEWED_EXITED').length}
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 tabular-nums">
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-slate-500 block uppercase font-semibold">Total Portions</span>
              <span className="text-lg font-semibold text-slate-900">{plantSummary.totalPortions}</span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-emerald-700 block uppercase font-semibold">Accepted</span>
              <span className="text-lg font-semibold text-emerald-800">{plantSummary.acceptedCount}</span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-rose-700 block uppercase font-semibold">Rejected</span>
              <span className="text-lg font-semibold text-rose-800">{plantSummary.rejectedCount}</span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-amber-700 block uppercase font-semibold">Hold</span>
              <span className="text-lg font-semibold text-amber-800">{plantSummary.holdCount}</span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-slate-600 block uppercase font-semibold">Pending</span>
              <span className="text-lg font-semibold text-slate-800">{plantSummary.pendingCount}</span>
            </div>
            <div className="bg-card border-border p-3 rounded-lg border">
              <span className="text-xs font-sans text-amber-700 block uppercase font-semibold">Quality Diff</span>
              <span className="text-lg font-semibold text-amber-800">{plantSummary.qualityDiffCount}</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Filters & Controls */}
      <div className="p-4 rounded-xl bg-card border border-border/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full min-h-11 pl-9 pr-3 py-1.5 text-xs font-semibold rounded-lg bg-subtle border border-border/80 text-foreground focus:ring-2 focus:ring-primary outline-hidden"
            />
          </div>

          {onDateFilterChange && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600 text-[11px]">Date:</span>
              <input
                type="date"
                value={currentFromDate}
                onChange={(e) => onDateFilterChange(e.target.value || null, currentToDate || null)}
                className="px-2.5 py-1 text-xs tabular-nums font-semibold rounded-lg bg-subtle border border-border/80 text-foreground min-h-11"
              />
              {currentFromDate && (
                <button
                  onClick={() => onDateFilterChange(null, null)}
                  className="px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded min-h-11 min-w-11"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Filter Chips */}
        {viewMode === 'ZMCC_LAB' ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-border/60 text-xs">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 uppercase">Filter:</span>
            {([
              { id: 'ALL', label: 'All' },
              { id: 'PENDING_REVIEW', label: 'To review' },
              { id: 'REJECTED', label: 'Rejected' },
              { id: 'REVIEWED_EXITED', label: 'After exit' },
              { id: 'APPROVED', label: 'Approved' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setLabFilter(opt.id)}
                className={`min-h-11 px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  labFilter === opt.id
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-border/60 text-xs">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 uppercase">Filter:</span>
            {PLANT_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setPlantFilterState(opt.id)}
                className={`min-h-11 px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  plantFilterState === opt.id
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. Errors */}
      {(labError || error) && (
        <div className="bg-card border-border p-4 rounded-xl border text-rose-800 text-xs font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{labError || error}</span>
          </div>
          <button onClick={viewMode === 'ZMCC_LAB' ? fetchLabSessions : onRetry} className="underline hover:text-rose-950 min-h-11 min-w-11">
            Retry
          </button>
        </div>
      )}

      {/* 4. Loading */}
      {(labLoading || isLoading) && (
        <div className="p-8 text-center bg-card rounded-xl border border-border/80 text-xs text-slate-500 font-semibold flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>Loading quality records…</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!labLoading && !isLoading && !labError && !error && (viewMode === 'ZMCC_LAB' ? filteredLabSessions.length === 0 : filteredPlantItems.length === 0) && (
        <div className="p-12 text-center bg-card rounded-xl border border-border/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-800">No records found</h3>
          <p className="text-xs text-slate-500">No records</p>
        </div>
      )}

      {/* 6. ZMCC LAB SESSIONS VIEW */}
      {viewMode === 'ZMCC_LAB' && !labLoading && filteredLabSessions.length > 0 && (
        <motion.div key="lab" variants={fadeSlide} initial="initial" animate="animate">
          <ZMCCLabSessionList sessions={filteredLabSessions} onReview={openReviewModal} />
        </motion.div>
      )}

      {/* 7. PLANT QA PORTIONS VIEW (HISTORICAL) */}
      {viewMode === 'PLANT_QA' && !isLoading && filteredPlantItems.length > 0 && (
        <motion.div key="plant" variants={fadeSlide} initial="initial" animate="animate">
          <ZMCCPlantQAList items={filteredPlantItems} onInspectDetails={onInspectDetails} />
        </motion.div>
      )}

      {/* 8. Manager Review & Exception Drawer */}
      {reviewModalSession && (
        <ZMCCManagerReviewDrawer
          key={reviewModalSession.id}
          session={reviewModalSession}
          onClose={() => setReviewModalSession(null)}
          onSubmitted={(message) => {
            setReviewSuccessMsg(message);
            setReviewModalSession(null);
            fetchLabSessions();
          }}
        />
      )}
    </div>
  );
};
