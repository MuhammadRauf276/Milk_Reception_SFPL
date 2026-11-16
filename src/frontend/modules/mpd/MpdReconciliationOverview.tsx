'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { ErrorState } from '@/components/ui/empty-state';
import { InfoTip } from '@/components/ui/info-tip';
import { Pagination, useListPageSize } from '@/components/ui/pagination';
import { formatLossGain, formatLossGainPercent, lossGainClass } from '@/lib/lossGain';
import { WholeLossCard } from '@/frontend/modules/dashboard/components/WholeLossCard';

type Reconciliation = { total: number; totalPages: number; summary: { finalizedJourneys: number; unresolvedJourneys: number; grossLossLiters: number; grossGainLiters: number; at13tsLossLiters: number; at13tsGainLiters: number; grossNetLiters: number; at13tsNetLiters: number; grossNetPercent: number | null; at13tsNetPercent: number | null; unresolvedOriginAt13tsLiters: number }; items: Array<{ journeyId: string; journeyNumber: string; source: { code: string; name: string }; route: { code: string }; vehicleNumber: string; isResolved: boolean }> };
type VehicleStages = { total: number; items: Array<{ visitId: string; vehicleNumber: string; source: { code: string }; route: { name: string } | null; stage: string; exception: { kind: string } | null }> };

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function MpdReconciliationOverview() {
  const pageSize = useListPageSize(25);
  const [reconPage, setReconPage] = useState(1);
  const [stagePage, setStagePage] = useState(1);

  const reconQuery = useQuery({
    queryKey: ['mpd', 'reconciliation-overview', 'recon', reconPage, pageSize],
    queryFn: ({ signal }) =>
      fetchJson<Reconciliation>(`/api/management/zmcc-reconciliation?page=${reconPage}&pageSize=${pageSize}`, { signal }),
    placeholderData: keepPreviousData,
  });

  const stageQuery = useQuery({
    queryKey: ['mpd', 'reconciliation-overview', 'stages', stagePage, pageSize],
    queryFn: ({ signal }) =>
      fetchJson<VehicleStages>(`/api/management/vehicle-stages?exceptionOnly=true&page=${stagePage}&pageSize=${pageSize}`, { signal }),
    placeholderData: keepPreviousData,
  });

  const report = reconQuery.data ?? null;
  const vehicles = stageQuery.data ?? null;
  const rawError = reconQuery.error ?? stageQuery.error;
  const error = rawError ? (rawError instanceof Error ? rawError.message : 'Unable to load MPD overview.') : null;

  return (
    <div className="space-y-6">
      {/* Whole Loss / Gain card */}
      <WholeLossCard />

      {error ? (
        <ErrorState description={error} onRetry={() => { void reconQuery.refetch(); void stageQuery.refetch(); }} />
      ) : !report || !vehicles ? (
        <section className="bg-card border-border rounded-2xl border p-4 text-sm text-muted-foreground">
          Loading MPD operational exceptions…
        </section>
      ) : (
        <section className="space-y-3" aria-label="MPD reconciliation overview">
          <div>
            <h2 className="inline-flex items-center text-lg font-semibold text-foreground">Reconciliation<InfoTip text="Mobile Tester to ZMCC result. Pending journeys are not counted as loss." /></h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="text-xs font-semibold text-muted-foreground">Loss / Gain @13% TS</p>
              <p className={`mt-1 text-lg font-semibold ${lossGainClass(report.summary.at13tsNetLiters)}`}>
                {formatLossGain(report.summary.at13tsNetLiters)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {report.summary.at13tsNetPercent != null ? `${formatLossGainPercent(report.summary.at13tsNetPercent)} · ` : ''}
                Loss {number(report.summary.at13tsLossLiters)} L · Gain {number(report.summary.at13tsGainLiters)} L
              </p>
            </div>
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="text-xs font-semibold text-muted-foreground">Loss / Gain gross</p>
              <p className={`mt-1 text-lg font-semibold ${lossGainClass(report.summary.grossNetLiters)}`}>
                {formatLossGain(report.summary.grossNetLiters)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {report.summary.grossNetPercent != null ? `${formatLossGainPercent(report.summary.grossNetPercent)} · ` : ''}
                Loss {number(report.summary.grossLossLiters)} L · Gain {number(report.summary.grossGainLiters)} L
              </p>
            </div>
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="text-xs font-semibold text-muted-foreground">Finalized journeys</p>
              <p className="mt-1 text-lg font-semibold">{report.summary.finalizedJourneys}</p>
            </div>
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="text-xs font-semibold text-muted-foreground">Unresolved exposure</p>
              <p className="mt-1 text-lg font-semibold">
                {report.summary.unresolvedJourneys} journeys · {number(report.summary.unresolvedOriginAt13tsLiters)} L
              </p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="bg-card border-border rounded-2xl border p-4 text-sm flex flex-col justify-between gap-3">
              <div>
                <p className="font-semibold">Latest Mobile Tester-to-ZMCC journeys</p>
                {report.items.length ? (
                  report.items.map((item) => (
                    <p key={item.journeyId} className="mt-2 text-secondary-foreground">
                      {item.source.code} · {item.route.code} · {item.journeyNumber} · {item.vehicleNumber} · {item.isResolved ? 'finalized' : 'unresolved'}
                    </p>
                  ))
                ) : (
                  <p className="mt-2 text-muted-foreground">No journeys</p>
                )}
              </div>
              <Pagination
                page={reconPage}
                totalPages={report.totalPages ?? Math.max(1, Math.ceil((report.total ?? report.items.length) / pageSize))}
                totalRecords={report.total ?? report.items.length}
                pageSize={pageSize}
                noun="journeys"
                disabled={reconQuery.isFetching}
                onPageChange={setReconPage}
                className="border-t border-border px-0 pt-2 pb-0"
              />
            </div>
            <div className="bg-card border-border rounded-2xl border p-4 text-sm flex flex-col justify-between gap-3">
              <div>
                <p className="font-semibold">Vehicle exceptions ({vehicles.total})</p>
                {vehicles.items.length ? (
                  vehicles.items.map((item) => (
                    <p key={item.visitId} className="mt-2 text-secondary-foreground">
                      {item.source.code} · {item.vehicleNumber} · {item.stage}
                      {item.exception ? ` · ${item.exception.kind}` : ''}
                    </p>
                  ))
                ) : (
                  <p className="mt-2 text-muted-foreground">No active vehicle exceptions.</p>
                )}
              </div>
              <Pagination
                page={stagePage}
                totalPages={Math.max(1, Math.ceil((vehicles.total ?? vehicles.items.length) / pageSize))}
                totalRecords={vehicles.total ?? vehicles.items.length}
                pageSize={pageSize}
                noun="exceptions"
                disabled={stageQuery.isFetching}
                onPageChange={setStagePage}
                className="border-t border-border px-0 pt-2 pb-0"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
