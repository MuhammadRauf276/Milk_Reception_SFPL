'use client';

import { useEffect, useState } from 'react';
import { SupplyChainLossCard } from '@/frontend/modules/dashboard/components/SupplyChainLossCard';

type Reconciliation = { summary: { finalizedJourneys: number; unresolvedJourneys: number; grossLossLiters: number; grossGainLiters: number; at13tsLossLiters: number; at13tsGainLiters: number; unresolvedOriginAt13tsLiters: number }; items: Array<{ journeyId: string; journeyNumber: string; source: { code: string; name: string }; route: { code: string }; vehicleNumber: string; isResolved: boolean }> };
type VehicleStages = { total: number; items: Array<{ visitId: string; vehicleNumber: string; source: { code: string }; route: { name: string } | null; stage: string; exception: { kind: string } | null }> };

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function MpdReconciliationOverview() {
  const [report, setReport] = useState<Reconciliation | null>(null);
  const [vehicles, setVehicles] = useState<VehicleStages | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([fetch('/api/management/zmcc-reconciliation?pageSize=8'), fetch('/api/management/vehicle-stages?exceptionOnly=true&pageSize=8')])
      .then(async ([reconciliationResponse, vehicleResponse]) => {
        const [reconciliation, stages] = await Promise.all([reconciliationResponse.json(), vehicleResponse.json()]);
        if (!reconciliationResponse.ok) throw new Error(reconciliation.error || 'Unable to load MPD reconciliation.');
        if (!vehicleResponse.ok) throw new Error(stages.error || 'Unable to load MPD operational exceptions.');
        setReport(reconciliation); setVehicles(stages);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load MPD overview.'));
  }, []);

  return (
    <div className="space-y-6">
      {/* 3-Tier Supply Chain Loss Hierarchy Card */}
      <SupplyChainLossCard />

      {error ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          MPD overview unavailable: {error}
        </section>
      ) : !report || !vehicles ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Loading MPD operational exceptions...
        </section>
      ) : (
        <section className="space-y-3" aria-label="MPD reconciliation overview">
          <div>
            <h2 className="text-lg font-black text-slate-900">MPD Reconciliation Overview</h2>
            <p className="text-sm text-slate-500">
              Cross-source MOT-to-ZMCC result. Pending journeys are shown separately and are not counted as finalized loss.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-bold text-slate-500">13TS loss / gain</p>
              <p className="mt-1 text-lg font-black">
                {number(report.summary.at13tsLossLiters)} / {number(report.summary.at13tsGainLiters)} L
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-bold text-slate-500">Gross loss / gain</p>
              <p className="mt-1 text-lg font-black">
                {number(report.summary.grossLossLiters)} / {number(report.summary.grossGainLiters)} L
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-bold text-slate-500">Finalized journeys</p>
              <p className="mt-1 text-lg font-black">{report.summary.finalizedJourneys}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-bold text-slate-500">Unresolved exposure</p>
              <p className="mt-1 text-lg font-black">
                {report.summary.unresolvedJourneys} journeys · {number(report.summary.unresolvedOriginAt13tsLiters)} L
              </p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-4 text-sm">
              <p className="font-black">Latest MOT-to-ZMCC journeys</p>
              {report.items.length ? (
                report.items.map((item) => (
                  <p key={item.journeyId} className="mt-2 text-slate-600">
                    {item.source.code} · {item.route.code} · {item.journeyNumber} · {item.vehicleNumber} · {item.isResolved ? 'finalized' : 'unresolved'}
                  </p>
                ))
              ) : (
                <p className="mt-2 text-slate-500">No completed MOT journeys in this period.</p>
              )}
            </div>
            <div className="rounded-xl border bg-white p-4 text-sm">
              <p className="font-black">Vehicle exceptions ({vehicles.total})</p>
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
