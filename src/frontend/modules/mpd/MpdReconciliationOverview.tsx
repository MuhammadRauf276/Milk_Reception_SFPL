'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { InfoTip } from '@/components/ui/info-tip';
import { SupplyChainLossCard } from '@/frontend/modules/dashboard/components/SupplyChainLossCard';

type Reconciliation = { summary: { finalizedJourneys: number; unresolvedJourneys: number; grossLossLiters: number; grossGainLiters: number; at13tsLossLiters: number; at13tsGainLiters: number; unresolvedOriginAt13tsLiters: number }; items: Array<{ journeyId: string; journeyNumber: string; source: { code: string; name: string }; route: { code: string }; vehicleNumber: string; isResolved: boolean }> };
type VehicleStages = { total: number; items: Array<{ visitId: string; vehicleNumber: string; source: { code: string }; route: { name: string } | null; stage: string; exception: { kind: string } | null }> };

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function MpdReconciliationOverview() {
  const query = useQuery({
    queryKey: ['mpd', 'reconciliation-overview'],
    queryFn: async ({ signal }) => {
      const [reconciliation, stages] = await Promise.all([
        fetchJson<Reconciliation>('/api/management/zmcc-reconciliation?pageSize=8', { signal }),
        fetchJson<VehicleStages>('/api/management/vehicle-stages?exceptionOnly=true&pageSize=8', { signal }),
      ]);
      return { reconciliation, stages };
    },
  });
  const report = query.data?.reconciliation ?? null;
  const vehicles = query.data?.stages ?? null;
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Unable to load MPD overview.') : null;

  return (
    <div className="space-y-6">
      {/* 3-Tier Supply Chain Loss Hierarchy Card */}
      <SupplyChainLossCard />

      {error ? (
        <section className="bg-card border-border rounded-xl border p-4 text-sm text-amber-900">
          MPD overview unavailable: {error}
        </section>
      ) : !report || !vehicles ? (
        <section className="bg-card border-border rounded-xl border p-4 text-sm text-slate-500">
          Loading MPD operational exceptions…
        </section>
      ) : (
        <section className="space-y-3" aria-label="MPD reconciliation overview">
          <div>
            <h2 className="inline-flex items-center text-lg font-semibold text-slate-900">Reconciliation<InfoTip text="Cross-source Mobile Tester-to-ZMCC result. Pending journeys are shown separately and are not counted as finalized loss." /></h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-card border-border rounded-xl border p-4">
              <p className="text-xs font-semibold text-slate-500">13TS loss / gain</p>
              <p className="mt-1 text-lg font-semibold">
                {number(report.summary.at13tsLossLiters)} / {number(report.summary.at13tsGainLiters)} L
              </p>
            </div>
            <div className="bg-card border-border rounded-xl border p-4">
              <p className="text-xs font-semibold text-slate-500">Gross loss / gain</p>
              <p className="mt-1 text-lg font-semibold">
                {number(report.summary.grossLossLiters)} / {number(report.summary.grossGainLiters)} L
              </p>
            </div>
            <div className="bg-card border-border rounded-xl border p-4">
              <p className="text-xs font-semibold text-slate-500">Finalized journeys</p>
              <p className="mt-1 text-lg font-semibold">{report.summary.finalizedJourneys}</p>
            </div>
            <div className="bg-card border-border rounded-xl border p-4">
              <p className="text-xs font-semibold text-slate-500">Unresolved exposure</p>
              <p className="mt-1 text-lg font-semibold">
                {report.summary.unresolvedJourneys} journeys · {number(report.summary.unresolvedOriginAt13tsLiters)} L
              </p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="bg-card border-border rounded-xl border p-4 text-sm">
              <p className="font-semibold">Latest Mobile Tester-to-ZMCC journeys</p>
              {report.items.length ? (
                report.items.map((item) => (
                  <p key={item.journeyId} className="mt-2 text-slate-600">
                    {item.source.code} · {item.route.code} · {item.journeyNumber} · {item.vehicleNumber} · {item.isResolved ? 'finalized' : 'unresolved'}
                  </p>
                ))
              ) : (
                <p className="mt-2 text-slate-500">No journeys</p>
              )}
            </div>
            <div className="bg-card border-border rounded-xl border p-4 text-sm">
              <p className="font-semibold">Vehicle exceptions ({vehicles.total})</p>
              {vehicles.items.length ? (
                vehicles.items.map((item) => (
                  <p key={item.visitId} className="mt-2 text-slate-600">
                    {item.source.code} · {item.vehicleNumber} · {item.stage}
                    {item.exception ? ` · ${item.exception.kind}` : ''}
                  </p>
                ))
              ) : (
                <p className="mt-2 text-slate-500">No active vehicle exceptions.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
