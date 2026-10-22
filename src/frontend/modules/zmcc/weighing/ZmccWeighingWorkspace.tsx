'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, Truck, Warehouse } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import type { WeighingQueueData, WeighingSessionView } from '@/backend/services/zmccTankService';
import { ZmccPager } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { WeighingEntryDrawer, type WeighingPolicyView } from './WeighingEntryDrawer';

const DEFAULT_POLICY: WeighingPolicyView = { manual_entry_enabled: false, allowed_units: 'BOTH' };

function netLine(s: WeighingSessionView): string {
  return s.portions
    .map((p) => (p.net_value !== null ? `${p.label}: ${p.net_value} ${p.net_unit === 'LITER' ? 'L' : 'kg'}` : `${p.label}: -`))
    .join(' | ');
}

function VehicleCard({ session, onOpen }: { session: WeighingSessionView; onOpen?: () => void }) {
  const done = session.status === 'UNLOADED';
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Truck className="h-5 w-5 text-slate-600" />
          {session.vehicle_number || 'Vehicle'}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{session.source_type}</span>
        </div>
        {done ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-bold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> Unloaded
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-800">
            <Clock className="h-4 w-4" /> {session.values_complete ? 'Values saved' : 'Ready'}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {session.source_name || ''}
        {session.zmcc_token ? ` - Token ${session.zmcc_token}` : ''}
        {` - ${session.portions.length} accepted portion${session.portions.length === 1 ? '' : 's'}`}
      </p>
      {(done || session.values_complete) && <p className="mt-2 text-sm font-semibold text-slate-800">{netLine(session)}</p>}
      {done && (
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Warehouse className="h-4 w-4" /> {session.tank_code ? `Tank ${session.tank_code}` : 'Tank'}
          {session.milk_source_name ? ` - ${session.milk_source_name}` : ''}
        </p>
      )}
    </>
  );
  if (done || !onOpen) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block min-h-[44px] w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary cursor-pointer"
    >
      {body}
    </button>
  );
}

export const ZmccWeighingWorkspace: React.FC = () => {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [donePage, setDonePage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ['zmcc', 'weighing', 'queue', donePage],
    queryFn: ({ signal }) => fetchJson<WeighingQueueData>(`/api/zmcc/weighing/queue?done_page=${donePage}`, { signal }),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
  });
  const policyQuery = useQuery({
    queryKey: ['zmcc', 'weighing', 'policy'],
    queryFn: ({ signal }) => fetchJson<WeighingPolicyView>('/api/zmcc/weighing/policy', { signal }),
    staleTime: 60_000,
  });

  const data = queueQuery.data;
  const ready = data?.ready ?? [];
  const done = data?.done ?? [];
  const tanks = data?.tanks ?? [];
  const sources = data?.sources ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.done_total / data.done_page_size)) : 1;
  const error = queueQuery.error ? getErrorMessage(queueQuery.error) || 'Could not load the list.' : null;
  const reload = () => queryClient.invalidateQueries({ queryKey: ['zmcc', 'weighing'] });
  const openSession = ready.find((s) => s.session_id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Weigh milk</h2>
        <button
          type="button"
          onClick={() => void reload()}
          className="h-11 min-w-[44px] rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800"
        >
          Refresh
        </button>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">
          Problem: {error}
        </p>
      )}
      {queueQuery.isFetching && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}

      {!queueQuery.isLoading && ready.length === 0 && (
        <p className="text-sm text-slate-600">No vehicle is ready. A vehicle appears here when the lab has decided all its portions.</p>
      )}
      <div className="space-y-3">
        {ready.map((s) => (
          <VehicleCard
            key={s.session_id}
            session={s}
            onOpen={() => {
              setNotice(null);
              setOpenId(s.session_id);
            }}
          />
        ))}
      </div>

      {(done.length > 0 || donePage > 1) && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-700">Done in the last 24 hours</h3>
          {done.map((s) => (
            <VehicleCard key={s.session_id} session={s} />
          ))}
          <ZmccPager page={donePage} totalPages={totalPages} onPage={setDonePage} disabled={queueQuery.isFetching} />
        </div>
      )}

      {openSession && (
        <WeighingEntryDrawer
          key={openSession.session_id}
          session={openSession}
          tanks={tanks}
          sources={sources}
          policy={policyQuery.data ?? DEFAULT_POLICY}
          onClose={() => setOpenId(null)}
          onChanged={(m) => {
            setNotice(m);
            setOpenId(null);
            void reload();
          }}
        />
      )}
    </div>
  );
};

export default ZmccWeighingWorkspace;
