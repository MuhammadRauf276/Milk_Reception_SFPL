'use client';

import { useEffect, useState } from 'react';

type Report = {
  summary: { finalizedJourneys: number; unresolvedJourneys: number; grossLossLiters: number; grossGainLiters: number; at13tsLossLiters: number; at13tsGainLiters: number; unresolvedOriginAt13tsLiters: number };
  items: Array<{ journeyId: string; journeyNumber: string; route: { code: string; name: string }; vehicleNumber: string; isResolved: boolean; at13ts: { loss: number; gain: number; lossPercent: number | null } | null }>;
};

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ZmccReconciliationSnapshot() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/management/zmcc-reconciliation?pageSize=5')
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load reconciliation.'); return body; })
      .then(setReport).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load reconciliation.'));
  }, []);
  if (error) return <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Reconciliation unavailable: {error}</section>;
  if (!report) return <section className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">Loading MOT-to-ZMCC reconciliation...</section>;
  const s = report.summary;
  return <section className="rounded-xl border border-slate-200 bg-white p-4 text-xs" aria-label="MOT to ZMCC reconciliation">
    <div className="flex items-baseline justify-between gap-3"><div><p className="font-black text-slate-900">MOT to ZMCC reconciliation</p><p className="mt-1 text-slate-500">Finalized 13TS loss and gain exclude unresolved journeys.</p></div><span className="font-bold text-slate-600">{s.finalizedJourneys} finalized / {s.unresolvedJourneys} unresolved</span></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><p className="text-slate-500">13TS loss</p><strong>{format(s.at13tsLossLiters)} L</strong></div><div><p className="text-slate-500">13TS gain</p><strong>{format(s.at13tsGainLiters)} L</strong></div><div><p className="text-slate-500">Gross loss</p><strong>{format(s.grossLossLiters)} L</strong></div><div><p className="text-slate-500">Unresolved 13TS</p><strong>{format(s.unresolvedOriginAt13tsLiters)} L</strong></div></div>
    {report.items.length > 0 && <div className="mt-3 border-t pt-2"><p className="font-bold text-slate-700">Latest journeys</p>{report.items.map((row) => <p key={row.journeyId} className="mt-1 text-slate-600">{row.journeyNumber} · {row.route.code} · {row.vehicleNumber} · {row.isResolved ? `${format(row.at13ts?.loss || 0)} L loss` : 'Awaiting final ZMCC decision'}</p>)}</div>}
  </section>;
}
