'use client';

import { useQueryClient } from '@tanstack/react-query';
import { EmptyAction } from '../components/EmptyAction';
import React from 'react';
import { Search, Play, Loader2 } from 'lucide-react';
import { formatOperationalTime } from '@/lib/datetime-utils';
import { onActivateKey } from '@/lib/a11y';
import { cn } from '@/lib/utils';

export interface WaitingVisit {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  portion_count: number;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  total_quantity_value?: number | null;
  total_quantity_unit?: string | null;
  entry_timestamp: string | null;
  waiting_minutes: number;
}

export interface InTestingVisit {
  id: string;
  sessionId: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  started_by_name: string;
  started_by_user_id: string;
  started_at: string;
  elapsed_minutes: number;
  portion_count: number;
  finalized_portion_count: number;
}

export interface OnHoldVisit {
  id: string;
  sessionId: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  portion_number: number;
  hold_reason: string;
  held_since: string;
  chemist_name: string;
  chemist_user_id: string;
}

export interface QAQueuePanelProps {
  activeTab: 'WAITING' | 'IN_TESTING' | 'ON_HOLD';
  searchQuery: string;
  onSearchChange: (query: string) => void;
  waitingVisits: WaitingVisit[];
  inTestingVisits: InTestingVisit[];
  onHoldVisits: OnHoldVisit[];
  selectedWaitingVisitId: string | null;
  selectedTestingVisitId: string | null;
  selectedHeldVisitId: string | null;
  onSelectWaitingVisit: (id: string) => void;
  onSelectTestingVisit: (id: string) => void;
  onSelectHeldVisit: (id: string) => void;
  onOpenActionModal: (action: 'START' | 'RESUME' | 'ACCEPT' | 'HOLD' | 'REJECT', visitId?: string) => void;
  isLoadingQueues: boolean;
  isSubmitting: boolean;
}

export const QAQueuePanel: React.FC<QAQueuePanelProps> = ({
  activeTab,
  searchQuery,
  onSearchChange,
  waitingVisits,
  inTestingVisits,
  onHoldVisits,
  selectedWaitingVisitId,
  selectedTestingVisitId,
  selectedHeldVisitId,
  onSelectWaitingVisit,
  onSelectTestingVisit,
  onSelectHeldVisit,
  onOpenActionModal,
  isLoadingQueues,
  isSubmitting,
}) => {
  const queryClient = useQueryClient();
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-foreground">
          {activeTab === 'WAITING'
            ? 'Waiting'
            : activeTab === 'IN_TESTING'
            ? 'In testing'
            : 'On hold'}
        </h3>
        <span className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
          {activeTab === 'WAITING'
            ? `${waitingVisits.length} ready`
            : activeTab === 'IN_TESTING'
            ? `${inTestingVisits.length} active`
            : `${onHoldVisits.length} held`}
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search token…"
          className="w-full min-h-[44px] pl-10 pr-3.5 py-2 text-xs tabular-nums font-semibold rounded-xl border border-border-strong bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-2xs"
        />
      </div>

      <div key={activeTab} className="space-y-3 max-h-[560px] overflow-y-auto pr-1 stagger-children scrollbar-thin">
        {isLoadingQueues ? (
          <div className="bg-card border-border p-8 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
            Loading queues…
          </div>
        ) : activeTab === 'WAITING' ? (
          waitingVisits.length === 0 ? (
            <EmptyAction message="No vehicles" onRefresh={() => queryClient.invalidateQueries()} />
          ) : (
            waitingVisits.map((v) => {
              const isSelected = selectedWaitingVisitId === v.id;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={onActivateKey}
                  key={`waiting-${v.id}`}
                  onClick={() => onSelectWaitingVisit(v.id)}
                  className={cn(
                    'p-4 rounded-xl border transition cursor-pointer space-y-2.5 shadow-2xs select-none',
                    isSelected
                      ? 'bg-primary/5 text-foreground border-primary ring-1 ring-primary'
                      : 'bg-white text-foreground border-border-strong hover:border-primary-hover/60 hover:bg-slate-50/50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="tabular-nums font-bold text-sm text-foreground">{v.vehicle_number}</span>
                      <span className="tabular-nums text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border">
                        {v.token_number || 'No Token'}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-slate-100 text-slate-700 border border-slate-200">
                      Waiting
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>
                      {v.portion_count} Portion{v.portion_count > 1 ? 's' : ''}
                    </span>
                    <span className="tabular-nums">Wait: {v.waiting_minutes}m</span>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenActionModal('START', v.id);
                    }}
                    className="w-full min-h-[44px] mt-1 py-2 px-3 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-2xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Testing</span>
                  </button>
                </div>
              );
            })
          )
        ) : activeTab === 'IN_TESTING' ? (
          inTestingVisits.length === 0 ? (
            <div className="bg-card border-border p-8 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
              No active tests.
            </div>
          ) : (
            inTestingVisits.map((v) => {
              const isSelected = selectedTestingVisitId === v.id;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={onActivateKey}
                  key={`in-testing-${v.id}`}
                  onClick={() => onSelectTestingVisit(v.id)}
                  className={cn(
                    'p-4 rounded-xl border transition cursor-pointer space-y-2.5 shadow-2xs select-none',
                    isSelected
                      ? 'bg-primary/5 text-foreground border-primary ring-1 ring-primary'
                      : 'bg-white text-foreground border-border-strong hover:border-primary-hover/60 hover:bg-slate-50/50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="tabular-nums font-bold text-sm text-foreground">{v.vehicle_number}</span>
                      <span className="tabular-nums text-xs font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border">
                        {v.token_number || 'No Token'}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-sky-50 text-sky-800 border border-sky-200">
                      In Testing
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span className="truncate max-w-[140px]">By: {v.started_by_name}</span>
                    <span className="tabular-nums font-medium">Elapsed: {v.elapsed_minutes}m</span>
                  </div>

                  <div className="text-[11px] tabular-nums font-semibold text-primary">
                    Portions: {v.finalized_portion_count}/{v.portion_count}
                  </div>
                </div>
              );
            })
          )
        ) : onHoldVisits.length === 0 ? (
          <div className="bg-card border-border p-8 text-center border border-dashed rounded-xl text-sm text-muted-foreground">
            No held tests.
          </div>
        ) : (
          onHoldVisits.map((v) => {
            const isSelected = selectedHeldVisitId === v.id;
            return (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={onActivateKey}
                key={`on-hold-${v.id}`}
                onClick={() => onSelectHeldVisit(v.id)}
                className={cn(
                  'p-4 rounded-xl border transition cursor-pointer space-y-2.5 shadow-2xs select-none',
                  isSelected
                    ? 'bg-primary/5 text-foreground border-primary ring-1 ring-primary'
                    : 'bg-white text-foreground border-amber-300 hover:bg-amber-50/40'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="tabular-nums font-bold text-sm text-foreground">{v.vehicle_number}</span>
                    <span className="tabular-nums text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                      {v.token_number || 'No Token'}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold tabular-nums bg-amber-100 text-amber-900 border border-amber-300">
                    ON HOLD
                  </span>
                </div>

                <p className="bg-card border-border text-xs font-medium p-2 rounded-lg border text-amber-900">
                  <strong className="font-semibold">Reason:</strong> {v.hold_reason}
                </p>

                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                  <span className="truncate max-w-[140px]">By: {v.chemist_name}</span>
                  <span className="tabular-nums">Held: {formatOperationalTime(v.held_since)}</span>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenActionModal('RESUME', v.id);
                  }}
                  className="w-full min-h-[44px] mt-1 py-2 px-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-2xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Resume Testing</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
