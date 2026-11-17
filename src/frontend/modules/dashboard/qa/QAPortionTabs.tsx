'use client';

import React from 'react';
import { CheckCircle2, XCircle, PlusCircle, X, Loader2, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VisitDetail } from './qaTypes';

export interface QAPortionTabsProps {
  visitDetail: VisitDetail;
  activePortionIndex: number;
  onSelectPortion: (index: number) => void;
  onAddPortion?: () => void;
  isAddingPortion: boolean;
  onRemovePortion?: (portionId: string, portionNumber: number) => void;
  isSubmitting: boolean;
}

/** Horizontal strip of QA test portions matching the Dispatch Portion Editor standard. */
export const QAPortionTabs: React.FC<QAPortionTabsProps> = ({
  visitDetail,
  activePortionIndex,
  onSelectPortion,
  onAddPortion,
  isAddingPortion,
  onRemovePortion,
  isSubmitting,
}) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Layers className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-secondary-foreground">
          Milk Portions ({visitDetail.portions.length})
        </span>
      </div>

      {onAddPortion && (
        <button
          type="button"
          id="qa-add-portion-tab"
          disabled={isAddingPortion || isSubmitting}
          onClick={onAddPortion}
          className="flex items-center space-x-1.5 px-4 rounded-lg border border-dashed border-primary text-primary hover:bg-primary/5 transition text-xs font-semibold shadow-2xs disabled:opacity-50 min-h-11"
          title="Add portion"
        >
          {isAddingPortion ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PlusCircle className="w-3.5 h-3.5" />
          )}
          <span>+ Add Portion</span>
        </button>
      )}
    </div>

    <div className="flex items-center space-x-2.5 overflow-x-auto max-w-full pb-1 scrollbar-thin">
      {visitDetail.portions.map((p, idx) => {
        const isSelected = activePortionIndex === idx;
        const isAccepted = p.plant_decision === 'ACCEPTED';
        const isRejected = p.plant_decision === 'REJECTED';
        const isPending = !isAccepted && !isRejected;
        const canRemove = visitDetail.portions.length > 1 && isPending;

        // Double-Blind Entry: Do not expose dispatch quantities to QA Lab Attendant
        const portionQty = null;

        return (
          <div
            key={`portion-tab-${p.id}`}
            className={cn(
              'inline-flex items-center shrink-0 rounded-xl border min-h-11 shadow-2xs transition overflow-hidden',
              isSelected
                ? 'bg-blue-50 text-primary-hover border-primary-hover ring-2 ring-primary-hover/20'
                : isAccepted
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                : isRejected
                ? 'bg-rose-50 text-rose-900 border-rose-300'
                : 'bg-card text-secondary-foreground border-border-strong'
            )}
          >
            <button
              type="button"
              onClick={() => onSelectPortion(idx)}
              className={cn(
                'px-4 py-2 text-xs font-semibold flex items-center space-x-2 min-h-11 cursor-pointer select-none transition hover:bg-black/[0.03]',
                isSelected && 'font-semibold'
              )}
            >
              <span>Portion {p.portion_number}</span>

              {portionQty && (
                <span className="px-2 py-0.5 rounded-md text-xs tabular-nums font-semibold bg-white/80 border border-border">
                  {portionQty}
                </span>
              )}

              {isAccepted && (
                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 stroke-3 text-emerald-600" />
                  <span>Accepted</span>
                </span>
              )}

              {isRejected && (
                <span className="flex items-center gap-1 text-rose-700 font-semibold">
                  <XCircle className="w-3.5 h-3.5 stroke-3 text-rose-600" />
                  <span>Rejected</span>
                </span>
              )}
            </button>

            {canRemove && onRemovePortion && (
              <button
                type="button"
                disabled={isSubmitting}
                title={`Remove Portion ${p.portion_number}`}
                aria-label={`Remove Portion ${p.portion_number}`}
                onClick={() => onRemovePortion(p.id, p.portion_number)}
                className="flex min-h-11 min-w-9 items-center justify-center border-l border-current/15 px-1.5 text-muted-foreground hover:bg-rose-100 hover:text-rose-700 transition disabled:opacity-50 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  </div>
);
