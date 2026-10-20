'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldAlert,
  Search,
  RefreshCw,
  Eye,
  FileText,
  Camera,
  MapPin,
  Maximize2,
  X,
  ChevronRight,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import type { User } from '@/backend/core/types';
import type {
  OperationalStage,
} from '@/backend/services/escalation/approvalMatrix';
import type {
  UnifiedApprovalItem,
  InboxCounts,
} from '@/backend/services/approvals/approvalInboxService';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';

export interface ApprovalInboxProps {
  currentUser: User | null;
  initialStage?: 'ALL' | OperationalStage;
  fixedStage?: OperationalStage;
  sourceType?: 'ZMCC' | 'CONTRACTOR' | 'PLANT';
  onCountChange?: (counts: InboxCounts) => void;
  className?: string;
}

const STAGE_LABELS: Record<OperationalStage, { label: string; badge: string; color: string }> = {
  STAGE_1: { label: 'Stage 1 · Area (MOT)', badge: 'S1 Area', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  STAGE_2: { label: 'Stage 2 · ZMCC Reception', badge: 'S2 ZMCC', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  STAGE_3: { label: 'Stage 3 · Dispatch', badge: 'S3 Dispatch', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  STAGE_4: { label: 'Stage 4 · Plant QA', badge: 'S4 Plant', color: 'bg-amber-100 text-amber-800 border-amber-200' },
};

function formatWaitingLabel(waitingMinutes: number): string {
  if (waitingMinutes < 1) return '<1m';
  if (waitingMinutes < 60) return `${waitingMinutes}m`;
  const hours = Math.floor(waitingMinutes / 60);
  const mins = waitingMinutes % 60;
  return `${hours}h ${mins}m`;
}

export function ApprovalInbox({
  currentUser,
  initialStage = 'ALL',
  fixedStage,
  sourceType,
  onCountChange,
  className,
}: ApprovalInboxProps) {
  const [stageFilter, setStageFilter] = useState<'ALL' | OperationalStage>(fixedStage || initialStage);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'DECIDED'>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<UnifiedApprovalItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({
    totalPending: 0,
    stage1: 0,
    stage2: 0,
    stage3: 0,
    stage4: 0,
    warningCount: 0,
    breachedCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected item for desktop master-detail & mobile modal
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mobileInspectOpen, setMobileInspectOpen] = useState(false);

  // Decision Modal state
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [verdict, setVerdict] = useState<'OKAY' | 'NO' | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Photo viewer modal
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const fetchInbox = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('status', statusFilter);
        if (fixedStage) {
          params.set('stage', fixedStage);
        } else if (stageFilter !== 'ALL') {
          params.set('stage', stageFilter);
        }
        if (sourceType) {
          params.set('sourceType', sourceType);
        }
        params.set('limit', '100');

        const res = await fetch(`/api/approvals/inbox?${params.toString()}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to fetch approval queue.');
        }

        const data = await res.json();
        const fetchedItems: UnifiedApprovalItem[] = data.items || [];
        const fetchedCounts: InboxCounts = data.counts || {
          totalPending: 0,
          stage1: 0,
          stage2: 0,
          stage3: 0,
          stage4: 0,
          warningCount: 0,
          breachedCount: 0,
        };

        setItems(fetchedItems);
        setCounts(fetchedCounts);
        onCountChange?.(fetchedCounts);

        // Keep or select first item in desktop view
        if (fetchedItems.length > 0) {
          setSelectedItemId((prev) => (prev && fetchedItems.some((i) => i.id === prev) ? prev : fetchedItems[0].id));
        } else {
          setSelectedItemId(null);
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err) || 'Error loading approval items.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, stageFilter, fixedStage, sourceType, onCountChange]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInbox();
  }, [fetchInbox]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.referenceNumber.toLowerCase().includes(q) ||
        item.submittedBy.name.toLowerCase().includes(q) ||
        (item.sourceName && item.sourceName.toLowerCase().includes(q)) ||
        item.details.entityTitle.toLowerCase().includes(q) ||
        (item.details.vehicleNumber && item.details.vehicleNumber.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

  const activeItem = useMemo(() => {
    return items.find((i) => i.id === selectedItemId) || filteredItems[0] || null;
  }, [items, selectedItemId, filteredItems]);

  const handleOpenDecision = (v: 'OKAY' | 'NO') => {
    setVerdict(v);
    setDecisionRemarks('');
    setDecisionError(null);
    setDecisionModalOpen(true);
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !verdict) return;
    setDecisionError(null);

    const isSelfApproval = Boolean(
      currentUser?.id &&
        activeItem.submittedBy.id &&
        String(currentUser.id) === String(activeItem.submittedBy.id)
    );
    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

    // Validation
    if (isSelfApproval && isSuperAdmin && decisionRemarks.trim().length < 20) {
      setDecisionError('Super Admin self-approval requires substantive justification of at least 20 characters.');
      return;
    }
    if (verdict === 'NO' && decisionRemarks.trim().length < 5) {
      setDecisionError('Please write a substantive rejection reason (at least 5 characters).');
      return;
    }

    setIsSubmittingDecision(true);
    try {
      const res = await fetch(`/api/approvals/${activeItem.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalType: activeItem.approvalType,
          verdict,
          remarks: decisionRemarks.trim(),
          version: activeItem.version,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error('This item was already updated or decided by another supervisor. Reloading queue…');
        }
        throw new Error(errData.error || 'Failed to submit approval decision.');
      }

      setDecisionModalOpen(false);
      setMobileInspectOpen(false);
      await fetchInbox(true);
    } catch (err: unknown) {
      setDecisionError(getErrorMessage(err) || 'Error submitting decision.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  return (
    <div className={cn('flex flex-col w-full h-full min-h-[620px] bg-slate-50/50 rounded-2xl border border-border shadow-xs overflow-hidden', className)}>
      {/* -----------------------------------------------------------------------------------------
          Top Master Control Bar: Counts, Filters, Refresh
      ----------------------------------------------------------------------------------------- */}
      <header className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 bg-white border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-base sm:text-lg font-bold text-foreground">
              {fixedStage ? STAGE_LABELS[fixedStage]?.label : 'Unified Approvals & Exceptions'}
            </h1>
          </div>

          {/* Quick Metrics Badges */}
          <div className="hidden sm:flex items-center gap-1.5 ml-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
              {counts.totalPending} Pending
            </span>
            {counts.breachedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300 animate-pulse">
                ⚠ {counts.breachedCount} Breached
              </span>
            )}
            {counts.warningCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                ⏱ {counts.warningCount} Warning
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 ml-auto">
          {/* Status Toggle */}
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-slate-100 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setStatusFilter('PENDING')}
              className={cn(
                'px-3 py-1.5 rounded-md transition',
                statusFilter === 'PENDING'
                  ? 'bg-white text-foreground shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-foreground'
              )}
            >
              Pending ({counts.totalPending})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('DECIDED')}
              className={cn(
                'px-3 py-1.5 rounded-md transition',
                statusFilter === 'DECIDED'
                  ? 'bg-white text-foreground shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-foreground'
              )}
            >
              Decided
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchInbox(true)}
            disabled={loading || refreshing}
            className="p-2 text-slate-600 hover:text-primary hover:bg-slate-100 rounded-lg border border-border transition disabled:opacity-50"
            title="Refresh Queue"
            aria-label="Refresh Queue"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin text-primary')} />
          </button>
        </div>
      </header>

      {/* Stage Filter Pills (when not fixed to single stage) */}
      {!fixedStage && (
        <nav aria-label="Operational Stages" className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 border-b border-border overflow-x-auto text-xs font-semibold">
          <button
            type="button"
            onClick={() => setStageFilter('ALL')}
            className={cn(
              'px-3 py-1 rounded-full border transition shrink-0',
              stageFilter === 'ALL'
                ? 'bg-primary text-white border-primary shadow-2xs font-bold'
                : 'bg-white text-slate-600 border-border hover:bg-slate-100'
            )}
          >
            All Stages ({counts.totalPending})
          </button>
          <button
            type="button"
            onClick={() => setStageFilter('STAGE_1')}
            className={cn(
              'px-3 py-1 rounded-full border transition shrink-0',
              stageFilter === 'STAGE_1'
                ? 'bg-blue-700 text-white border-blue-700 shadow-2xs font-bold'
                : 'bg-white text-slate-600 border-border hover:bg-slate-100'
            )}
          >
            S1 Area ({counts.stage1})
          </button>
          <button
            type="button"
            onClick={() => setStageFilter('STAGE_2')}
            className={cn(
              'px-3 py-1 rounded-full border transition shrink-0',
              stageFilter === 'STAGE_2'
                ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs font-bold'
                : 'bg-white text-slate-600 border-border hover:bg-slate-100'
            )}
          >
            S2 ZMCC Reception ({counts.stage2})
          </button>
          <button
            type="button"
            onClick={() => setStageFilter('STAGE_3')}
            className={cn(
              'px-3 py-1 rounded-full border transition shrink-0',
              stageFilter === 'STAGE_3'
                ? 'bg-violet-700 text-white border-violet-700 shadow-2xs font-bold'
                : 'bg-white text-slate-600 border-border hover:bg-slate-100'
            )}
          >
            S3 Dispatch ({counts.stage3})
          </button>
          <button
            type="button"
            onClick={() => setStageFilter('STAGE_4')}
            className={cn(
              'px-3 py-1 rounded-full border transition shrink-0',
              stageFilter === 'STAGE_4'
                ? 'bg-amber-700 text-white border-amber-700 shadow-2xs font-bold'
                : 'bg-white text-slate-600 border-border hover:bg-slate-100'
            )}
          >
            S4 Plant QA ({counts.stage4})
          </button>
        </nav>
      )}

      {/* -----------------------------------------------------------------------------------------
          Main Content: Master-Detail Split on Desktop (>= 1024px) / List or Detail on Mobile
      ----------------------------------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* LEFT PANE: Scannable Queue List */}
        <section
          aria-label="Approval queue list"
          className={cn(
            'flex flex-col border-r border-border bg-white',
            'w-full lg:w-[380px] xl:w-[430px] shrink-0',
            mobileInspectOpen ? 'hidden lg:flex' : 'flex'
          )}
        >
          {/* Quick Search */}
          <div className="p-2.5 border-b border-border bg-slate-50/50">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Search reference, shop, vehicle…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Queue Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {loading && !refreshing ? (
              <div className="p-8 flex flex-col items-center justify-center text-center space-y-3">
                <Spinner className="w-6 h-6 text-primary" />
                <p className="text-xs text-slate-500 font-medium">Loading approval items…</p>
              </div>
            ) : error ? (
              <div className="p-6 text-center space-y-2 text-red-600 text-xs">
                <AlertTriangle className="w-6 h-6 mx-auto text-red-500" />
                <p className="font-semibold">{error}</p>
                <button
                  type="button"
                  onClick={() => fetchInbox()}
                  className="mt-2 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-md font-semibold text-xs"
                >
                  Try Again
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Queue is Clear</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  {statusFilter === 'PENDING'
                    ? 'No pending approval requests require your review right now.'
                    : 'No decided items found matching your filters.'}
                </p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = item.id === selectedItemId;
                const stageMeta = STAGE_LABELS[item.stage];

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedItemId(item.id);
                      setMobileInspectOpen(true);
                    }}
                    className={cn(
                      'w-full text-left p-3 sm:p-3.5 transition flex flex-col gap-1.5 focus:outline-none relative group',
                      isSelected
                        ? 'bg-slate-100/90 border-l-4 border-l-primary'
                        : 'hover:bg-slate-50/80 border-l-4 border-l-transparent'
                    )}
                  >
                    {/* Row Header: Reference + Stage Badge + SLA Chip */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-xs sm:text-sm text-foreground truncate">
                          {item.referenceNumber}
                        </span>
                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0', stageMeta.color)}>
                          {stageMeta.badge}
                        </span>
                      </div>

                      {/* SLA Chip */}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold border shrink-0',
                          item.slaStatus === 'BREACHED'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : item.slaStatus === 'WARNING'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        )}
                      >
                        {item.slaStatus === 'BREACHED' ? (
                          <AlertTriangle className="w-3 h-3 text-red-600" />
                        ) : (
                          <Clock className="w-3 h-3 text-slate-500" />
                        )}
                        {formatWaitingLabel(item.waitingMinutes)}
                      </span>
                    </div>

                    {/* Submitter & Entity Title */}
                    <p className="text-xs text-slate-600 line-clamp-1">
                      {item.details.entityTitle}
                    </p>

                    {/* Submitter Attribution & Chips */}
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                      <span>By {item.submittedBy.name}</span>
                      <span>·</span>
                      <span className="font-medium text-slate-700">{getRoleLabel(item.submittedBy.role)}</span>
                      {item.submittedBy.isDelegated && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-violet-100 text-violet-800 border border-violet-200">
                          Delegated
                        </span>
                      )}
                    </div>

                    {/* Reason Chips */}
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      {item.reasonChips.slice(0, 3).map((chip, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"
                        >
                          {chip}
                        </span>
                      ))}
                      {!item.canDecide && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                          {item.disabledReason?.includes('You submitted') ? 'Self-Raised' : 'Audit Only'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* RIGHT PANE: Inspection & Active Action Panel (Desktop or Mobile Overlay) */}
        <section
          aria-label="Active approval inspection details"
          className={cn(
            'flex-1 flex flex-col bg-white overflow-y-auto',
            mobileInspectOpen ? 'flex fixed inset-0 z-40 lg:static' : 'hidden lg:flex'
          )}
        >
          {activeItem ? (
            <div className="flex-1 flex flex-col">
              {/* Mobile Back Header */}
              <div className="flex lg:hidden items-center justify-between p-3 border-b border-border bg-slate-100">
                <button
                  type="button"
                  onClick={() => setMobileInspectOpen(false)}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-primary"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>Back to Queue</span>
                </button>
                <span className="text-xs font-semibold text-slate-600">
                  {activeItem.referenceNumber}
                </span>
              </div>

              {/* Inspection Header */}
              <div className="p-4 sm:p-6 border-b border-border bg-white flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-bold border', STAGE_LABELS[activeItem.stage].color)}>
                      {STAGE_LABELS[activeItem.stage].label}
                    </span>
                    <h2 className="text-base sm:text-xl font-bold text-foreground">
                      {activeItem.referenceNumber}
                    </h2>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600">
                    {activeItem.details.entityTitle}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
                    <span>Source: <strong className="text-slate-700">{activeItem.sourceName || 'ZMCC Area'}</strong></span>
                    <span>·</span>
                    <span>Waiting: <strong className="text-slate-700">{formatWaitingLabel(activeItem.waitingMinutes)}</strong></span>
                    <span>·</span>
                    <span>Submitted by: <strong className="text-slate-700">{activeItem.submittedBy.name}</strong> ({getRoleLabel(activeItem.submittedBy.role)})</span>
                  </div>
                </div>

                {/* Status Badge using Color + Icon + Word */}
                <div className="shrink-0">
                  {activeItem.status === 'APPROVED' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-300 bg-green-50 text-green-800 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>✓ Approved</span>
                    </span>
                  ) : activeItem.status === 'REJECTED' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-300 bg-red-50 text-red-800 text-xs font-bold">
                      <XCircle className="w-4 h-4" />
                      <span>✗ Rejected</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold">
                      <AlertTriangle className="w-4 h-4" />
                      <span>⚠ Pending Decision</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Inspection Surface: Progressive Disclosure */}
              <div className="p-4 sm:p-6 space-y-6 flex-1">
                {/* 1. Immediate Actionable Summary (High Prominence) */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Exception Summary
                  </h3>

                  {/* Highlight Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Failed / Out of spec tests */}
                    {activeItem.details.testValues?.filter((t) => t.outcome === 'FAIL' || t.pass === false).length ? (
                      activeItem.details.testValues
                        ?.filter((t) => t.outcome === 'FAIL' || t.pass === false)
                        .map((t, idx) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-xl border border-rose-300 bg-rose-50/70 text-rose-950 flex flex-col justify-between"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs">{t.name} ({t.code})</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-700 text-white">
                                Out of Range
                              </span>
                            </div>
                            <div className="mt-2 flex items-baseline gap-2">
                              <span className="text-xl sm:text-2xl font-black text-rose-700">
                                {t.value !== null && t.value !== undefined ? String(t.value) : 'N/A'}
                              </span>
                              <span className="text-xs text-rose-800">
                                (Required: {t.min !== undefined && t.min !== null ? `Min ${t.min}` : ''} {t.max !== undefined && t.max !== null ? `Max ${t.max}` : ''})
                              </span>
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="p-3.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-950 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div>
                          <p className="text-xs font-bold">All Test Values In Range</p>
                          <p className="text-[11px] text-emerald-800">Physical chemistry metrics pass active policy bounds.</p>
                        </div>
                      </div>
                    )}

                    {/* Seal Verification Status (Stage 4) */}
                    {activeItem.details.sealNumber && (
                      <div
                        className={cn(
                          'p-3.5 rounded-xl border flex flex-col justify-between',
                          activeItem.details.sealMatch === false
                            ? 'border-rose-300 bg-rose-50 text-rose-950'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs">Security Seal Verification</span>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-extrabold text-white',
                              activeItem.details.sealMatch === false ? 'bg-rose-700' : 'bg-emerald-700'
                            )}
                          >
                            {activeItem.details.sealMatch === false ? 'Mismatch' : 'Verified'}
                          </span>
                        </div>
                        <div className="mt-2 text-xs">
                          <p>Dispatch Seal: <strong>{activeItem.details.sealNumber}</strong></p>
                          {activeItem.details.plantSealNumberEntered && (
                            <p>Entered at Plant: <strong>{activeItem.details.plantSealNumberEntered}</strong></p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Operator Initial Decision Card */}
                    <div className="p-3.5 rounded-xl border border-border bg-slate-50 flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-700">Operator Stated Verdict</span>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-[10px] font-extrabold',
                            activeItem.details.personDecision === 'REJECT'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          )}
                        >
                          {activeItem.details.personDecision === 'REJECT' ? 'Rejected by Operator' : 'Accepted by Operator'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600 italic">
                        &ldquo;{activeItem.details.personRemarks || 'No operator remarks recorded'}&rdquo;
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Captured Proof Photos (Live Camera Evidence) */}
                {activeItem.details.photos && activeItem.details.photos.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5" />
                      <span>Live Camera Evidence ({activeItem.details.photos.length})</span>
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {activeItem.details.photos.map((photo, pIdx) => (
                        <div
                          key={pIdx}
                          className="group relative rounded-xl border border-border bg-slate-100 overflow-hidden aspect-4/3 flex flex-col justify-end p-2 cursor-pointer shadow-2xs hover:shadow-xs transition"
                          onClick={() => photo.url && setPreviewPhotoUrl(photo.url)}
                        >
                          {photo.url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={photo.url}
                              alt="Captured evidence"
                              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                              <Camera className="w-8 h-8 opacity-40" />
                            </div>
                          )}
                          <div className="relative z-10 bg-slate-900/80 backdrop-blur-xs text-white p-1 rounded text-[10px] flex items-center justify-between">
                            <span className="truncate">{photo.testCode || photo.label || 'Test Proof'}</span>
                            <Maximize2 className="w-3 h-3 shrink-0 ml-1 opacity-70 group-hover:opacity-100" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Progressive Disclosure Container: Calculation, Policy & Audit Details */}
                <details className="group border border-border rounded-xl bg-slate-50 overflow-hidden text-xs">
                  <summary className="p-3.5 font-bold text-slate-700 flex items-center justify-between cursor-pointer select-none hover:bg-slate-100/70 transition">
                    <span className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span>View calculation, policy bounds & complete audit trail</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 transition group-open:rotate-90" />
                  </summary>

                  <div className="p-4 border-t border-border bg-white space-y-4">
                    {/* All Tests Table */}
                    {activeItem.details.testValues && activeItem.details.testValues.length > 0 && (
                      <div>
                        <h4 className="font-bold text-slate-700 mb-2">Complete Laboratory Results</h4>
                        <div className="border border-border rounded-lg overflow-hidden">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-border">
                              <tr>
                                <th className="p-2">Test Name</th>
                                <th className="p-2">Observed Value</th>
                                <th className="p-2">Rule Bounds</th>
                                <th className="p-2 text-right">Result</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {activeItem.details.testValues.map((t, tIdx) => (
                                <tr key={tIdx} className={t.outcome === 'FAIL' || t.pass === false ? 'bg-rose-50/50' : ''}>
                                  <td className="p-2 font-medium">{t.name} ({t.code})</td>
                                  <td className="p-2 font-bold">{t.value !== null && t.value !== undefined ? String(t.value) : '—'}</td>
                                  <td className="p-2 text-slate-500">
                                    {t.min !== undefined && t.min !== null ? `Min: ${t.min} ` : ''}
                                    {t.max !== undefined && t.max !== null ? `Max: ${t.max}` : ''}
                                    {!t.min && !t.max ? 'Monitoring' : ''}
                                  </td>
                                  <td className="p-2 text-right">
                                    <span
                                      className={cn(
                                        'px-2 py-0.5 rounded text-[10px] font-bold',
                                        t.outcome === 'FAIL' || t.pass === false
                                          ? 'bg-rose-100 text-rose-800'
                                          : 'bg-emerald-100 text-emerald-800'
                                      )}
                                    >
                                      {t.outcome === 'FAIL' || t.pass === false ? 'FAIL' : 'PASS'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Metadata & GPS Proof */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
                      <div className="p-3 bg-slate-50 rounded-lg border border-border space-y-1">
                        <p className="font-bold text-slate-800">Audit & Attribution</p>
                        <p>Submitter User ID: <code className="text-[11px] font-mono">{activeItem.submittedBy.id}</code></p>
                        <p>Real Role: <strong>{getRoleLabel(activeItem.submittedBy.role)}</strong></p>
                        {activeItem.submittedBy.performedAsRole && (
                          <p>Performed As Role: <strong>{getRoleLabel(activeItem.submittedBy.performedAsRole)}</strong></p>
                        )}
                        <p>Delegated Action: <strong>{activeItem.submittedBy.isDelegated ? 'Yes' : 'No'}</strong></p>
                      </div>

                      {activeItem.details.formulaAudit?.gpsCoordinates && (
                        <div className="p-3 bg-slate-50 rounded-lg border border-border space-y-1">
                          <p className="font-bold text-slate-800 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-primary" />
                            <span>GPS Geofence Capture</span>
                          </p>
                          <p>Latitude: <strong>{activeItem.details.formulaAudit.gpsCoordinates.latitude.toFixed(6)}</strong></p>
                          <p>Longitude: <strong>{activeItem.details.formulaAudit.gpsCoordinates.longitude.toFixed(6)}</strong></p>
                          {activeItem.details.formulaAudit.gpsCoordinates.accuracy && (
                            <p>Accuracy: ±{activeItem.details.formulaAudit.gpsCoordinates.accuracy}m</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </details>

                {/* 4. Self-Approval Guard Banner (Segregation of Duties) */}
                {!activeItem.canDecide && (
                  <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs">
                      <p className="font-bold text-sm">
                        Segregation of Duties Enforcement
                      </p>
                      <p>
                        {activeItem.disabledReason ||
                          'You do not have administrative authority to decide this item or submitted it yourself.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* 5. Decided Audit Stamp (if decided) */}
                {activeItem.decision && (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1 text-xs">
                    <p className="font-bold text-slate-800">
                      Decision Recorded by {activeItem.decision.decidedBy}
                    </p>
                    <p className="text-slate-600">
                      Verdict: <strong>{activeItem.decision.verdict === 'OKAY' ? 'Approved' : 'Rejected'}</strong> · Decided at {new Date(activeItem.decision.decidedAt).toLocaleString()}
                    </p>
                    {activeItem.decision.remarks && (
                      <p className="text-slate-700 italic mt-1">&ldquo;{activeItem.decision.remarks}&rdquo;</p>
                    )}
                  </div>
                )}
              </div>

              {/* -----------------------------------------------------------------------------------
                  Sticky Action Bar: Desktop (Compact 40px) & Mobile (Glove-Friendly 56px)
              ----------------------------------------------------------------------------------- */}
              {statusFilter === 'PENDING' && (
                <footer className="p-3 sm:p-4 border-t border-border bg-white sticky bottom-0 z-20 flex items-center justify-between gap-3 shadow-xs">
                  <div className="hidden sm:block text-xs text-slate-500">
                    {activeItem.canDecide
                      ? 'Select an action to record your official decision.'
                      : 'Actions disabled by Segregation of Duties.'}
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto ml-auto">
                    {/* [✗ NO / Reject] Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenDecision('NO')}
                      disabled={!activeItem.canDecide}
                      className={cn(
                        'flex-1 sm:flex-initial flex items-center justify-center gap-2 rounded-xl font-bold transition',
                        'min-h-[52px] sm:min-h-[40px] px-4 sm:px-5 text-sm sm:text-xs',
                        'border-2 border-rose-600 text-rose-700 hover:bg-rose-50 active:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed'
                      )}
                    >
                      <XCircle className="w-5 h-5 sm:w-4 h-4" />
                      <span>[✗ NO] Reject</span>
                    </button>

                    {/* [✓ OKAY / Approve] Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenDecision('OKAY')}
                      disabled={!activeItem.canDecide}
                      className={cn(
                        'flex-1 sm:flex-initial flex items-center justify-center gap-2 rounded-xl font-bold transition text-white',
                        'min-h-[52px] sm:min-h-[40px] px-5 sm:px-6 text-sm sm:text-xs',
                        'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed'
                      )}
                    >
                      <CheckCircle2 className="w-5 h-5 sm:w-4 h-4" />
                      <span>[✓ OKAY] Approve</span>
                    </button>
                  </div>
                </footer>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
              <Eye className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">Select an item from the queue to inspect details</p>
            </div>
          )}
        </section>
      </div>

      {/* -------------------------------------------------------------------------------------------
          Decision Modal
      ------------------------------------------------------------------------------------------- */}
      {decisionModalOpen && activeItem && (
        <Modal
          key="decision-modal"
          onClose={() => !isSubmittingDecision && setDecisionModalOpen(false)}
          title={verdict === 'OKAY' ? 'Confirm Approval' : 'Confirm Rejection'}
          className="max-w-md p-5 space-y-4"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              {verdict === 'OKAY' ? (
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <XCircle className="w-6 h-6" />
                </div>
              )}
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {verdict === 'OKAY' ? 'Approve Exception' : 'Reject & Return Exception'}
                </h3>
                <p className="text-xs text-slate-500">
                  Reference: <strong>{activeItem.referenceNumber}</strong>
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              {verdict === 'OKAY'
                ? 'Approving will authorize this exception and allow the batch/reception to continue in the pipeline.'
                : 'Rejecting will return or condemn this item. The field operator will be instructed accordingly.'}
            </p>

            {/* Super Admin Self-Approval Warning */}
            {currentUser?.id && activeItem.submittedBy.id === String(currentUser.id) && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-700" />
                  <span>Self-Approval Compliance Review</span>
                </p>
                <p>
                  As Super Admin self-approving your own submission, you must provide at least 20 characters of justification.
                  This event will be logged and dispatched to the Data Executive.
                </p>
              </div>
            )}

            {decisionError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                {decisionError}
              </div>
            )}

            <form onSubmit={handleConfirmDecision} className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Supervisor Remarks {verdict === 'NO' ? <span className="text-rose-600">* (Required)</span> : '(Optional)'}
                </label>
                <textarea
                  rows={3}
                  value={decisionRemarks}
                  onChange={(e) => setDecisionRemarks(e.target.value)}
                  placeholder={
                    verdict === 'OKAY'
                      ? 'Add any operational approval notes…'
                      : 'Specify reason for rejection or return instructions (minimum 5 letters)…'
                  }
                  className="w-full border border-border rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                  autoFocus
                />
                <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                  <span>{verdict === 'NO' ? 'Min 5 characters' : 'Optional notes'}</span>
                  <span>{decisionRemarks.length} chars</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setDecisionModalOpen(false)}
                  disabled={isSubmittingDecision}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDecision}
                  className={cn(
                    'px-5 py-2 text-xs font-bold rounded-lg text-white transition flex items-center gap-1.5',
                    verdict === 'OKAY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700',
                    isSubmittingDecision && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  {isSubmittingDecision ? (
                    <>
                      <Spinner className="w-3.5 h-3.5 text-white" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <span>Confirm {verdict === 'OKAY' ? 'Approval' : 'Rejection'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* -------------------------------------------------------------------------------------------
          Photo Lightbox Modal
      ------------------------------------------------------------------------------------------- */}
      {previewPhotoUrl && (
        <Modal
          key="photo-modal"
          onClose={() => setPreviewPhotoUrl(null)}
          title="Captured Evidence Photo"
          className="max-w-2xl p-4"
        >
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[75vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewPhotoUrl} alt="Evidence preview" className="max-w-full max-h-full object-contain" />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewPhotoUrl(null)}
                className="px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
