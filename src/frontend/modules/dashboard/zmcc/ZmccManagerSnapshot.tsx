'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { ZmccExitOutcomes, type ExitOutcomeRow } from './ZmccExitOutcomes';

type Overview = {
  source: { name: string };
  pipeline: Record<string, number>;
  tank: { grossLiters: number; at13TsLiters: number | null; activeTankCount: number };
  dispatch: { ready: number; activeAtPlant: number };
  exceptions: { pendingManagerReview: number; leftWithoutFullUnloading: number; pendingCloseRequests: number };
  exits: { leftWithoutFullUnloading: ExitOutcomeRow[]; pendingCloseRequests: ExitOutcomeRow[] };
  activeStations: Array<{ id: string; label: string; station: string; responsibleRole: string; waitingMinutes: number; journeyTotals?: { shopsCollected: number; quantity: number } }>;
};

const QUERY_KEY = ['zmcc-manager', 'overview-snapshot'];

function useManagerOverview() {
  const queryClient = useQueryClient();
  const { data: overview, error: queryError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => fetchJson<{ overview: Overview }>('/api/zmcc/manager/overview', { signal }).then((b) => b.overview),
    refetchInterval: 30_000,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  // Contract (Package B): POST /api/zmcc/lab/sessions/[id]/close-approve { decision: 'APPROVE' | 'REJECT', remarks }
  const decide = useMutation({
    mutationFn: async (input: { sessionId: string; decision: 'APPROVE' | 'REJECT'; remarks: string }) => {
      const response = await fetch(`/api/zmcc/lab/sessions/${input.sessionId}/close-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: input.decision, remarks: input.remarks }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Unable to record the decision.');
    },
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  return { overview, queryError, decide, actionError, queryClient };
}

export function ZmccManagerExitPanel() {
  const { overview, queryError, decide, actionError } = useManagerOverview();
  if (queryError || !overview) return null;
  return <section className="space-y-3" aria-label="ZMCC exit outcomes">
    {actionError ? <div role="alert" className="bg-card border-border rounded-xl border p-3 text-xs text-red-800">{actionError}</div> : null}
    <ZmccExitOutcomes
      left={overview.exits.leftWithoutFullUnloading}
      pending={overview.exits.pendingCloseRequests}
      canDecide
      busy={decide.isPending}
      onDecide={(sessionId, decision, remarks) => decide.mutate({ sessionId, decision, remarks })}
    />
  </section>;
}

export function ZmccManagerSnapshot() {
  const { overview, queryError, decide, actionError } = useManagerOverview();
  if (queryError) return <div className="bg-card border-border rounded-xl border p-3 text-xs text-amber-900">Manager snapshot unavailable: {queryError.message || 'Unable to load manager snapshot.'}</div>;
  if (!overview) return <div className="bg-card border-border rounded-xl border p-4 text-xs text-slate-500">Loading assigned ZMCC snapshot…</div>;
  const cards = [
    ['Expected', overview.pipeline.expected], ['Arrived', overview.pipeline.arrived], ['Testing', overview.pipeline.testing], ['Accepted', overview.pipeline.accepted], ['Rejected', overview.pipeline.rejected], ['Dispatched', overview.pipeline.dispatched],
  ];
  return <section className="space-y-3" aria-label="Assigned ZMCC operational snapshot">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{cards.map(([label, value]) => <div key={String(label)} className="bg-card border-border rounded-xl border p-3"><p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p></div>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><div className="bg-card border-border rounded-xl border p-4 text-xs"><p className="font-semibold text-slate-900">Tank and dispatch</p><p className="mt-2">Tank: <strong>{overview.tank.grossLiters.toLocaleString()} L</strong> · Ready: <strong>{overview.dispatch.ready}</strong></p><p className="mt-1">At plant: <strong>{overview.dispatch.activeAtPlant}</strong> · To review: <strong>{overview.exceptions.pendingManagerReview}</strong></p></div><div className="bg-card border-border rounded-xl border p-4 text-xs"><p className="font-semibold text-slate-900">Active Mobile Tester work</p>{overview.activeStations.length ? overview.activeStations.map((item) => <p key={item.id} className="mt-2">{item.label} · {item.station} · {item.waitingMinutes}m</p>) : <p className="mt-2 text-slate-500">None</p>}</div></div>
    {actionError ? <div role="alert" className="bg-card border-border rounded-xl border p-3 text-xs text-red-800">{actionError}</div> : null}
    <ZmccExitOutcomes
      left={overview.exits.leftWithoutFullUnloading}
      pending={overview.exits.pendingCloseRequests}
      canDecide
      busy={decide.isPending}
      onDecide={(sessionId, decision, remarks) => decide.mutate({ sessionId, decision, remarks })}
    />
  </section>;
}
