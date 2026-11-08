'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FlaskConical, Scale, Truck } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { formatMetric, NO_DATA } from '../format';
import type { MpdTabId } from '../types';
import type { DispatchVsPlantReport } from '@/backend/services/management/dispatchVsPlantReport';

interface Props {
  zmccId?: string;
  /** Opens one of the other Command Center views (used by the report guide). */
  onOpenTab?: (tab: MpdTabId) => void;
}

const REPORT_GUIDE: Array<{ tab: MpdTabId; title: string; about: string }> = [
  { tab: 'REPORTS', title: 'Report Studio and Ledgers', about: 'Build your own report from any field, or open the standard operational ledgers and export them.' },
  { tab: 'LOSS_DIAGNOSTICS', title: 'Supply Chain Loss', about: 'Litres and 13 TS lost between the shop, the ZMCC, the tanker and the plant.' },
  { tab: 'QUALITY_FUNNEL', title: 'Quality Screening', about: 'How much milk passes or fails the tests at each step.' },
  { tab: 'SOURCES', title: 'Sources and Silos', about: 'Intake by ZMCC and contractor, and what is in each silo.' },
  { tab: 'GOVERNANCE', title: 'Exception Desk', about: 'Decisions that went against the system recommendation.' },
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const Stat: React.FC<{ icon: React.ReactNode; label: string; dispatch: string; plant: string; variance: string; note?: string }> = ({ icon, label, dispatch, plant, variance, note }) => (
  <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-2">
    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-2 text-xs">
      <div>
        <p className="text-muted-foreground">ZMCC sent</p>
        <p className="text-sm font-semibold tabular-nums text-foreground">{dispatch}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Plant received</p>
        <p className="text-sm font-semibold tabular-nums text-foreground">{plant}</p>
      </div>
    </div>
    <p className="text-xs text-secondary-foreground">
      Difference: <span className="font-semibold tabular-nums">{variance}</span>
    </p>
    {note && <p className="text-xs text-muted-foreground">{note}</p>}
  </div>
);

const signed = (n: number | null | undefined, suffix = '') =>
  n === null || n === undefined ? NO_DATA : `${n > 0 ? '+' : ''}${n.toLocaleString()}${suffix}`;


type TestRow = DispatchVsPlantReport['tests'][number];
type TankerRow = DispatchVsPlantReport['rows'][number];

const R = 'right' as const;

export const MpdDispatchVsPlantScreen: React.FC<Props> = ({ zmccId, onOpenTab }) => {
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 6 * 86400000)));
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['management', 'dispatch-vs-plant', from, to, zmccId ?? ''],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ from, to });
      if (zmccId) qs.set('zmccId', zmccId);
      const json = await fetchJson<{ success?: boolean; data?: DispatchVsPlantReport; error?: string }>(
        `/api/management/reports/dispatch-vs-plant?${qs.toString()}`,
        { cache: 'no-store', signal }
      );
      if (!json.success || !json.data) throw new Error(json.error || 'Could not load the report.');
      return json.data;
    },
  });
  const report = query.data;
  const t = report?.totals;

  const testColumns: DataColumn<TestRow>[] = [
    {
      key: 'test',
      header: 'Test',
      label: 'Test',
      primary: true,
      cell: (r) => (
        <span className="font-medium text-foreground">
          {r.testName}
          {r.unit ? <span className="text-muted-foreground"> ({r.unit})</span> : null}
        </span>
      ),
    },
    { key: 'tankers', header: 'Tankers', label: 'Tankers', align: R, cell: (r) => <span className="tabular-nums">{r.vehicles}</span> },
    { key: 'sent', header: 'ZMCC sent', label: 'ZMCC sent', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.dispatchAvg)}</span> },
    { key: 'plant', header: 'Plant', label: 'Plant', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.plantAvg)}</span> },
    { key: 'diff', header: 'Difference', label: 'Difference', align: R, cell: (r) => <span className="tabular-nums font-semibold">{signed(r.deltaAvg)}</span> },
  ];

  const tankerColumns: DataColumn<TankerRow>[] = [
    {
      key: 'tanker',
      header: 'Tanker',
      label: 'Tanker',
      primary: true,
      cell: (r) => (
        <div className="font-medium text-foreground">
          <span className="inline-flex items-center gap-1">
            {open === r.visitId ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {r.vehicleNumber}
          </span>
          <span className="block text-xs text-muted-foreground ml-5">
            {r.operationalDate ?? NO_DATA} · {r.received ? 'Received' : 'Not received yet'}
          </span>
        </div>
      ),
    },
    { key: 'zmcc', header: 'ZMCC', label: 'ZMCC', cell: (r) => r.zmccName || r.zmccCode || NO_DATA },
    { key: 'sentL', header: 'Sent (L)', label: 'Sent (L)', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.dispatch.grossLiters)}</span> },
    { key: 'plantL', header: 'Plant (L)', label: 'Plant (L)', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.plant.grossLiters)}</span> },
    { key: 'plantKg', header: 'Plant (kg)', label: 'Plant (kg)', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.plant.netKg)}</span> },
    { key: 'ts13sent', header: '13 TS sent', label: '13 TS sent', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.dispatch.at13tsLiters)}</span> },
    { key: 'ts13plant', header: '13 TS plant', label: '13 TS plant', align: R, cell: (r) => <span className="tabular-nums">{formatMetric(r.plant.at13tsLiters)}</span> },
    { key: 'loss', header: 'Loss %', label: 'Loss %', align: R, cell: (r) => <span className="tabular-nums font-semibold">{signed(r.variance.grossPercent, '%')}</span> },
  ];

  return (
    <div className="space-y-6">
      {onOpenTab && (
        <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-3">
          <h2 className="text-xs font-semibold text-foreground">Reports in this Command Center</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {REPORT_GUIDE.map((g) => (
              <button
                key={g.tab}
                type="button"
                onClick={() => onOpenTab(g.tab)}
                className="text-left rounded-lg border border-border p-3 hover:border-primary/40 hover:bg-muted/40 transition"
              >
                <p className="text-xs font-semibold text-foreground">{g.title}</p>
                <p className="text-xs text-secondary-foreground mt-0.5">{g.about}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-secondary-foreground space-y-1">
          <span className="block">From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="block rounded-lg border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <label className="text-xs font-semibold text-secondary-foreground space-y-1">
          <span className="block">To</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="block rounded-lg border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <p className="text-xs text-muted-foreground pb-2">ZMCC tankers sent to the plant, and what the plant received.</p>
      </div>

      {query.error && (
        <div className="bg-card border border-border rounded-2xl p-4 text-xs font-semibold text-rose-800">{getErrorMessage(query.error)}</div>
      )}
      {query.isPending && <div className="bg-card border border-border rounded-2xl p-8 text-center text-xs text-muted-foreground">Loading report…</div>}

      {report && t && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Stat
              icon={<Truck className="w-4 h-4" />}
              label={`Volume (${t.received} of ${t.vehicles} tankers received)`}
              dispatch={formatMetric(t.dispatchGrossLiters, ' L')}
              plant={formatMetric(t.plantGrossLiters, ' L')}
              variance={signed(t.grossVarianceLiters, ' L')}
              note={t.notReceivedGrossLiters > 0 ? `${formatMetric(t.notReceivedGrossLiters, ' L')} sent but not received yet (not counted above)` : undefined}
            />
            <Stat
              icon={<FlaskConical className="w-4 h-4" />}
              label="13 TS litres"
              dispatch={formatMetric(t.dispatchAt13tsLiters, ' L')}
              plant={formatMetric(t.plantAt13tsLiters, ' L')}
              variance={signed(t.at13tsVarianceLiters, ' L')}
            />
            <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Scale className="w-4 h-4" />
                <span>Plant weight</span>
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground">{formatMetric(t.plantNetKg, ' kg')}</p>
              <p className="text-xs text-secondary-foreground">Net weight at the plant weighbridge for the received tankers.</p>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-foreground">Test-wise comparison (average per tanker)</h3>
            <DataTable
              columns={testColumns}
              rows={report.tests}
              getRowId={(r) => r.testId}
              emptyTitle="No tanker has numeric results on both sides in this period."
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-foreground">Tankers</h3>
            <DataTable
              columns={tankerColumns}
              rows={report.rows}
              getRowId={(r) => r.visitId}
              emptyTitle="No ZMCC tanker was dispatched in this period."
              onRowClick={(r) => setOpen(open === r.visitId ? null : r.visitId)}
              renderExpanded={(r) =>
                open === r.visitId ? (
                  <div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
                      {[
                        ['LR', r.dispatch.lr, r.plant.lr],
                        ['Fat %', r.dispatch.fat, r.plant.fat],
                        ['SNF %', r.dispatch.snf, r.plant.snf],
                        ['TS %', r.dispatch.ts, r.plant.ts],
                      ].map(([name, d, p]) => (
                        <div key={String(name)} className="rounded-lg border border-border bg-card p-2">
                          <p className="font-semibold text-foreground">{name}</p>
                          <p className="tabular-nums text-secondary-foreground">
                            Sent {formatMetric(d as number | null)} · Plant {formatMetric(p as number | null)}
                          </p>
                        </div>
                      ))}
                    </div>
                    {r.tests.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No test results were recorded for this tanker.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <tbody>
                          {r.tests.map((x) => (
                            <tr key={x.testId}>
                              <td className="py-1 pr-2 text-foreground">{x.testName}</td>
                              <td className="py-1 px-2 text-right tabular-nums">Sent {formatMetric(x.dispatch)}</td>
                              <td className="py-1 px-2 text-right tabular-nums">Plant {formatMetric(x.plant)}</td>
                              <td className="py-1 pl-2 text-right tabular-nums font-semibold">{signed(x.delta)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : null
              }
            />
          </section>
        </>
      )}
    </div>
  );
};
