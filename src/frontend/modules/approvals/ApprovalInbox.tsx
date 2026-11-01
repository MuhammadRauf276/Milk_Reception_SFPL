'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { Loader2, ShieldCheck, Undo2 } from 'lucide-react';
import type { User } from '@/backend/core/types';
import type { OperationalStage } from '@/backend/services/escalation/approvalMatrix';
import type { UnifiedApprovalItem, InboxCounts } from '@/backend/services/approvals/approvalInboxService';
import { cn } from '@/lib/utils';
import { STAGE_LABELS } from './approvalInboxShared';
import { ApprovalQueueList } from './ApprovalQueueList';
import { ApprovalInspectModal } from './ApprovalInspectModal';

export interface ApprovalInboxProps {
  currentUser: User | null;
  initialStage?: 'ALL' | OperationalStage;
  fixedStage?: OperationalStage;
  sourceType?: 'ZMCC' | 'CONTRACTOR' | 'PLANT';
  onCountChange?: (counts: InboxCounts) => void;
  className?: string;
}

const EMPTY_COUNTS: InboxCounts = {
  totalPending: 0,
  stage1: 0,
  stage2: 0,
  stage3: 0,
  stage4: 0,
  warningCount: 0,
  breachedCount: 0,
};

const ALL_STAGE_PILLS: Array<{ stage: OperationalStage; label: string; countKey: keyof InboxCounts; active: string }> = [
  { stage: 'STAGE_1', label: 'Area', countKey: 'stage1', active: 'bg-primary text-white border-primary' },
  { stage: 'STAGE_2', label: 'ZMCC', countKey: 'stage2', active: 'bg-primary text-white border-primary' },
  { stage: 'STAGE_3', label: 'Dispatch', countKey: 'stage3', active: 'bg-primary text-white border-primary' },
  { stage: 'STAGE_4', label: 'Plant QA', countKey: 'stage4', active: 'bg-primary text-white border-primary' },
];

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
  const queryClient = useQueryClient();

  // Selected item for responsive Drawer / Modal inspection & decision
  const [inspectItemId, setInspectItemId] = useState<string | null>(null);

  // Derive visible stage pills according to strict role scoping:
  // Plant QA (Stage 4) is strictly reserved for AVP QA (QA_HEAD / QA_LAB_ATTENDANT) and above
  // (SUPER_ADMIN, DATA_EXECUTIVE, EXECUTIVE_MANAGEMENT). MPD Head and ZMCC roles must NEVER see S4.
  const visibleStagePills = useMemo(() => {
    const role = currentUser?.role;
    const isSuperOrAuditor =
      role === 'SUPER_ADMIN' ||
      role === 'DATA_EXECUTIVE' ||
      role === 'EXECUTIVE_MANAGEMENT';


    const canSeeStage1 =
      role === 'ZMCC_MANAGER' ||
      role === 'MDO' ||
      isSuperOrAuditor;

    const canSeeStage2 =
      role === 'ZMCC_MANAGER' ||
      isSuperOrAuditor;

    const canSeeStage3 =
      role === 'ZMCC_MANAGER' ||
      role === 'CONTRACTOR_MANAGER' ||
      role === 'HEAD_OF_MPD' ||
      isSuperOrAuditor;

    const canSeeStage4 =
      role === 'QA_HEAD' ||
      role === 'QA_LAB_ATTENDANT' ||
      isSuperOrAuditor;

    return ALL_STAGE_PILLS.filter((p) => {
      if (p.stage === 'STAGE_4') return canSeeStage4;
      if (p.stage === 'STAGE_1') return canSeeStage1;
      if (p.stage === 'STAGE_2') return canSeeStage2;
      if (p.stage === 'STAGE_3') return canSeeStage3;
      return false;
    });
  }, [currentUser?.role]);

  // If stageFilter is set to an invisible stage for this role, auto reset to 'ALL'
  useEffect(() => {
    if (!fixedStage && stageFilter !== 'ALL') {
      const isVisible = visibleStagePills.some((p) => p.stage === stageFilter);
      if (!isVisible) {
        setStageFilter('ALL');
      }
    }
  }, [stageFilter, visibleStagePills, fixedStage]);

  const inboxKey = useMemo(
    () => ['approvals', 'inbox', { statusFilter, stage: fixedStage ?? stageFilter, sourceType: sourceType ?? null }] as const,
    [statusFilter, stageFilter, fixedStage, sourceType]
  );

  const inboxQuery = useQuery({
    queryKey: inboxKey,
    queryFn: ({ signal }) => {
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
      return fetchJson<{ items?: UnifiedApprovalItem[]; counts?: InboxCounts }>(
        `/api/approvals/inbox?${params.toString()}`,
        { signal }
      );
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const items: UnifiedApprovalItem[] = useMemo(() => inboxQuery.data?.items ?? [], [inboxQuery.data]);
  const counts: InboxCounts = inboxQuery.data?.counts ?? EMPTY_COUNTS;
  const loading = inboxQuery.isPending;
  const refreshing = inboxQuery.isFetching && !inboxQuery.isPending;
  const error = inboxQuery.isError ? inboxQuery.error.message || 'Error loading approval items.' : null;

  const onCountChangeRef = React.useRef(onCountChange);
  onCountChangeRef.current = onCountChange;
  useEffect(() => {
    if (inboxQuery.data?.counts) onCountChangeRef.current?.(inboxQuery.data.counts);
  }, [inboxQuery.data]);

  const fetchInbox = useCallback(
    async () => {
      await queryClient.invalidateQueries({ queryKey: ['approvals', 'inbox'] });
    },
    [queryClient]
  );

  const activeInspectItem = useMemo(
    () => items.find((i) => i.id === inspectItemId) ?? null,
    [items, inspectItemId]
  );

  const decisionMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/approvals/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error('This item was already updated or decided by another supervisor. Reloading queue…');
        }
        throw new Error(errData.error || 'Failed to submit approval decision.');
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['approvals', 'inbox'] }),
  });

  const statusTabClass = (active: boolean) =>
    cn(
      'min-h-11 px-3 py-1.5 rounded-lg transition font-semibold text-xs',
      active ? 'bg-white text-foreground shadow-2xs font-bold' : 'text-slate-600 hover:text-foreground'
    );

  return (
    <div className={cn('flex flex-col w-full h-full min-h-[620px] bg-card rounded-2xl border border-border shadow-xs overflow-hidden', className)}>
      {/* Top Master Control Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 bg-white border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-base sm:text-lg font-bold text-foreground">
              {fixedStage ? STAGE_LABELS[fixedStage]?.label : 'Approvals'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5 ml-auto">
          {/* Status Tab (Pending vs Decided History) */}
          <div className="inline-flex rounded-xl border border-border p-1 bg-slate-100 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('PENDING');
                setInspectItemId(null);
              }}
              className={statusTabClass(statusFilter === 'PENDING')}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('DECIDED');
                setInspectItemId(null);
              }}
              className={statusTabClass(statusFilter === 'DECIDED')}
            >
              History
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchInbox()}
            disabled={loading || refreshing}
            className="flex min-h-11 min-w-11 items-center justify-center text-slate-600 hover:text-primary hover:bg-slate-100 rounded-xl border border-border transition disabled:opacity-50"
            title="Refresh Queue"
            aria-label="Refresh Queue"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Undo2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Stage Filter Pills (Filtered by Role Jurisdiction) */}
      {!fixedStage && visibleStagePills.length > 1 && (
        <nav aria-label="Operational Stages" className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 border-b border-border overflow-x-auto text-xs font-semibold">
          <button
            type="button"
            onClick={() => setStageFilter('ALL')}
            className={cn(
              'min-h-11 px-3.5 py-1 rounded-full border transition shrink-0',
              stageFilter === 'ALL'
                ? 'bg-primary text-white border-primary shadow-2xs font-bold'
                : 'bg-white text-slate-600 border-border hover:bg-slate-100'
            )}
          >
            All
          </button>
          {visibleStagePills.map((pill) => (
            <button
              key={pill.stage}
              type="button"
              onClick={() => setStageFilter(pill.stage)}
              className={cn(
                'min-h-11 px-3.5 py-1 rounded-full border transition shrink-0',
                stageFilter === pill.stage
                  ? `${pill.active} shadow-2xs font-bold`
                  : 'bg-white text-slate-600 border-border hover:bg-slate-100'
              )}
            >
              {pill.label} ({counts[pill.countKey]})
            </button>
          ))}
        </nav>
      )}

      {/* Main Queue & History List (Full Width, Paginated, Zero Clutter) */}
      <ApprovalQueueList
        items={items}
        selectedItemId={inspectItemId}
        loading={loading}
        refreshing={refreshing}
        error={error}
        statusFilter={statusFilter}
        onSelect={(id) => setInspectItemId(id)}
        onRetry={() => fetchInbox()}
      />

      {/* Responsive Inspection & Decision Overlay (Modal on Desktop, Drawer on Mobile) */}
      {activeInspectItem && (
        <ApprovalInspectModal
          key={activeInspectItem.id}
          item={activeInspectItem}
          isOpen={Boolean(activeInspectItem)}
          currentUser={currentUser}
          onClose={() => setInspectItemId(null)}
          onSubmitDecision={decisionMutation.mutateAsync}
          onDecided={() => {
            setInspectItemId(null);
          }}
        />
      )}
    </div>
  );
}
