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
  <div className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-5 text-foreground">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-strong">
      <div className="flex items-center space-x-3">
        <div className="p-3 rounded-xl bg-primary text-white shadow-2xs">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">Vehicle Waiting for QA</h3>
          <p className="text-xs text-secondary-foreground font-medium mt-0.5">
            Vehicle <strong className="tabular-nums text-foreground">{visit.vehicle_number}</strong>
            {' · '}Token <strong className="tabular-nums text-primary">{visit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>
      </div>

      <span className="self-start sm:self-center px-3 py-1 rounded-md text-xs font-semibold bg-muted text-secondary-foreground border border-border">
        Ready for Sampling
      </span>
    </div>

    <div className="bg-card border-border grid grid-cols-2 gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
      <div className="space-y-0.5">
        <span className="text-muted-foreground font-sans block text-xs font-semibold">
          Portions
        </span>
        <span className="text-sm font-semibold text-foreground flex items-center gap-1">
          <Layers className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{visit.portion_count} Portion{visit.portion_count > 1 ? 's' : ''}</span>
        </span>
      </div>
      <div className="space-y-0.5">
        <span className="text-muted-foreground font-sans block text-xs font-semibold">
          Gate Entry
        </span>
        <span className="text-sm font-semibold text-foreground flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{formatOperationalTime(visit.entry_timestamp)}</span>
        </span>
      </div>
    </div>

    <div className="pt-1">
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => onStart(visit.id)}
        className="w-full min-h-12 py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-sm shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
      >
        <Play className="w-4 h-4 fill-current" />
        <span>{isSubmitting ? 'Starting…' : 'Start QA testing'}</span>
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
  <div className="bg-card border-border p-5 sm:p-6 rounded-2xl border shadow-xs space-y-5 text-foreground">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-200">
      <div className="flex items-center space-x-3">
        <div className="p-3 rounded-xl bg-amber-600 text-white shadow-2xs">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-amber-950">QA on hold</h3>
          <p className="text-xs text-amber-800 font-medium mt-0.5">
            Vehicle <strong className="tabular-nums text-amber-950">{visit.vehicle_number}</strong>
            {' · '}Token <strong className="tabular-nums text-amber-900">{visit.token_number || 'NO-TOKEN'}</strong>
          </p>
        </div>
      </div>

      <span className="self-start sm:self-center px-3 py-1 rounded-md text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
        On Hold
      </span>
    </div>

    <div className="bg-card border-border p-4 rounded-2xl border space-y-1.5">
      <span className="text-xs font-semibold text-amber-900 block">
        Reason for Hold
      </span>
      <p className="text-xs font-semibold text-amber-950">{visit.hold_reason}</p>
    </div>

    <div className="bg-card border-border grid grid-cols-2 gap-3 p-4 rounded-2xl border text-xs tabular-nums font-semibold">
      <div>
        <span className="text-muted-foreground font-sans block text-xs font-semibold">Chemist</span>
        <span className="text-foreground">{visit.chemist_name}</span>
      </div>
      <div>
        <span className="text-muted-foreground font-sans block text-xs font-semibold">Held Since</span>
        <span className="text-foreground flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span>{formatOperationalTime(visit.held_since)}</span>
        </span>
      </div>
    </div>

    <div className="pt-1">
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => onResume(visit.id)}
        className="w-full min-h-12 py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-semibold text-sm shadow-xs transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
      >
        <Play className="w-4 h-4 fill-current" />
        <span>{isSubmitting ? 'Resuming…' : 'Resume testing'}</span>
      </button>
    </div>
  </div>
);
