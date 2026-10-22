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
        <Layers className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          Milk Portions ({visitDetail.portions.length})
        </span>
      </div>

      {onAddPortion && (
        <button
          type="button"
          id="qa-add-portion-tab"
          disabled={isAddingPortion || isSubmitting}
          onClick={onAddPortion}
          className="flex items-center space-x-1.5 min-h-[40px] px-3.5 rounded-xl border border-dashed border-primary text-primary hover:bg-primary/5 transition text-xs font-bold shadow-2xs disabled:opacity-50"
          title="Add another test portion"
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

        const portionQty = p.dispatch_quantity_value != null
          ? `${Number(p.dispatch_quantity_value).toLocaleString()} ${p.dispatch_quantity_unit || 'KG'}`
          : null;

        return (
          <div key={`portion-tab-${p.id}`} className="inline-flex items-center shrink-0">
            <button
              type="button"
              onClick={() => onSelectPortion(idx)}
              className={cn(
                'px-4 py-2.5 rounded-xl text-xs font-semibold transition flex items-center space-x-2 border min-h-[44px] cursor-pointer select-none shadow-2xs',
                isSelected
                  ? 'bg-blue-50 text-primary-hover border-primary-hover ring-2 ring-primary-hover/20 font-bold'
                  : isAccepted
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                  : isRejected
                  ? 'bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100'
                  : 'bg-white text-slate-700 border-border-strong hover:bg-slate-50'
              )}
            >
              <span>Portion {p.portion_number}</span>

              {portionQty && (
                <span className="px-2 py-0.5 rounded-md text-[10px] tabular-nums font-semibold bg-white/80 border border-slate-200">
                  {portionQty}
                </span>
              )}

              {isAccepted && (
                <span className="flex items-center gap-1 text-emerald-700 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5 stroke-3 text-emerald-600" />
                  <span>Accepted</span>
                </span>
              )}

              {isRejected && (
                <span className="flex items-center gap-1 text-rose-700 font-bold">
                  <XCircle className="w-3.5 h-3.5 stroke-3 text-rose-600" />
                  <span>Rejected</span>
                </span>
              )}

              {canRemove && onRemovePortion && (
                <span
                  role="button"
                  tabIndex={0}
                  title={`Remove Portion ${p.portion_number}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemovePortion(p.id, p.portion_number);
                  }}
                  className="ml-1 flex min-h-6 min-w-6 items-center justify-center rounded-md hover:bg-rose-100 text-slate-400 hover:text-rose-700 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  </div>
);
