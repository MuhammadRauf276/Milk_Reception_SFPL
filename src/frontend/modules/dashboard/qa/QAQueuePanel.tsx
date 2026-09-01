'use client';

import React from 'react';
import { Search, RefreshCw, Play } from 'lucide-react';
import { formatOperationalTime } from '@/lib/datetime-utils';

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
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-extrabold text-[#111311]">
          {activeTab === 'WAITING' ? 'Waiting Queue' : activeTab === 'IN_TESTING' ? 'In Testing Sessions' : 'On Hold Queue'}
        </h3>
        <span className="text-xs font-mono font-bold text-slate-500">
          {activeTab === 'WAITING' ? `${waitingVisits.length} ready` : activeTab === 'IN_TESTING' ? `${inTestingVisits.length} active` : `${onHoldVisits.length} held`}
        </span>
      </div>

      {/* Search Box */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search vehicle or token..."
          className="w-full min-h-[44px] pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-[#C4B9A3] bg-[#EFE9D9] text-[#111311] focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
        />
      </div>

      {/* Queue Content */}
      <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
        {isLoadingQueues ? (
          <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
            Loading QA queues...
          </div>
        ) : activeTab === 'WAITING' ? (
          waitingVisits.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
              No vehicles waiting for QA testing.
            </div>
          ) : (
            waitingVisits.map((v) => {
              const isSelected = selectedWaitingVisitId === v.id;
              return (
                <div
                  key={`waiting-${v.id}`}
                  onClick={() => onSelectWaitingVisit(v.id)}
                  className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                      : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                      <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                        ({v.token_number || 'No Token'})
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'
                    }`}>
                      Waiting
                    </span>
                  </div>

                  <div className={`flex items-center justify-between text-xs font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                    <span>
                      {v.portion_count} Portion{v.portion_count > 1 ? 's' : ''}
                      {v.vehicle_dispatch_quantity_value != null && v.vehicle_dispatch_quantity_unit
                        ? ` (${Number(v.vehicle_dispatch_quantity_value).toLocaleString()} ${v.vehicle_dispatch_quantity_unit})`
                        : v.total_quantity_value != null && v.total_quantity_unit
                        ? ` (${Number(v.total_quantity_value).toLocaleString()} ${v.total_quantity_unit})`
                        : ''}
                    </span>
                    <span>Waiting: {v.waiting_minutes} min</span>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenActionModal('START', v.id);
                    }}
                    className="w-full min-h-[44px] mt-1 py-2 px-3 rounded-lg bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-extrabold transition flex items-center justify-center space-x-1.5 shadow-sm"
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
            <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
              No QA testing sessions in progress.
            </div>
          ) : (
            inTestingVisits.map((v) => {
              const isSelected = selectedTestingVisitId === v.id;
              return (
                <div
                  key={`in-testing-${v.id}`}
                  onClick={() => onSelectTestingVisit(v.id)}
                  className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-[#1E3A8A] text-white border-blue-900 shadow-md ring-2 ring-blue-500/30'
                      : 'bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] hover:bg-amber-100/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                      <span className={`font-mono text-xs font-bold ${isSelected ? 'text-blue-200' : 'text-[#1E3A8A]'}`}>
                        ({v.token_number || 'No Token'})
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-[#F4EFE3] text-[#111311] border border-[#C4B9A3]'
                    }`}>
                      In Testing
                    </span>
                  </div>

                  <div className={`flex items-center justify-between text-xs font-bold ${isSelected ? 'text-slate-200' : 'text-[#334155]'}`}>
                    <span>Chemist: {v.started_by_name}</span>
                    <span>Elapsed: {v.elapsed_minutes} min</span>
                  </div>

                  <div className={`text-[11px] font-mono font-bold ${isSelected ? 'text-blue-100' : 'text-slate-600'}`}>
                    Portions: {v.finalized_portion_count} of {v.portion_count} finalized
                  </div>
                </div>
              );
            })
          )
        ) : onHoldVisits.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
            No QA sessions currently on hold.
          </div>
        ) : (
          onHoldVisits.map((v) => {
            const isSelected = selectedHeldVisitId === v.id;
            return (
              <div
                key={`on-hold-${v.id}`}
                onClick={() => onSelectHeldVisit(v.id)}
                className={`p-4 rounded-xl border transition cursor-pointer space-y-2 ${
                  isSelected
                    ? 'bg-amber-900 text-white border-amber-950 shadow-md ring-2 ring-amber-500/30'
                    : 'bg-amber-50 text-[#111311] border-amber-200 hover:bg-amber-100/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-black text-sm">{v.vehicle_number}</span>
                    <span className={`font-mono text-xs font-bold ${isSelected ? 'text-amber-200' : 'text-amber-800'}`}>
                      ({v.token_number || 'No Token'})
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold font-mono ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}>
                    ON HOLD
                  </span>
                </div>

                <p className={`text-xs font-bold p-2 rounded-lg border ${
                  isSelected ? 'bg-amber-950/60 text-amber-100 border-amber-800' : 'bg-amber-100/60 text-amber-900 border-amber-200'
                }`}>
                  Reason: {v.hold_reason}
                </p>

                <div className={`flex items-center justify-between text-[11px] font-bold ${isSelected ? 'text-amber-200' : 'text-amber-800'}`}>
                  <span>Chemist: {v.chemist_name}</span>
                  <span>Held since: {formatOperationalTime(v.held_since)}</span>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenActionModal('RESUME', v.id);
                  }}
                  className="w-full min-h-[44px] mt-1 py-2 px-3 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold transition flex items-center justify-center space-x-1.5 shadow-sm"
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
