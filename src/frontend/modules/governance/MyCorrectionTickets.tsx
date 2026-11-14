'use client';

import { Pagination, usePagedRows } from '@/components/ui/pagination';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { formatLabel } from '@/lib/format';
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
  <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${STATUS_STYLE[label] ?? 'bg-muted text-secondary-foreground'}`}>
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
  const paged = usePagedRows(items, (t) => String(t.id));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'flex items-center space-x-1 min-h-[44px] px-4 bg-muted hover:bg-muted/80 active:scale-95 text-secondary-foreground rounded-xl text-xs font-semibold cursor-pointer transition-colors'
        }
      >
        <ClipboardList className="w-3.5 h-3.5" />
        <span>My correction requests{openCount > 0 ? ` (${openCount} open)` : ''}</span>
      </button>

      <ZmccDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="My correction requests"
        icon={<ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-secondary-foreground" />}
      >
        {query.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!query.isLoading && items.length === 0 && (
          <p className="text-xs text-muted-foreground">No requests</p>
        )}
        <ul className="space-y-3">
          {paged.pageRows.map((t) => {
            const [field, proposed] = Object.entries(t.requestedChanges)[0] ?? [];
            return (
              <li key={t.id} className="rounded-xl border border-border p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {CORRECTION_MODULE_LABELS[t.module] ?? formatLabel(t.module)}
                  </span>
                  <CorrectionStatusBadge label={t.statusLabel} />
                </div>
                {field !== undefined && (
                  <div className="text-secondary-foreground">
                    <span className="font-medium">{formatLabel(field)}:</span>{' '}
                    <span className="tabular-nums text-rose-700">{String(t.currentValues[field] ?? '—')}</span>
                    {' → '}
                    <span className="tabular-nums font-semibold text-emerald-700">{String(proposed)}</span>
                  </div>
                )}
                <div className="text-secondary-foreground">Reason: {t.reason}</div>
                {t.reviewReason && t.statusLabel !== 'Open' && (
                  <div className="text-secondary-foreground">Answer: {t.reviewReason}</div>
                )}
                <div className="text-muted-foreground">{new Date(t.requestedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}</div>
              </li>
            );
          })}
        </ul>
        {paged.totalPages > 1 ? (
          <Pagination page={paged.page} totalPages={paged.totalPages} totalRecords={paged.totalRecords} pageSize={paged.pageSize} noun="requests" onPageChange={paged.setPage} />
        ) : null}
      </ZmccDrawer>
    </>
  );
};
