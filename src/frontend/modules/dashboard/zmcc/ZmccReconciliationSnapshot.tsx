'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { formatLossGain, formatLossGainPercent, lossGainClass } from '@/lib/lossGain';

type Report = {
  summary: { finalizedJourneys: number; unresolvedJourneys: number; grossLossLiters: number; grossGainLiters: number; at13tsLossLiters: number; at13tsGainLiters: number; grossNetLiters: number; at13tsNetLiters: number; grossNetPercent: number | null; at13tsNetPercent: number | null; unresolvedOriginAt13tsLiters: number };
  items: Array<{ journeyId: string; journeyNumber: string; route: { code: string; name: string }; vehicleNumber: string; isResolved: boolean; at13ts: { signedVariance: number; loss: number; gain: number; signedPercent: number | null } | null }>;
};

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ZmccReconciliationSnapshot() {
  const { data: report, error: queryError } = useQuery({
    queryKey: ['zmcc-manager', 'reconciliation-snapshot'],
    queryFn: ({ signal }) => fetchJson<Report>('/api/management/zmcc-reconciliation?pageSize=5', { signal }),
  });
  const error = queryError ? queryError.message || 'Reconciliation did not load.' : null;
  if (error) return <section className="bg-card border-border rounded-xl border p-3 text-xs text-amber-900">Reconciliation unavailable: {error}</section>;
  if (!report) return <section className="bg-card border-border rounded-2xl border p-4 text-xs text-muted-foreground">Loading reconciliation…</section>;
  const s = report.summary;
  return <section className="bg-card border-border rounded-2xl border p-4 text-xs" aria-label="Reconciliation">
    <div className="flex items-baseline justify-between gap-3"><div><p className="font-semibold text-foreground">Reconciliation</p><p className="mt-1 text-muted-foreground">Finalized journeys only</p></div><span className="font-semibold text-secondary-foreground">{s.finalizedJourneys} finalized / {s.unresolvedJourneys} unresolved</span></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><p className="text-muted-foreground">Loss / Gain @13 TS</p><strong className={lossGainClass(s.at13tsNetLiters)}>{formatLossGain(s.at13tsNetLiters)}</strong>{s.at13tsNetPercent != null && <span className="block text-muted-foreground">{formatLossGainPercent(s.at13tsNetPercent)}</span>}</div><div><p className="text-muted-foreground">Loss / Gain gross</p><strong className={lossGainClass(s.grossNetLiters)}>{formatLossGain(s.grossNetLiters)}</strong>{s.grossNetPercent != null && <span className="block text-muted-foreground">{formatLossGainPercent(s.grossNetPercent)}</span>}</div><div><p className="text-muted-foreground">Loss, each journey</p><strong className="text-rose-700">{format(s.at13tsLossLiters)} L</strong></div><div><p className="text-muted-foreground">Gain, each journey</p><strong className="text-emerald-700">{format(s.at13tsGainLiters)} L</strong></div></div>
    {report.items.length > 0 && <div className="mt-3 border-t pt-2"><p className="font-semibold text-secondary-foreground">Latest journeys</p>{report.items.map((row) => <p key={row.journeyId} className="mt-1 text-secondary-foreground">{row.journeyNumber} · {row.route.code} · {row.vehicleNumber} · {row.isResolved && row.at13ts ? <span className={lossGainClass(row.at13ts.signedVariance)}>{formatLossGain(row.at13ts.signedVariance)}</span> : 'Awaiting final ZMCC decision'}</p>)}</div>}
  </section>;
}
