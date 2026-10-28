'use client';

import { AlertTriangle, CheckCircle2, Eye, Undo2, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { fadeSlide } from '@/components/motion/presets';
import type { UnifiedApprovalItem } from '@/backend/services/approvals/approvalInboxService';
import { getRoleLabel } from '@/backend/core/roles/labels';
import { cn } from '@/lib/utils';
import { STAGE_LABELS, cleanEntityTitle, formatWaitingLabel } from './approvalInboxShared';
import { ApprovalDetailBody } from './ApprovalDetailBody';

export function ApprovalDetailPanel({
  item,
  statusFilter,
  mobileInspectOpen,
  onBack,
  onPreviewPhoto,
  onOpenDecision,
}: {
  item: UnifiedApprovalItem | null;
  statusFilter: 'PENDING' | 'DECIDED';
  mobileInspectOpen: boolean;
  onBack: () => void;
  onPreviewPhoto: (url: string) => void;
  onOpenDecision: (verdict: 'OKAY' | 'NO') => void;
}) {
  return (
    <section
      aria-label="Active approval inspection details"
      className={cn(
        'flex-1 flex flex-col bg-white overflow-y-auto',
        mobileInspectOpen ? 'flex fixed inset-0 z-40 lg:static' : 'hidden lg:flex'
      )}
    >
      {item ? (
        <motion.div key={item.id} variants={fadeSlide} initial="initial" animate="animate" className="flex-1 flex flex-col">
          {/* Mobile Back Header */}
          <div className="flex lg:hidden items-center justify-between p-3 border-b border-border bg-slate-100">
            <button
              type="button"
              onClick={onBack}
              className="flex min-h-11 items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-primary min-w-11"
            >
              <Undo2 className="w-4 h-4" />
              <span>Back to Queue</span>
            </button>
            <span className="text-xs font-semibold text-slate-600">{item.referenceNumber}</span>
          </div>

          {/* Inspection Header */}
          <div className="p-4 sm:p-6 border-b border-border bg-white flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className={cn('px-2 py-0.5 rounded text-xs font-bold border', STAGE_LABELS[item.stage].color)}>
                  {STAGE_LABELS[item.stage].label}
                </span>
                <h2 className="text-base sm:text-xl font-bold text-foreground">{item.referenceNumber}</h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-600">{cleanEntityTitle(item.details.entityTitle)}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
                <span>
                  Source: <strong className="text-slate-700">{item.sourceName || 'ZMCC Area'}</strong>
                </span>
                <span>·</span>
                <span>
                  Waiting: <strong className="text-slate-700">{formatWaitingLabel(item.waitingMinutes)}</strong>
                </span>
                <span>·</span>
                <span>
                  Submitted by: <strong className="text-slate-700">{item.submittedBy.name}</strong> (
                  {getRoleLabel(item.submittedBy.role)})
                </span>
              </div>
            </div>

            {/* Status Badge using Color + Icon + Word */}
            <div className="shrink-0">
              {item.status === 'APPROVED' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Approved</span>
                </span>
              ) : item.status === 'REJECTED' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-300 bg-rose-50 text-rose-800 text-xs font-bold">
                  <XCircle className="w-4 h-4" />
                  <span>Rejected</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Pending decision</span>
                </span>
              )}
            </div>
          </div>

          <ApprovalDetailBody item={item} onPreviewPhoto={onPreviewPhoto} />

          {/* Sticky Action Bar */}
          {statusFilter === 'PENDING' && (
            <footer className="p-3 sm:p-4 border-t border-border bg-white sticky bottom-0 z-20 flex items-center justify-between gap-3 shadow-xs">
              <div className="hidden sm:block text-xs text-slate-500">
                {item.canDecide
                  ? 'Select an action to record your official decision.'
                  : 'Actions disabled by Segregation of Duties.'}
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto ml-auto">
                <button
                  type="button"
                  onClick={() => onOpenDecision('NO')}
                  disabled={!item.canDecide}
                  className={cn(
                    'flex-1 sm:flex-initial flex items-center justify-center rounded-xl font-bold transition min-h-11',
                    'min-h-[52px] sm:min-h-11 px-5 sm:px-6 text-sm sm:text-xs',
                    'border-2 border-rose-600 text-rose-700 hover:bg-rose-50 active:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed'
                  )}
                >
                  <span>Reject</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenDecision('OKAY')}
                  disabled={!item.canDecide}
                  className={cn(
                    'flex-1 sm:flex-initial flex items-center justify-center rounded-xl font-bold transition text-white min-h-11',
                    'min-h-[52px] sm:min-h-11 px-6 sm:px-7 text-sm sm:text-xs',
                    'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed'
                  )}
                >
                  <span>Approve</span>
                </button>
              </div>
            </footer>
          )}
        </motion.div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
          <Eye className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">Select an item</p>
        </div>
      )}
    </section>
  );
}
