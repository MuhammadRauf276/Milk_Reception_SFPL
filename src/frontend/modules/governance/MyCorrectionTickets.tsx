'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import type { SerializedCorrectionRequest } from '@/backend/services/correctionGovernanceService';

export const CORRECTION_MODULE_LABELS: Record<string, string> = {
  ZMCC_LAB_SESSION: 'Lab record',
  MOT_SHOP_COLLECTION: 'Shop collection',
  ZMCC_MC_ARRIVAL: 'Mobile Tester arrival',
  ZMCC_HC_ARRIVAL: 'HC arrival',
  ZMCC_WEIGHING: 'Weighing',
  ZMCC_EXIT: 'Exit record',
  VEHICLE_VISIT: 'Vehicle visit',
  PLANT_QA_MEASUREMENT: 'Plant QA',
};

const STATUS_STYLE: Record<string, string> = {
  Open: 'bg-amber-100 text-amber-800',
  Approved: 'bg-blue-100 text-blue-800',
  Rejected: 'bg-rose-100 text-rose-800',
  Done: 'bg-emerald-100 text-emerald-800',
};

export const CorrectionStatusBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[label] ?? 'bg-slate-100 text-slate-700'}`}>
    {label}
  </span>
);

/**
 * "My correction requests": every ticket the signed-in user raised, with its status
 * (Open / Approved / Rejected / Done). Lower roles cannot correct records themselves; this is where they follow up.
 */
export const MyCorrectionTicketsButton: React.FC<{ className?: string }> = ({ className }) => {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['corrections', 'mine'],
    queryFn: ({ signal }) => fetchJson<{ items?: SerializedCorrectionRequest[] }>('/api/corrections?status=ALL', { signal }),
    staleTime: 20_000,
  });
  const items = query.data?.items ?? [];
  const openCount = items.filter((i) => i.statusLabel === 'Open').length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'flex items-center space-x-1 min-h-[44px] px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer'
        }
      >
        <ClipboardList className="w-3.5 h-3.5" />
        <span>My correction requests{openCount > 0 ? ` (${openCount} open)` : ''}</span>
      </button>

      <ZmccDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="My correction requests"
        icon={<ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />}
      >
        {query.isLoading && <p className="text-xs text-slate-500">Loading…</p>}
        {!query.isLoading && items.length === 0 && (
          <p className="text-xs text-slate-500">No requests</p>
        )}
        <ul className="space-y-3">
          {items.map((t) => {
            const [field, proposed] = Object.entries(t.requestedChanges)[0] ?? [];
            return (
              <li key={t.id} className="rounded-xl border border-border p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {CORRECTION_MODULE_LABELS[t.module] ?? t.module} #{t.recordId}
                  </span>
                  <CorrectionStatusBadge label={t.statusLabel} />
                </div>
                {field !== undefined && (
                  <div className="text-slate-700">
                    <span className="font-medium">{field.replace(/_/g, ' ')}:</span>{' '}
                    <span className="tabular-nums text-rose-700">{String(t.currentValues[field] ?? '—')}</span>
                    {' → '}
                    <span className="tabular-nums font-semibold text-emerald-700">{String(proposed)}</span>
                  </div>
                )}
                <div className="text-slate-600">Reason: {t.reason}</div>
                {t.reviewReason && t.statusLabel !== 'Open' && (
                  <div className="text-slate-600">Answer: {t.reviewReason}</div>
                )}
                <div className="text-slate-400">{new Date(t.requestedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}</div>
              </li>
            );
          })}
        </ul>
      </ZmccDrawer>
    </>
  );
};
