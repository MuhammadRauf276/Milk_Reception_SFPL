'use client';

import React from 'react';
import { Play, Clock, Truck, Layers, ShieldAlert } from 'lucide-react';
import { formatOperationalTime } from '@/lib/datetime-utils';
import type { OnHoldVisit, WaitingVisit } from './QAQueuePanel';

/** Detail card for a vehicle waiting for QA, styled like the Dispatch to Plant summary panel. */
export const QAWaitingVisitCard: React.FC<{
  visit: WaitingVisit;
  isSubmitting: boolean;
  onStart: (visitId: string) => void;
}> = ({ visit, isSubmitting, onStart }) => (
  <div className="bg-card border-border p-5 sm:p-6 rounded-xl border shadow-xs space-y-5 text-foreground">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-strong">
      <div className="flex items-center space-x-3">
        <div className="p-2.5 rounded-xl bg-primary text-white shadow-2xs">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">Vehicle Waiting for QA</h3>
          <p className="text-xs text-slate-600 font-medium mt-0.5">
            Vehicle <strong className="tabular-nums text-foreground">{visit.vehicle_number}</strong>
            {' · '}Token <strong className="tabular-nums text-primary">{visit.token_number || 'NO-TOKEN'}</strong>
            {visit.reception_number && ` · Rec #${visit.reception_number}`}
          </p>
        </div>
      </div>

      <span className="self-start sm:self-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        Ready for Sampling
      </span>
    </div>

    <div className="bg-card border-border grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl border text-xs tabular-nums font-semibold">
      <div className="space-y-0.5">
        <span className="text-slate-500 font-sans block text-[10px] uppercase font-bold tracking-wider">
          Portions
        </span>
        <span className="text-sm font-bold text-foreground flex items-center gap-1">
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span>{visit.portion_count} Portion{visit.portion_count > 1 ? 's' : ''}</span>
        </span>
      </div>
      <div className="space-y-0.5">
        <span className="text-slate-500 font-sans block text-[10px] uppercase font-bold tracking-wider">
          Total Net Qty
        </span>
        <span className="text-sm font-bold text-foreground">
          {visit.vehicle_dispatch_quantity_value != null && visit.vehicle_dispatch_quantity_unit
            ? `${Number(visit.vehicle_dispatch_quantity_value).toLocaleString()} ${visit.vehicle_dispatch_quantity_unit}`
            : visit.total_quantity_value != null && visit.total_quantity_unit
            ? `${Number(visit.total_quantity_value).toLocaleString()} ${visit.total_quantity_unit}`
            : '—'}
        </span>
      </div>
      <div className="space-y-0.5 col-span-2 sm:col-span-1">
        <span className="text-slate-500 font-sans block text-[10px] uppercase font-bold tracking-wider">
          Gate Entry
        </span>
        <span className="text-sm font-bold text-foreground flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{formatOperationalTime(visit.entry_timestamp)}</span>
        </span>
      </div>
    </div>

    <div className="pt-1">
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => onStart(visit.id)}
        className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold text-sm shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
      >
        <Play className="w-4 h-4 fill-current" />
        <span>{isSubmitting ? 'Starting…' : 'Start QA Testing Session'}</span>
      </button>
    </div>
  </div>
);

/** Detail card for a held vehicle, styled like the Dispatch to Plant summary panel. */
export const QAHeldVisitCard: React.FC<{
  visit: OnHoldVisit;
  isSubmitting: boolean;
  onResume: (visitId: string) => void;
}> = ({ visit, isSubmitting, onResume }) => (
  <div className="bg-card border-border p-5 sm:p-6 rounded-xl border shadow-xs space-y-5 text-foreground">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-200">
      <div className="flex items-center space-x-3">
        <div className="p-2.5 rounded-xl bg-amber-600 text-white shadow-2xs">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-amber-950">QA Testing On Hold</h3>
          <p className="text-xs text-amber-800 font-medium mt-0.5">
            Vehicle <strong className="tabular-nums text-amber-950">{visit.vehicle_number}</strong>
            {' · '}Token <strong className="tabular-nums text-amber-900">{visit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>
      </div>

      <span className="self-start sm:self-center px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-amber-100 text-amber-900 border border-amber-300">
        On Hold
      </span>
    </div>

    <div className="bg-card border-border p-4 rounded-xl border space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
        Reason for Hold
      </span>
      <p className="text-xs font-semibold text-amber-950">{visit.hold_reason}</p>
    </div>

    <div className="bg-card border-border grid grid-cols-2 gap-3 p-3.5 rounded-xl border text-xs tabular-nums font-semibold">
      <div>
        <span className="text-slate-500 font-sans block text-[10px] uppercase font-bold tracking-wider">Chemist</span>
        <span className="text-foreground">{visit.chemist_name}</span>
      </div>
      <div>
        <span className="text-slate-500 font-sans block text-[10px] uppercase font-bold tracking-wider">Held Since</span>
        <span className="text-foreground flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{formatOperationalTime(visit.held_since)}</span>
        </span>
      </div>
    </div>

    <div className="pt-1">
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => onResume(visit.id)}
        className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-sm shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
      >
        <Play className="w-4 h-4 fill-current" />
        <span>{isSubmitting ? 'Resuming…' : 'Resume Testing Session'}</span>
      </button>
    </div>
  </div>
);
