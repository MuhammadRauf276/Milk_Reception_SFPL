'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  CheckCircle,
  XCircle,
  ShieldCheck,
  X,
} from 'lucide-react';

interface ZmccLabResultItem {
  id: string;
  test_id: string;
  test_code_snapshot: string;
  test_name_snapshot: string;
  result_type_snapshot: string;
  unit_snapshot?: string | null;
  numeric_value: number | null;
  text_value: string | null;
  evaluation_status: string | null;
  is_passed: boolean | null;
  applied_rule_id: string | null;
  applied_rule_version: number | null;
}

interface ZmccLabSessionItem {
  id: string;
  zmcc_id: string;
  arrival_type: 'MOT' | 'CONTRACTOR' | 'LOCAL_SUPPLIER';
  status: string;
  decision: string | null;
  system_quality_outcome: string | null;
  manager_review_status: string | null;
  manager_requested_decision: string | null;
  manager_reviewed_by_user_id: string | null;
  manager_reviewed_at: string | null;
  manager_review_reason: string | null;
  original_decision: string | null;
  corrected_decision: string | null;
  correction_reason: string | null;
  rejection_reason: string | null;
  remarks: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  gross_liters: number | null;
  completed_at: string | null;
  mot_arrival?: {
    id: string;
    zmcc_token: string;
    route_milk_token?: string | null;
    exit_timestamp?: string | null;
    journey?: {
      route?: { name: string; route_code?: string } | null;
      mot_vehicle?: { vehicle_number: string } | null;
    } | null;
  } | null;
  local_supplier_arrival?: {
    id: string;
    zmcc_token: string;
    rmr_number: string;
    vehicle_number: string;
    exit_timestamp?: string | null;
    local_supplier?: { name: string } | null;
  } | null;
  contractor_arrival?: {
    id: string;
    zmcc_token: string;
    vehicle_number: string;
    contractor_source?: { name: string } | null;
  } | null;
  tank_receipt?: {
    id: string;
    gross_liters: number;
    tank?: { tank_code: string; name: string } | null;
  } | null;
  results?: ZmccLabResultItem[];
}

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
  { id: 'ALL', label: 'All Portions' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'HOLD', label: 'Hold' },
  { id: 'ACCEPTED', label: 'Accepted' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'HAS_QUALITY_DIFF', label: 'Quality Differences' },
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
  const [labSessions, setLabSessions] = useState<ZmccLabSessionItem[]>([]);
  const [labLoading, setLabLoading] = useState<boolean>(false);
  const [labError, setLabError] = useState<string | null>(null);
  const [labFilter, setLabFilter] = useState<'ALL' | 'PENDING_REVIEW' | 'REJECTED' | 'REVIEWED_EXITED' | 'APPROVED'>('ALL');

  // Modal Review State
  const [reviewModalSession, setReviewModalSession] = useState<ZmccLabSessionItem | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [reviewReason, setReviewReason] = useState<string>('');
  const [reviewSubmitting, setReviewSubmitting] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState<string | null>(null);

  // Fetch ZMCC Lab History
  const fetchLabSessions = useCallback(async () => {
    setLabLoading(true);
    setLabError(null);
    try {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      if (currentFromDate) params.set('date', currentFromDate);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/zmcc/lab/history?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setLabSessions(data.items || []);
    } catch (err: any) {
      setLabError(err.message || 'Failed to fetch ZMCC lab sessions.');
    } finally {
      setLabLoading(false);
    }
  }, [currentFromDate, searchQuery]);

  useEffect(() => {
    if (viewMode === 'ZMCC_LAB') {
      fetchLabSessions();
    }
  }, [viewMode, fetchLabSessions]);

  // Derived Plant portion quality items
  const plantItems = useMemo(() => deriveQualityRejectionItems(logs), [logs]);
  const plantSummary = useMemo(() => deriveQualityRejectionSummary(plantItems), [plantItems]);
  const filteredPlantItems = useMemo(
    () => filterQualityRejectionItems(plantItems, searchQuery, plantFilterState),
    [plantItems, searchQuery, plantFilterState]
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
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const motVeh = s.mot_arrival?.journey?.mot_vehicle?.vehicle_number?.toLowerCase() || '';
        const suppVeh = s.local_supplier_arrival?.vehicle_number?.toLowerCase() || '';
        const contVeh = s.contractor_arrival?.vehicle_number?.toLowerCase() || '';
        const motTok = s.mot_arrival?.zmcc_token?.toLowerCase() || '';
        const suppTok = s.local_supplier_arrival?.zmcc_token?.toLowerCase() || '';
        const contTok = s.contractor_arrival?.zmcc_token?.toLowerCase() || '';
        const rmr = s.local_supplier_arrival?.rmr_number?.toLowerCase() || '';
        const suppName = s.local_supplier_arrival?.local_supplier?.name?.toLowerCase() || '';

        const match =
          motVeh.includes(q) ||
          suppVeh.includes(q) ||
          contVeh.includes(q) ||
          motTok.includes(q) ||
          suppTok.includes(q) ||
          contTok.includes(q) ||
          rmr.includes(q) ||
          suppName.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [labSessions, labFilter, searchQuery]);

  // Handle Review Submission
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModalSession) return;

    if (!reviewReason.trim() || reviewReason.trim().length < 3) {
      setReviewError('Substantive review reason is required (minimum 3 characters).');
      return;
    }

    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/sessions/${reviewModalSession.id}/correction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: reviewDecision,
          reason: reviewReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const isReviewExited = data.manager_review_status === 'REVIEWED_EXITED';
      setReviewSuccessMsg(
        isReviewExited
          ? `Review recorded for session #${reviewModalSession.id} (vehicle already exited; review-only).`
          : `Decision ${reviewDecision} recorded successfully for session #${reviewModalSession.id}.`
      );

      setReviewModalSession(null);
      setReviewReason('');
      fetchLabSessions();
    } catch (err: any) {
      setReviewError(err.message || 'Failed to submit manager decision.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const openReviewModal = (session: ZmccLabSessionItem) => {
    setReviewModalSession(session);
    setReviewDecision(session.decision === 'REJECTED' ? 'ACCEPTED' : 'REJECTED');
    setReviewReason('');
    setReviewError(null);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Mode Switch */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#6B21A8]/10 text-[#6B21A8]">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#111311]">
                Quality Analysis & Rejections Governance: {assignedSourceName}
              </h2>
              <p className="text-xs text-[#475569]">
                ZMCC intake quality evaluation, SOP rules, and manager review of rejected and pending milk arrivals.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switch */}
            <div className="flex items-center p-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('ZMCC_LAB')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  viewMode === 'ZMCC_LAB'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ZMCC Lab & Intake Review
              </button>
              <button
                type="button"
                onClick={() => setViewMode('PLANT_QA')}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  viewMode === 'PLANT_QA'
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Plant QA Portions (Historical)
              </button>
            </div>

            <button
              onClick={viewMode === 'ZMCC_LAB' ? fetchLabSessions : onRetry}
              disabled={labLoading || isLoading}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#1E3A8A] ${labLoading || isLoading ? 'animate-spin' : ''}`} />
              <span>{labLoading || isLoading ? 'Syncing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {reviewSuccessMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{reviewSuccessMsg}</span>
            </div>
            <button onClick={() => setReviewSuccessMsg(null)} className="text-emerald-900 font-black">
              ×
            </button>
          </div>
        )}

        {/* Mode-Specific KPIs */}
        {viewMode === 'ZMCC_LAB' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 font-mono">
            <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
              <span className="text-[10px] font-sans text-slate-500 block uppercase font-bold">Total Lab Sessions</span>
              <span className="text-lg font-black text-slate-900">
                {labLoading ? '—' : labSessions.length}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
              <span className="text-[10px] font-sans text-emerald-700 block uppercase font-bold">Accepted Milk</span>
              <span className="text-lg font-black text-emerald-800">
                {labLoading ? '—' : labSessions.filter((s) => s.decision === 'ACCEPTED').length}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA]">
              <span className="text-[10px] font-sans text-red-700 block uppercase font-bold">Rejected Milk</span>
              <span className="text-lg font-black text-red-800">
                {labLoading ? '—' : labSessions.filter((s) => s.decision === 'REJECTED').length}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
              <span className="text-[10px] font-sans text-amber-700 block uppercase font-bold">Pending Manager Review</span>
              <span className="text-lg font-black text-amber-800">
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
            <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF]">
              <span className="text-[10px] font-sans text-purple-700 block uppercase font-bold">Reviewed Exited</span>
              <span className="text-lg font-black text-purple-800">
                {labLoading ? '—' : labSessions.filter((s) => s.manager_review_status === 'REVIEWED_EXITED').length}
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
            <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
              <span className="text-[10px] font-sans text-slate-500 block uppercase font-bold">Total Portions</span>
              <span className="text-lg font-black text-slate-900">{plantSummary.totalPortions}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
              <span className="text-[10px] font-sans text-emerald-700 block uppercase font-bold">Accepted</span>
              <span className="text-lg font-black text-emerald-800">{plantSummary.acceptedCount}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA]">
              <span className="text-[10px] font-sans text-red-700 block uppercase font-bold">Rejected</span>
              <span className="text-lg font-black text-red-800">{plantSummary.rejectedCount}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A]">
              <span className="text-[10px] font-sans text-amber-700 block uppercase font-bold">Hold</span>
              <span className="text-lg font-black text-amber-800">{plantSummary.holdCount}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#F1F5F9] border border-[#CBD5E1]">
              <span className="text-[10px] font-sans text-slate-600 block uppercase font-bold">Pending</span>
              <span className="text-lg font-black text-slate-800">{plantSummary.pendingCount}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF]">
              <span className="text-[10px] font-sans text-purple-700 block uppercase font-bold">Quality Diff</span>
              <span className="text-lg font-black text-purple-800">{plantSummary.qualityDiffCount}</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Filters & Controls */}
      <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicle #, token #, supplier..."
              className="w-full pl-9 pr-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
            />
          </div>

          {onDateFilterChange && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-600 text-[11px]">Date:</span>
              <input
                type="date"
                value={currentFromDate}
                onChange={(e) => onDateFilterChange(e.target.value || null, currentToDate || null)}
                className="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]"
              />
              {currentFromDate && (
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

        {/* Filter Chips */}
        {viewMode === 'ZMCC_LAB' ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-[#EAE4D5]/60 text-xs">
            <span className="text-[11px] font-bold text-slate-500 mr-1 uppercase">Filter:</span>
            {[
              { id: 'ALL', label: 'All ZMCC Sessions' },
              { id: 'PENDING_REVIEW', label: 'Needs Manager Review' },
              { id: 'REJECTED', label: 'Rejected Intake' },
              { id: 'REVIEWED_EXITED', label: 'Reviewed After Exit' },
              { id: 'APPROVED', label: 'Exceptions Approved' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setLabFilter(opt.id as any)}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap transition-all ${
                  labFilter === opt.id
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-slate-600 hover:bg-slate-200/70 border border-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-[#EAE4D5]/60 text-xs">
            <span className="text-[11px] font-bold text-slate-500 mr-1 uppercase">Filter:</span>
            {PLANT_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setPlantFilterState(opt.id)}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap transition-all ${
                  plantFilterState === opt.id
                    ? 'bg-[#1E3A8A] text-white shadow-xs'
                    : 'bg-[#F8FAFC] text-slate-600 hover:bg-slate-200/70 border border-slate-200'
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
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{labError || error}</span>
          </div>
          <button onClick={viewMode === 'ZMCC_LAB' ? fetchLabSessions : onRetry} className="underline hover:text-red-950">
            Retry
          </button>
        </div>
      )}

      {/* 4. Loading */}
      {(labLoading || isLoading) && (
        <div className="p-8 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 text-xs text-slate-500 font-bold flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#1E3A8A]" />
          <span>Loading quality records...</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!labLoading && !isLoading && !labError && !error && (viewMode === 'ZMCC_LAB' ? filteredLabSessions.length === 0 : filteredPlantItems.length === 0) && (
        <div className="p-12 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-extrabold text-slate-800">No records found</h3>
          <p className="text-xs text-slate-500">No records found matching your selected criteria.</p>
        </div>
      )}

      {/* 6. ZMCC LAB SESSIONS VIEW */}
      {viewMode === 'ZMCC_LAB' && !labLoading && filteredLabSessions.length > 0 && (
        <div className="space-y-4">
          {filteredLabSessions.map((session) => {
            const isRejected = session.decision === 'REJECTED';
            const isAccepted = session.decision === 'ACCEPTED';
            const hasExited = !!(session.mot_arrival?.exit_timestamp || session.local_supplier_arrival?.exit_timestamp);
            const exitTimestamp = session.mot_arrival?.exit_timestamp || session.local_supplier_arrival?.exit_timestamp;
            const vehicleNumber =
              session.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
              session.local_supplier_arrival?.vehicle_number ||
              session.contractor_arrival?.vehicle_number ||
              '—';
            const tokenNumber =
              session.mot_arrival?.zmcc_token ||
              session.local_supplier_arrival?.zmcc_token ||
              session.contractor_arrival?.zmcc_token ||
              '—';
            const arrivalSource =
              session.arrival_type === 'MOT'
                ? `Route: ${session.mot_arrival?.journey?.route?.name || 'MOT'}`
                : session.arrival_type === 'LOCAL_SUPPLIER'
                ? `Supplier: ${session.local_supplier_arrival?.local_supplier?.name || 'Local Supplier'}`
                : `Contractor: ${session.contractor_arrival?.contractor_source?.name || 'Contractor'}`;

            const canReview =
              session.status === 'COMPLETED' &&
              (session.decision === 'REJECTED' ||
                session.manager_review_status === 'PENDING' ||
                session.manager_review_status === 'REVIEWED_EXITED');

            return (
              <div
                key={session.id}
                className={`p-4 rounded-xl bg-[#FFFFFF] border shadow-xs space-y-3 transition-all ${
                  isRejected
                    ? 'border-red-300 bg-red-50/20'
                    : session.manager_review_status === 'APPROVED'
                    ? 'border-emerald-300 bg-emerald-50/20'
                    : 'border-[#EAE4D5]/80 hover:border-[#1E3A8A]/40'
                }`}
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#EAE4D5]/60">
                  <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                    <span className="text-base font-black font-mono text-[#111311] tracking-tight">
                      {vehicleNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white">
                      {session.arrival_type}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      Token: {tokenNumber}
                    </span>
                    <span className="text-xs font-medium text-slate-600">
                      {arrivalSource}
                    </span>
                    {session.gross_liters != null && (
                      <span className="text-xs font-mono font-bold text-slate-800">
                        {session.gross_liters.toLocaleString()} L
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {canReview && (
                      <button
                        type="button"
                        onClick={() => openReviewModal(session)}
                        className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-[#1E3A8A] text-white text-xs font-bold hover:bg-[#1E3A8A]/90 shadow-xs transition-all"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>
                          {session.manager_review_status === 'REVIEWED_EXITED'
                            ? 'Re-Review Exited'
                            : session.decision === 'REJECTED'
                            ? 'Review Rejection'
                            : 'Review Exception'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Status Badges Row */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {/* System Evaluation Outcome */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      session.system_quality_outcome === 'IN_SPEC'
                        ? 'bg-emerald-100 text-emerald-800'
                        : session.system_quality_outcome === 'OUT_OF_SPEC'
                        ? 'bg-red-100 text-red-800'
                        : session.system_quality_outcome === 'RULE_CONFIGURATION_ERROR'
                        ? 'bg-red-200 text-red-900 border border-red-400'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    System: {session.system_quality_outcome || 'EVALUATED'}
                  </span>

                  {/* Decision */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      isAccepted
                        ? 'bg-emerald-100 text-emerald-800'
                        : isRejected
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    Decision: {session.decision}
                  </span>

                  {/* Manager Review Status */}
                  {session.manager_review_status && session.manager_review_status !== 'NONE' && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        session.manager_review_status === 'APPROVED'
                          ? 'bg-emerald-200 text-emerald-900'
                          : session.manager_review_status === 'REVIEWED_EXITED'
                          ? 'bg-purple-100 text-purple-900 border border-purple-300'
                          : session.manager_review_status === 'REJECTED'
                          ? 'bg-red-200 text-red-900'
                          : 'bg-amber-200 text-amber-900'
                      }`}
                    >
                      Manager: {session.manager_review_status}
                    </span>
                  )}

                  {/* Physical Exit State */}
                  {hasExited ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      Vehicle Exited: {formatOperationalDatetime(exitTimestamp!)}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                      Vehicle On-Site
                    </span>
                  )}

                  {/* Tank Receipt State */}
                  {session.tank_receipt ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      In Tank: {session.tank_receipt.tank?.tank_code || 'Received'} ({session.tank_receipt.gross_liters} L)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                      No Tank Receipt
                    </span>
                  )}
                </div>

                {/* Rejection / Review Reasons */}
                {session.rejection_reason && (
                  <div className="p-2.5 rounded-lg text-xs font-semibold flex items-start gap-2 bg-red-100/70 border border-red-200 text-red-900">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-700" />
                    <div>
                      <span className="font-extrabold uppercase text-[10px] block">Rejection Reason:</span>
                      <span>{session.rejection_reason}</span>
                    </div>
                  </div>
                )}

                {session.manager_review_reason && (
                  <div className="p-2.5 rounded-lg text-xs font-semibold flex items-start gap-2 bg-purple-50 border border-purple-200 text-purple-900">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-purple-700" />
                    <div>
                      <span className="font-extrabold uppercase text-[10px] block">
                        Manager Review Justification ({session.manager_review_status}):
                      </span>
                      <span>{session.manager_review_reason}</span>
                    </div>
                  </div>
                )}

                {/* Observed Results & Rule Version Table */}
                {session.results && session.results.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-[#EAE4D5]/80">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[#F8FAFC] text-[10px] font-sans font-black uppercase tracking-wider text-slate-600 border-b border-[#EAE4D5]/80">
                        <tr>
                          <th className="py-1.5 px-3">Test</th>
                          <th className="py-1.5 px-3">Observed Value</th>
                          <th className="py-1.5 px-3">Evaluation Status</th>
                          <th className="py-1.5 px-3 font-sans">Applied SOP Rule</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE4D5]/40 text-xs">
                        {session.results.map((r) => {
                          const valStr =
                            r.numeric_value !== null
                              ? `${r.numeric_value}${r.unit_snapshot ? ' ' + r.unit_snapshot : ''}`
                              : r.text_value || '—';
                          const isPass = r.is_passed === true;
                          const isFail = r.is_passed === false;

                          return (
                            <tr key={r.id} className="hover:bg-[#FDFBF9] transition-colors">
                              <td className="py-1.5 px-3 font-sans font-extrabold text-slate-800">
                                {r.test_name_snapshot} ({r.test_code_snapshot})
                              </td>
                              <td className="py-1.5 px-3 font-bold text-slate-900">{valStr}</td>
                              <td className="py-1.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                    isPass
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : isFail
                                      ? 'bg-red-100 text-red-800'
                                      : r.evaluation_status === 'WARNING'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {r.evaluation_status}
                                </span>
                              </td>
                              <td className="py-1.5 px-3 font-sans text-slate-600 text-[11px]">
                                {r.applied_rule_version ? `Rule v${r.applied_rule_version}` : 'Default SOP'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 7. PLANT QA PORTIONS VIEW (HISTORICAL) */}
      {viewMode === 'PLANT_QA' && !isLoading && filteredPlantItems.length > 0 && (
        <div className="space-y-3">
          {filteredPlantItems.map((item) => {
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
                      Business Date: {item.businessDate || 'Pending plant completion'}
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

                {isRejected && (
                  <div className="p-2.5 rounded-lg text-xs font-semibold flex items-start gap-2 bg-red-100/70 border border-red-200 text-red-900">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-700" />
                    <div>
                      <span className="font-extrabold uppercase text-[10px] block">
                        Official Plant Rejection Reason:
                      </span>
                      <span>{item.rejectionReasons || '—'}</span>
                    </div>
                  </div>
                )}

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
                        <td className="py-1.5 px-3 text-slate-700">{item.dispatchLr != null ? item.dispatchLr : '—'}</td>
                        <td className="py-1.5 px-3 font-bold text-slate-900">{item.plantLr != null ? item.plantLr : '—'}</td>
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
                        <td className="py-1.5 px-3 font-sans font-extrabold text-slate-800">Fat Percentage (%)</td>
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

      {/* 8. Manager Review & Exception Modal */}
      {reviewModalSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-[#1E3A8A]" />
                <h3 className="text-sm font-black text-slate-900">
                  Manager Quality Review: Session #{reviewModalSession.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewModalSession(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitReview} className="p-5 space-y-4">
              {reviewError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs font-bold rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{reviewError}</span>
                </div>
              )}

              {/* Physical Reality Warning */}
              {(() => {
                const hasExited = !!(
                  reviewModalSession.mot_arrival?.exit_timestamp ||
                  reviewModalSession.local_supplier_arrival?.exit_timestamp
                );
                const exitTime =
                  reviewModalSession.mot_arrival?.exit_timestamp ||
                  reviewModalSession.local_supplier_arrival?.exit_timestamp;

                if (hasExited) {
                  return (
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 font-extrabold text-amber-800">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>Vehicle Physically Exited</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        The vehicle departed on <strong>{formatOperationalDatetime(exitTime!)}</strong>. Approving this
                        record will register an official audit review (
                        <code className="font-bold text-amber-900 bg-amber-100 px-1 py-0.5 rounded">
                          REVIEWED_EXITED
                        </code>
                        ) and will strictly NOT inject retroactive tank stock.
                      </p>
                    </div>
                  );
                } else {
                  return (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 font-extrabold text-emerald-800">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span>Vehicle On-Site</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        The vehicle is currently on-site. Approving will accept the milk, create the canonical tank
                        receipt, and credit active tank stock.
                      </p>
                    </div>
                  );
                }
              })()}

              {/* Session Meta */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 text-[10px] block font-sans uppercase font-bold">Arrival Type</span>
                  <span className="font-extrabold text-slate-900">{reviewModalSession.arrival_type}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block font-sans uppercase font-bold">Original Decision</span>
                  <span className="font-extrabold text-slate-900">{reviewModalSession.decision}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block font-sans uppercase font-bold">System Outcome</span>
                  <span className="font-extrabold text-slate-900">
                    {reviewModalSession.system_quality_outcome || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block font-sans uppercase font-bold">Quantity</span>
                  <span className="font-extrabold text-slate-900">
                    {reviewModalSession.gross_liters != null
                      ? `${reviewModalSession.gross_liters.toLocaleString()} L`
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Decision Radio Choice */}
              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-slate-800 uppercase block">Manager Decision</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewDecision('ACCEPTED')}
                    className={`p-3 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                      reviewDecision === 'ACCEPTED'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>Approve (ACCEPTED)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReviewDecision('REJECTED')}
                    className={`p-3 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
                      reviewDecision === 'REJECTED'
                        ? 'border-red-500 bg-red-50 text-red-800 ring-2 ring-red-500/20'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span>Confirm (REJECTED)</span>
                  </button>
                </div>
              </div>

              {/* Substantive Reason Textarea */}
              <div className="space-y-1.5">
                <label className="text-xs font-extrabold text-slate-800 uppercase block">
                  Substantive Justification / Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  placeholder="Enter substantive managerial justification for this decision (minimum 3 characters)..."
                  rows={3}
                  required
                  className="w-full p-2.5 text-xs font-medium rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
                />
                <span className="text-[10px] text-slate-400 font-sans block">
                  Mandatory audit justification recorded in the official governance log.
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReviewModalSession(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewSubmitting || reviewReason.trim().length < 3}
                  className="px-4 py-2 text-xs font-bold bg-[#1E3A8A] text-white rounded-xl hover:bg-[#1E3A8A]/90 transition-all disabled:opacity-50 shadow-xs flex items-center gap-1.5"
                >
                  {reviewSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{reviewSubmitting ? 'Recording...' : 'Submit Decision'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

