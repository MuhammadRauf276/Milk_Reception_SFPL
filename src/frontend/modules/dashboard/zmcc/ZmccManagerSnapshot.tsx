'use client';

import { useEffect, useState } from 'react';

type Overview = {
  source: { name: string };
  pipeline: Record<string, number>;
  tank: { grossLiters: number; at13TsLiters: number | null; activeTankCount: number };
  dispatch: { ready: number; activeAtPlant: number };
  exceptions: { pendingManagerReview: number; correctionEventsToday: number };
  activeStations: Array<{ id: string; label: string; station: string; responsibleRole: string; waitingMinutes: number; journeyTotals?: { shopsCollected: number; quantity: number } }>;
};

export function ZmccManagerSnapshot() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Array<{ id: string; module: string; recordId: string; impact: string; reason: string; requestedBy: string }>>([]);
  const [reviewNote, setReviewNote] = useState('Reviewed by ZMCC Manager');
  useEffect(() => {
    fetch('/api/zmcc/manager/overview')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load manager snapshot.');
        setOverview(body.overview);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load manager snapshot.'));
    fetch('/api/zmcc/manager/correction-requests').then((response) => response.ok ? response.json() : { requests: [] }).then((body) => setRequests(body.requests || [])).catch(() => setRequests([]));
  }, []);
  if (error) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Manager snapshot unavailable: {error}</div>;
  if (!overview) return <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">Loading assigned ZMCC snapshot…</div>;
  const cards = [
    ['Expected', overview.pipeline.expected], ['Arrived', overview.pipeline.arrived], ['Testing', overview.pipeline.testing], ['Accepted', overview.pipeline.accepted], ['Rejected', overview.pipeline.rejected], ['Dispatched', overview.pipeline.dispatched],
  ];
  return <section className="space-y-3" aria-label="Assigned ZMCC operational snapshot">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{cards.map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>)}</div>
    <div className="grid gap-3 lg:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-4 text-xs"><p className="font-black text-slate-900">Tank and dispatch</p><p className="mt-2">Tank stock: <strong>{overview.tank.grossLiters.toLocaleString()} L</strong> · Dispatch ready: <strong>{overview.dispatch.ready}</strong></p><p className="mt-1">Active at plant: <strong>{overview.dispatch.activeAtPlant}</strong> · Pending manager review: <strong>{overview.exceptions.pendingManagerReview}</strong></p></div><div className="rounded-xl border border-slate-200 bg-white p-4 text-xs"><p className="font-black text-slate-900">Active MOT work</p>{overview.activeStations.length ? overview.activeStations.map((item) => <p key={item.id} className="mt-2">{item.label}: {item.station} · {item.responsibleRole} · waiting {item.waitingMinutes} min{item.journeyTotals ? ` · ${item.journeyTotals.shopsCollected} shops / ${item.journeyTotals.quantity.toLocaleString()} quantity` : ''}</p>) : <p className="mt-2 text-slate-500">No active MOT journey.</p>}</div></div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs"><p className="font-black text-slate-900">Correction requests</p><input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="mt-2 w-full rounded border p-2" aria-label="Correction review reason" />{requests.length ? requests.map((item) => <div key={item.id} className="mt-2 border-t pt-2"><p>{item.module} #{item.recordId} · {item.impact} · {item.requestedBy}</p><p className="text-slate-500">{item.reason}</p><div className="mt-1 flex gap-2">{['APPROVE','REJECT','ESCALATE'].map((decision) => <button key={decision} onClick={async () => { const response = await fetch('/api/zmcc/manager/correction-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: item.id, decision, reason: reviewNote }) }); if (response.ok) setRequests((current) => current.filter((request) => request.id !== item.id)); }} className="rounded bg-slate-800 px-2 py-1 text-white">{decision}</button>)}</div></div>) : <p className="mt-2 text-slate-500">No pending correction requests.</p>}</div>
  </section>;
}
