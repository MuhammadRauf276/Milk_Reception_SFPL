'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { ZmccExitOutcomes, type ExitOutcomeRow } from './ZmccExitOutcomes';
import { ErrorPopup } from '@/components/ui/error-popup';
import { ErrorState } from '@/components/ui/empty-state';

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
  // A superior covering this station picks the ZMCC; it is in the address as zmccId.
  const selectedZmccId = useSearchParams().get('zmccId');
  const { data: overview, error: queryError, refetch } = useQuery({
    queryKey: [...QUERY_KEY, selectedZmccId ?? 'own'],
    queryFn: ({ signal }) =>
      fetchJson<{ overview: Overview }>(
        `/api/zmcc/manager/overview${selectedZmccId ? `?sourceId=${encodeURIComponent(selectedZmccId)}` : ''}`,
        { signal }
      ).then((b) => b.overview),
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

  return { overview, queryError, decide, actionError, queryClient, refetch };
}

export function ZmccManagerExitPanel() {
  const { overview, queryError, decide, actionError } = useManagerOverview();
  if (queryError || !overview) return null;
  return <section className="space-y-3" aria-label="ZMCC exit outcomes">
    <ErrorPopup message={actionError} />
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
  const { overview, queryError, decide, actionError, refetch } = useManagerOverview();
  if (queryError) return <ErrorState description={queryError.message || 'Unable to load manager snapshot.'} onRetry={() => void refetch()} />;
  if (!overview) return <div className="bg-card border-border rounded-2xl border p-4 text-xs text-muted-foreground">Loading assigned ZMCC snapshot…</div>;
  const cards = [
    ['Expected', overview.pipeline.expected], ['Arrived', overview.pipeline.arrived], ['Testing', overview.pipeline.testing], ['Accepted', overview.pipeline.accepted], ['Rejected', overview.pipeline.rejected], ['Dispatched', overview.pipeline.dispatched],
  ];
  return <section className="space-y-3" aria-label="Assigned ZMCC operational snapshot">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">{cards.map(([label, value]) => <div key={String(label)} className="bg-card border-border rounded-xl border p-3"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{value}</p></div>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><div className="bg-card border-border rounded-2xl border p-4 text-xs"><p className="font-semibold text-foreground">Tank and dispatch</p><p className="mt-2">Tank: <strong>{overview.tank.at13TsLiters != null ? `${overview.tank.at13TsLiters.toLocaleString()} L @13 TS` : '—'}</strong> <span className="text-muted-foreground">(Gross {overview.tank.grossLiters.toLocaleString()} L)</span> · On the way: <strong>{overview.dispatch.ready}</strong></p><p className="mt-1">At plant: <strong>{overview.dispatch.activeAtPlant}</strong> · To review: <strong>{overview.exceptions.pendingManagerReview}</strong></p></div><div className="bg-card border-border rounded-2xl border p-4 text-xs"><p className="font-semibold text-foreground">Active Mobile Tester work</p>{overview.activeStations.length ? overview.activeStations.map((item) => <p key={item.id} className="mt-2">{item.label} · {item.station} · {item.waitingMinutes}m</p>) : <p className="mt-2 text-muted-foreground">None</p>}</div></div>
    <ErrorPopup message={actionError} />
    <ZmccExitOutcomes
      left={overview.exits.leftWithoutFullUnloading}
      pending={overview.exits.pendingCloseRequests}
      canDecide
      busy={decide.isPending}
      onDecide={(sessionId, decision, remarks) => decide.mutate({ sessionId, decision, remarks })}
    />
  </section>;
}
