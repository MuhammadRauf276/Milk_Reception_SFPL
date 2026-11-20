'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, Download, Loader2 } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { InfoTip } from '@/components/ui/info-tip';
import { ErrorPopup } from '@/components/ui/error-popup';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import type { LossFilterOptions } from '@/backend/modules/management-reporting/lossLevelContracts';
import type {
  StageChainReport,
  StageCycle,
  StageDay,
  StageDrillReport,
  StageHcRow,
  StageMotRow,
  StagePair,
  StageTanker,
  StageTotal,
  StageZmccRow,
} from '@/backend/modules/management-reporting/stageChainContracts';
import { Signed, formatLitres } from './LossLevelCards';
import { RankedBarsChart, STAGE_COLORS } from './StageCharts';
import { lossQueryParams, type LossFilters } from '../lossFilters';

type StageKey = 'ALL' | 'SHOPS' | 'INTAKE' | 'DISPATCH' | 'PLANT';
type ViewKey = 'ZMCC' | 'DAY' | 'TESTER' | 'ROUTE' | 'HC' | 'TANKER';

const STAGES: Array<{ value: StageKey; label: string }> = [
  { value: 'ALL', label: 'All stages' },
  { value: 'SHOPS', label: 'Shops' },
  { value: 'INTAKE', label: 'ZMCC intake' },
  { value: 'DISPATCH', label: 'ZMCC dispatch' },
  { value: 'PLANT', label: 'Plant' },
];
const VIEWS: Array<{ value: ViewKey; label: string }> = [
  { value: 'ZMCC', label: 'ZMCC' },
  { value: 'DAY', label: 'Day' },
  { value: 'TESTER', label: 'Mobile Tester' },
  { value: 'ROUTE', label: 'Route' },
  { value: 'HC', label: 'HC supplier' },
  { value: 'TANKER', label: 'Tanker' },
];

const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const pctText = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function motColumns(kind: 'TESTER' | 'ROUTE'): Array<DataColumn<StageMotRow>> {
  return [
    {
      key: 'name',
      header: kind === 'TESTER' ? 'Mobile Tester' : 'Route',
      primary: true,
      cell: (r) => (
        <span className="font-medium">
          {r.name}
          {r.code ? <span className="ml-1 text-xs font-normal text-muted-foreground">{r.code}</span> : null}
        </span>
      ),
    },
    { key: 'zmcc', header: 'ZMCC', cardAlways: true, cell: (r) => r.zmccName },
    {
      key: 'journeys',
      header: 'Journeys',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {r.journeys}
          {r.notArrived ? <span className="text-orange-700"> · {r.notArrived} on the way</span> : null}
        </span>
      ),
    },
    {
      key: 'shops',
      header: 'Shops',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {r.shops}
          {r.rejectedShops ? <span className="text-rose-700"> · {r.rejectedShops} rejected</span> : null}
        </span>
      ),
    },
    { key: 'col', header: 'Collected @13 TS', align: 'right', cell: (r) => L(r.collected.at13ts) },
    { key: 'rec', header: 'Received @13 TS', align: 'right', cell: (r) => L(r.received.at13ts) },
    { key: 'ts', header: 'TS shops / received', align: 'right', cell: (r) => <span className="tabular-nums">{ts(r.ts.collected)} / {ts(r.ts.received)}</span> },
    { key: 'trip', header: 'Trip @13 TS', align: 'right', cell: (r) => <Signed value={r.trip.at13ts} /> },
    {
      key: 'pct',
      header: 'Trip %',
      align: 'right',
      cell: (r) =>
        r.received.at13ts ? (
          <span className={`tabular-nums ${r.trip.at13ts < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{pctText(pct(r.trip.at13ts, r.received.at13ts - r.trip.at13ts))}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}

const hcColumns: Array<DataColumn<StageHcRow>> = [
  {
    key: 'name',
    header: 'HC supplier',
    primary: true,
    cell: (r) => (
      <span className="font-medium">
        {r.name}
        {r.code ? <span className="ml-1 text-xs font-normal text-muted-foreground">{r.code}</span> : null}
      </span>
    ),
  },
  { key: 'zmcc', header: 'ZMCC', cardAlways: true, cell: (r) => r.zmccName },
  { key: 'arrivals', header: 'Arrivals', align: 'right', cell: (r) => <span className="tabular-nums">{r.arrivals}</span> },
  { key: 'accepted', header: 'Accepted', align: 'right', cell: (r) => <span className="tabular-nums">{r.accepted}</span> },
  { key: 'rejected', header: 'Rejected', align: 'right', cell: (r) => <span className={`tabular-nums ${r.rejected ? 'text-rose-700' : ''}`}>{r.rejected}</span> },
  { key: 'left', header: 'Left early', align: 'right', cell: (r) => <span className={`tabular-nums ${r.leftEarly ? 'text-orange-700' : ''}`}>{r.leftEarly}</span> },
  { key: 'l', header: 'Received litres', align: 'right', cell: (r) => L(r.received.liters) },
  { key: 'a13', header: 'Received @13 TS', align: 'right', cell: (r) => L(r.received.at13ts) },
  { key: 'ts', header: 'TS', align: 'right', cell: (r) => <span className="tabular-nums">{ts(r.ts)}</span> },
];

type TankerRow = StageTanker & { day: string; zmccName: string; tankTs: number | null };
const tankerColumns: Array<DataColumn<TankerRow>> = [
  { key: 'tanker', header: 'Tanker', primary: true, cell: (t) => <span className="font-medium">{t.vehicleNumber ?? '—'}</span> },
  { key: 'day', header: 'Day', cardAlways: true, cell: (t) => <span className="tabular-nums">{t.day}</span> },
  { key: 'visit', header: 'Visit', cell: (t) => <span className="tabular-nums">{t.visitNumber ?? '—'}</span> },
  { key: 'zmcc', header: 'ZMCC', cell: (t) => t.zmccName },
  { key: 'dl', header: 'Dispatched', align: 'right', cell: (t) => L(t.dispatch.liters) },
  { key: 'd13', header: 'Dispatch @13 TS', align: 'right', cell: (t) => L(t.dispatch.at13ts) },
  { key: 'pl', header: 'Plant litres', align: 'right', cell: (t) => (t.plant ? L(t.plant.liters) : <span className="text-muted-foreground">Pending</span>) },
  {
    key: 'ts',
    header: 'TS tank / dispatch / plant',
    align: 'right',
    cell: (t) => (
      <span className="tabular-nums">
        {ts(t.tankTs)} / <span className={t.ts.dispatch != null && t.tankTs != null && t.ts.dispatch > t.tankTs + 0.02 ? 'font-semibold text-orange-700' : ''}>{ts(t.ts.dispatch)}</span> / {ts(t.ts.plant)}
      </span>
    ),
  },
  { key: 'over', header: 'Overstated', align: 'right', cell: (t) => <Over v={t.overstated13ts} /> },
  { key: 'roadL', header: 'Road litres', align: 'right', cell: (t) => (t.road ? <Signed value={t.road.liters} /> : '—') },
  { key: 'road', header: 'Road @13 TS', align: 'right', cell: (t) => (t.road ? <Signed value={t.road.at13ts} /> : '—') },
];

const INFO = {
  shops: 'Milk the Mobile Testers collected from shops (accepted).',
  intake: 'Milk received into the ZMCC tanks with the ZMCC lab tests: from Mobile Testers (MC) and from HC suppliers.',
  dispatch: 'What the ZMCC dispatched to the plant: litres, and @13 TS from the dispatch test.',
  plant: 'What the plant received: weighbridge net weight with the plant test. Tankers not yet received are left out.',
  motTrip: 'Received at the ZMCC from Mobile Testers minus collected from shops.',
  overstated: 'ZMCC dispatch @13 TS minus the same litres at the quality of the milk in the tank. Plus means the dispatch claims more solids than the milk had. A recording difference, not milk.',
  road: 'Plant received minus what really left the ZMCC (the dispatched litres at the tank milk quality). The real loss or gain on the road.',
  whole: 'Shops and HC to plant: the Mobile Tester trip plus the road. Dispatch overstated is not part of it.',
  ts: 'Milk quality (TS = Fat + SNF). Intake and plant should agree; a higher dispatch TS means the dispatch test is written high.',
  lpd: 'LPD: litres per day, the period total divided by its days.',
  compare: 'Change against the same number of days just before this period.',
};

const L = (n: number | null | undefined) => <span className="tabular-nums">{formatLitres(n)}</span>;
const ts = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const Over = ({ v }: { v: number }) => (
  <span className="tabular-nums text-secondary-foreground">
    {v > 0 ? '+' : ''}
    {formatLitres(v)}
  </span>
);
const intakeOf = (r: Pick<StageTotal, 'receivedMot' | 'receivedHc' | 'receivedOther'>): StagePair => ({
  liters: r.receivedMot.liters + r.receivedHc.liters + r.receivedOther.liters,
  at13ts: r.receivedMot.at13ts + r.receivedHc.at13ts + r.receivedOther.at13ts,
});
const hcOf = (r: Pick<StageTotal, 'receivedHc'>): StagePair => r.receivedHc;
/** MC, HC and, only when there is some, other tank receipts (not from an arrival). */
const intakeParts = (r: Pick<StageTotal, 'receivedMot' | 'receivedHc' | 'receivedOther'>) => [
  { label: 'MC', value: r.receivedMot },
  { label: 'HC', value: r.receivedHc },
  ...(r.receivedOther.liters ? [{ label: 'Other', value: r.receivedOther }] : []),
];

function stageValue(stage: Exclude<StageKey, 'ALL'>, r: StageTotal): { pair: StagePair; ts: number | null } {
  if (stage === 'SHOPS') return { pair: r.shops, ts: r.shops.liters > 0 ? (r.shops.at13ts * 13) / r.shops.liters : null };
  if (stage === 'INTAKE') return { pair: intakeOf(r), ts: r.ts.intake };
  if (stage === 'DISPATCH') return { pair: r.dispatchSlip, ts: r.ts.slip };
  return { pair: r.plant, ts: r.ts.plant };
}

function dayValue(stage: Exclude<StageKey, 'ALL'>, d: StageDay): { pair: StagePair; ts: number | null } {
  if (stage === 'SHOPS') return { pair: d.shops, ts: d.shops.liters > 0 ? (d.shops.at13ts * 13) / d.shops.liters : null };
  if (stage === 'INTAKE') return { pair: d.intake, ts: d.ts.intake };
  if (stage === 'DISPATCH') return { pair: d.dispatchSlip, ts: d.ts.slip };
  return { pair: d.plant, ts: d.ts.plant };
}

const STAGE_INFO: Record<Exclude<StageKey, 'ALL'>, string> = { SHOPS: INFO.shops, INTAKE: INFO.intake, DISPATCH: INFO.dispatch, PLANT: INFO.plant };

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-muted-foreground">—</span>;
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(pct) < 0.05) return <span className="text-muted-foreground">0%</span>;
  return (
    <span className={`tabular-nums ${pct > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function StageCard(props: {
  label: string;
  info: string;
  value: StagePair;
  before: StagePair;
  days: number;
  tsValue?: number | null;
  parts?: Array<{ label: string; value: StagePair }>;
}) {
  const { label, info, value, before, days, tsValue, parts } = props;
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-border bg-card p-3 shadow-2xs">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        {label}
        <InfoTip text={info} className="-my-2" />
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{formatLitres(value.at13ts)}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        @13 TS · {formatLitres(value.liters)} litres{tsValue != null ? ` · TS ${ts(tsValue)}` : ''}
      </p>
      {parts?.length ? (
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-secondary-foreground">
          {parts.map((p) => (
            <span key={p.label}>
              {p.label} {formatLitres(p.value.at13ts)}
            </span>
          ))}
        </p>
      ) : null}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs tabular-nums">
        <span className="text-secondary-foreground">LPD {formatLitres(days > 0 ? value.liters / days : null)}</span>
        <Change now={value.liters} before={before.liters} />
      </p>
    </div>
  );
}

function Step({ label, info, value, neutral }: { label: string; info: string; value: number | null | undefined; neutral?: boolean }) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-center justify-center px-1 text-center">
      <ArrowRight className="hidden h-4 w-4 text-muted-foreground xl:block" aria-hidden="true" />
      <p className="flex items-center gap-0.5 text-xs text-muted-foreground">
        {label}
        <InfoTip text={info} className="-my-2" />
      </p>
      <p className="text-xs font-semibold">{neutral ? <Over v={value ?? 0} /> : <Signed value={value} />}</p>
    </div>
  );
}

function Chain({ report }: { report: StageChainReport }) {
  const row = report.total;
  const prev = report.previous.total;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-stretch">
        <StageCard label="Shops" info={INFO.shops} value={row.shops} before={prev.shops} days={report.days} />
        <Step label="Tester trip" info={INFO.motTrip} value={row.loss.motTrip.at13ts} />
        <StageCard
          label="ZMCC intake"
          info={INFO.intake}
          value={intakeOf(row)}
          before={intakeOf(prev)}
          days={report.days}
          tsValue={row.ts.intake}
          parts={intakeParts(row)}
        />
        <Step label="Dispatch overstated" info={INFO.overstated} value={row.loss.slipOver13ts} neutral />
        <StageCard label="ZMCC dispatch" info={INFO.dispatch} value={row.dispatchSlip} before={prev.dispatchSlip} days={report.days} tsValue={row.ts.slip} />
        <Step label="Road" info={INFO.road} value={row.loss.road.at13ts} />
        <StageCard label="Plant" info={INFO.plant} value={row.plant} before={prev.plant} days={report.days} tsValue={row.ts.plant} />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-border bg-subtle px-3 py-2 text-xs">
        <span className="flex items-center gap-1">
          <span className="font-semibold">Whole loss / gain</span>
          <InfoTip text={INFO.whole} className="-my-2" />
          <Signed value={row.loss.whole.at13ts} /> <span className="text-muted-foreground">@13 TS</span>
        </span>
        <span className="text-muted-foreground">
          Litres: <Signed value={row.loss.whole.liters} />
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          Before: <Signed value={prev.loss.whole.at13ts} />
          <InfoTip text={`${INFO.compare} ${report.previous.from} to ${report.previous.to}.`} className="-my-2" />
        </span>
        <span className="text-muted-foreground tabular-nums">
          Dispatch TS above tank milk: {row.slipHighCycles} of {row.cycleCount} dispatches
        </span>
        {row.pendingTankers > 0 ? <span className="text-muted-foreground">Not yet at plant: {row.pendingTankers}</span> : null}
      </div>
    </div>
  );
}

const cycleColumns: Array<DataColumn<StageCycle>> = [
  { key: 'day', header: 'Day', primary: true, cell: (c) => <span className="tabular-nums">{c.day.slice(5)}</span> },
  { key: 'tankers', header: 'Tanker', cardAlways: true, cell: (c) => c.tankers.map((t) => t.vehicleNumber ?? t.visitNumber).join(' + ') },
  { key: 'intake', header: 'Intake', label: 'Intake', align: 'right', cell: (c) => L(c.intake.liters) },
  { key: 'dispatch', header: 'Dispatched', align: 'right', cell: (c) => L(c.dispatchSlip.liters) },
  { key: 'plant', header: 'Plant', align: 'right', cell: (c) => (c.plant ? L(c.plant.liters) : <span className="text-muted-foreground">Pending</span>) },
  { key: 'left', header: 'Left in tank', align: 'right', cell: (c) => L(c.leftInTank.liters) },
  {
    key: 'ts',
    header: (
      <span className="inline-flex items-center gap-1">
        TS tank / dispatch / plant
        <InfoTip text={INFO.ts} className="-my-2" />
      </span>
    ),
    label: 'TS tank / dispatch / plant',
    align: 'right',
    cell: (c) => (
      <span className="tabular-nums">
        {ts(c.ts.tank)} / <span className={c.ts.slip != null && c.ts.tank != null && c.ts.slip > c.ts.tank + 0.02 ? 'font-semibold text-orange-700' : ''}>{ts(c.ts.slip)}</span> / {ts(c.ts.plant)}
      </span>
    ),
  },
  { key: 'over', header: 'Overstated', align: 'right', cell: (c) => <Over v={c.slipOver13ts} /> },
  { key: 'road', header: 'Road @13 TS', align: 'right', cell: (c) => (c.road ? <Signed value={c.road.at13ts} /> : '—') },
];

function allDayColumns(): Array<DataColumn<StageDay>> {
  return [
    { key: 'day', header: 'Day', primary: true, cell: (d) => <span className="tabular-nums">{d.day}</span> },
    { key: 'shops', header: 'Shops @13 TS', align: 'right', cell: (d) => L(d.shops.at13ts) },
    { key: 'mc', header: 'MC intake @13 TS', align: 'right', cell: (d) => L(d.intakeMc.at13ts) },
    { key: 'hc', header: 'HC intake @13 TS', align: 'right', cell: (d) => L(d.intakeHc.at13ts) },
    { key: 'dispatch', header: 'Dispatch @13 TS', align: 'right', cell: (d) => L(d.dispatchSlip.at13ts) },
    { key: 'plant', header: 'Plant @13 TS', align: 'right', cell: (d) => L(d.plant.at13ts) },
    { key: 'ts', header: 'TS in / dispatch / plant', align: 'right', cell: (d) => <span className="tabular-nums">{ts(d.ts.intake)} / {ts(d.ts.slip)} / {ts(d.ts.plant)}</span> },
    { key: 'over', header: 'Overstated', align: 'right', cell: (d) => (d.slipOver13ts ? <Over v={d.slipOver13ts} /> : '—') },
    { key: 'road', header: 'Road', align: 'right', cell: (d) => (d.plant.liters ? <Signed value={d.road.at13ts} /> : '—') },
  ];
}

function oneStageDayColumns(stage: Exclude<StageKey, 'ALL'>): Array<DataColumn<StageDay>> {
  return [
    { key: 'day', header: 'Day', primary: true, cell: (d) => <span className="tabular-nums">{d.day}</span> },
    { key: 'l', header: 'Litres', align: 'right', cell: (d) => L(dayValue(stage, d).pair.liters) },
    { key: 'a13', header: '@13 TS', align: 'right', cell: (d) => L(dayValue(stage, d).pair.at13ts) },
    ...(stage === 'INTAKE'
      ? [
          { key: 'mc', header: 'MC @13 TS', align: 'right' as const, cell: (d: StageDay) => L(d.intakeMc.at13ts) },
          { key: 'hc', header: 'HC @13 TS', align: 'right' as const, cell: (d: StageDay) => L(d.intakeHc.at13ts) },
        ]
      : []),
    { key: 'ts', header: 'TS', align: 'right', cell: (d) => <span className="tabular-nums">{ts(dayValue(stage, d).ts)}</span> },
  ];
}

export function StageChainPanel({
  filters,
}: {
  filters: LossFilters;
  /** Kept for the callers; the charts (and their filters) now live on the Visuals page. */
  onFiltersChange?: (next: LossFilters) => void;
  options?: LossFilterOptions;
  zmccLocked?: boolean;
}) {
  const qs = lossQueryParams(filters).toString();
  const [stage, setStage] = useState<StageKey>('ALL');
  const [view, setView] = useState<ViewKey>('ZMCC');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const query = useQuery<StageChainReport>({
    queryKey: ['loss', 'stages', qs],
    queryFn: ({ signal }) =>
      fetchJson<{ report: StageChainReport }>(
        `/api/management/reports/loss-reconciliation/stages?${qs}`,
        { headers: { Accept: 'application/json' }, signal },
        'Stage by stage figures could not be loaded.'
      ).then((b) => b.report),
    placeholderData: keepPreviousData,
  });
  const report = query.data;
  const days = report?.days ?? 1;
  const drillLevel = view === 'TESTER' || view === 'ROUTE' || view === 'HC' ? view : null;
  const drillQuery = useQuery<StageDrillReport>({
    queryKey: ['loss', 'stages', 'drill', drillLevel, qs],
    queryFn: ({ signal }) =>
      fetchJson<{ drill: StageDrillReport }>(
        `/api/management/reports/loss-reconciliation/stages/drill?level=${drillLevel}&${qs}`,
        { headers: { Accept: 'application/json' }, signal },
        'These figures could not be loaded.'
      ).then((b) => b.drill),
    enabled: drillLevel != null,
    placeholderData: keepPreviousData,
  });
  const drill = drillLevel && drillQuery.data?.level === drillLevel ? drillQuery.data : undefined;
  const tankerRows: TankerRow[] = (report?.zmccs ?? []).flatMap((z) =>
    z.cycles.flatMap((c) => c.tankers.map((t) => ({ ...t, day: c.day, zmccName: z.zmccName, tankTs: c.ts.tank })))
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportExcel = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/management/reports/loss-reconciliation/stages/export?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'The Excel file could not be made.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `milk-stages-${report?.from ?? ''}-to-${report?.to ?? ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'The Excel file could not be made.');
    } finally {
      setExporting(false);
    }
  };

  const allZmccColumns: Array<DataColumn<StageZmccRow>> = [
    { key: 'zmcc', header: 'ZMCC', primary: true, cell: (z) => <span className="font-medium">{z.zmccName}</span> },
    { key: 'shops', header: 'Shops @13 TS', align: 'right', cell: (z) => L(z.shops.at13ts) },
    { key: 'mc', header: 'MC intake @13 TS', align: 'right', cell: (z) => L(z.receivedMot.at13ts) },
    { key: 'hc', header: 'HC intake @13 TS', align: 'right', cell: (z) => L(hcOf(z).at13ts) },
    { key: 'dispatch', header: 'Dispatch @13 TS', align: 'right', cell: (z) => L(z.dispatchSlip.at13ts) },
    { key: 'plant', header: 'Plant @13 TS', align: 'right', cell: (z) => L(z.plant.at13ts) },
    { key: 'lpd', header: 'Intake LPD', align: 'right', cell: (z) => L(intakeOf(z).liters / days) },
    { key: 'ts', header: 'TS in / dispatch / plant', align: 'right', cell: (z) => <span className="tabular-nums">{ts(z.ts.intake)} / {ts(z.ts.slip)} / {ts(z.ts.plant)}</span> },
    { key: 'trip', header: 'Tester trip', align: 'right', cell: (z) => <Signed value={z.loss.motTrip.at13ts} /> },
    { key: 'over', header: 'Overstated', align: 'right', cell: (z) => <Over v={z.loss.slipOver13ts} /> },
    { key: 'road', header: 'Road', align: 'right', cell: (z) => <Signed value={z.loss.road.at13ts} /> },
    { key: 'whole', header: 'Whole', align: 'right', cell: (z) => <Signed value={z.loss.whole.at13ts} /> },
  ];
  const oneZmccColumns = (s: Exclude<StageKey, 'ALL'>): Array<DataColumn<StageZmccRow>> => [
    { key: 'zmcc', header: 'ZMCC', primary: true, cell: (z) => <span className="font-medium">{z.zmccName}</span> },
    { key: 'l', header: 'Litres', align: 'right', cell: (z) => L(stageValue(s, z).pair.liters) },
    { key: 'a13', header: '@13 TS', align: 'right', cell: (z) => L(stageValue(s, z).pair.at13ts) },
    ...(s === 'INTAKE'
      ? [
          { key: 'mc', header: 'MC @13 TS', align: 'right' as const, cell: (z: StageZmccRow) => L(z.receivedMot.at13ts) },
          { key: 'hc', header: 'HC @13 TS', align: 'right' as const, cell: (z: StageZmccRow) => L(hcOf(z).at13ts) },
        ]
      : []),
    { key: 'ts', header: 'TS', align: 'right', cell: (z) => <span className="tabular-nums">{ts(stageValue(s, z).ts)}</span> },
    { key: 'lpd', header: 'LPD', align: 'right', cell: (z) => L(stageValue(s, z).pair.liters / days) },
  ];
  const inspect: DataColumn<StageZmccRow> = {
    key: 'inspect',
    header: '',
    actions: true,
    cell: (z) => (
      <button
        type="button"
        onClick={() => toggle(z.zmccId)}
        aria-expanded={open.has(z.zmccId)}
        className="min-h-11 rounded-lg border border-border px-3 text-xs font-semibold text-secondary-foreground hover:bg-muted"
      >
        {open.has(z.zmccId) ? 'Close' : 'Inspect'}
      </button>
    ),
  };
  const zmccColumns = [...(stage === 'ALL' ? allZmccColumns : oneZmccColumns(stage)), inspect];
  const dayColumns = stage === 'ALL' ? allDayColumns() : oneStageDayColumns(stage);
  // A day is listed when the chosen stage (or, for all stages, any stage) has milk that day.
  const hasMilk = (d: StageDay) =>
    stage === 'ALL' ? !!(d.shops.liters || d.intake.liters || d.dispatchSlip.liters || d.plant.liters) : dayValue(stage, d).pair.liters > 0;

  return (
    <div className={`space-y-3 ${query.isFetching ? 'opacity-60' : ''}`}>
      <ErrorPopup message={query.isError ? query.error.message || 'Stage by stage figures could not be loaded.' : null} onRetry={() => void query.refetch()} />
      <ErrorPopup message={exportError} onClear={() => setExportError(null)} />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 max-w-full">
          <SegmentedTabs tabs={STAGES} value={stage} onValueChange={setStage} label="Stage" mobileOnly={false} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs tabs={VIEWS} value={view} onValueChange={setView} label="View" mobileOnly={false} />
          <button
            type="button"
            onClick={() => void exportExcel()}
            disabled={exporting || !report}
            className="flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
            Excel
          </button>
        </div>
      </div>

      {report ? (
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {report.from} to {report.to} · {report.days} {report.days === 1 ? 'day' : 'days'} · {report.basis === 'business' ? 'Business day (08:00 to 08:00)' : 'Calendar day'}
          </span>
          <span className="inline-flex items-center gap-1">
            LPD <InfoTip text={INFO.lpd} className="-my-2" />
          </span>
        </p>
      ) : null}

      {report ? (
        stage === 'ALL' ? (
          <Chain report={report} />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StageCard
              label={STAGES.find((x) => x.value === stage)!.label}
              info={STAGE_INFO[stage]}
              value={stageValue(stage, report.total).pair}
              before={stageValue(stage, report.previous.total).pair}
              days={report.days}
              tsValue={stageValue(stage, report.total).ts}
              parts={stage === 'INTAKE' ? intakeParts(report.total) : undefined}
            />
          </div>
        )
      ) : (
        <div className="h-36 animate-pulse rounded-2xl bg-muted" />
      )}

      <Link href={`/visuals?${qs}`} className="inline-flex min-h-10 items-center text-xs font-semibold text-primary hover:underline">
        Charts: Visuals → ZMCC
      </Link>

      {view === 'ZMCC' ? (
        <DataTable
          columns={zmccColumns}
          rows={report?.zmccs ?? []}
          getRowId={(z) => z.zmccId}
          loading={query.isPending}
          noun="ZMCCs"
          emptyTitle="No ZMCC milk in this period"
          renderExpanded={(z) =>
            open.has(z.zmccId) ? (
              <div className="space-y-2 p-2">
                <p className="text-xs text-muted-foreground tabular-nums">
                  Tank at start {formatLitres(z.tankStart.liters)} · at end {formatLitres(z.tankEnd.liters)} · each row is one tank fill and its dispatch
                </p>
                <DataTable columns={cycleColumns} rows={z.cycles} getRowId={(c) => `${c.tankCode}-${c.day}-${c.tankers.map((t) => t.visitId).join('-')}`} noun="dispatches" pageSize={15} />
                <p className="pt-1 text-xs font-semibold text-foreground">By day</p>
                <DataTable columns={dayColumns} rows={z.daily.filter(hasMilk)} getRowId={(d) => d.day} noun="days" pageSize={15} />
              </div>
            ) : null
          }
        />
      ) : view === 'DAY' ? (
        <DataTable
          columns={dayColumns}
          rows={(report?.daily ?? []).filter(hasMilk)}
          getRowId={(d) => d.day}
          loading={query.isPending}
          noun="days"
          emptyTitle="No milk in this period"
          paginate
          pageSize={31}
        />
      ) : view === 'TANKER' ? (
        <div className="space-y-3">
          <RankedBarsChart
            title="Road loss / gain by tanker"
            info="@13 TS: plant received minus what really left the ZMCC, per tanker received at the plant. Worst first."
            signed
            format={(v) => formatLitres(v)}
            rows={tankerRows
              .filter((t) => t.road)
              .sort((a, b) => a.road!.at13ts - b.road!.at13ts)
              .map((t) => ({
                id: t.visitId,
                name: `${t.vehicleNumber ?? '—'} · ${t.day.slice(5)}`,
                value: t.road!.at13ts,
                tip: [
                  { label: 'Visit', value: t.visitNumber ?? '—' },
                  { label: 'Road litres', value: formatLitres(t.road!.liters) },
                  { label: 'Dispatch overstated', value: formatLitres(t.overstated13ts) },
                ],
              }))}
          />
          <DataTable columns={tankerColumns} rows={tankerRows} getRowId={(t) => t.visitId || `${t.day}-${t.vehicleNumber}`} loading={query.isPending} noun="tankers" emptyTitle="No tankers in this period" paginate pageSize={20} />
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorPopup message={drillQuery.isError ? drillQuery.error.message || 'These figures could not be loaded.' : null} onRetry={() => void drillQuery.refetch()} />
          {view === 'HC' ? (
            <>
              <RankedBarsChart
                title="Milk by HC supplier"
                info="@13 TS received into ZMCC tanks from each HC supplier, by arrival day."
                color={STAGE_COLORS.hc}
                format={(v) => formatLitres(v)}
                rows={(drill?.hcSuppliers ?? []).map((r) => ({
                  id: r.id,
                  name: r.name,
                  value: r.received.at13ts,
                  tip: [
                    { label: 'Arrivals', value: String(r.arrivals) },
                    { label: 'Rejected', value: String(r.rejected) },
                    { label: 'TS', value: ts(r.ts) },
                  ],
                }))}
              />
              <DataTable columns={hcColumns} rows={drill?.hcSuppliers ?? []} getRowId={(r) => r.id} loading={drillQuery.isPending} noun="HC suppliers" emptyTitle="No HC milk in this period" paginate pageSize={20} />
            </>
          ) : (
            <>
              <RankedBarsChart
                title={view === 'TESTER' ? 'Trip loss / gain by Mobile Tester' : 'Trip loss / gain by route'}
                info="Received at the ZMCC minus collected from shops, as a share of what was collected (@13 TS), by journey date. Journeys still on the way are left out. Worst first."
                signed
                percent
                format={(v) => pctText(v)}
                rows={((view === 'TESTER' ? drill?.testers : drill?.routes) ?? [])
                  .filter((r) => r.received.at13ts > 0)
                  .map((r) => ({
                    id: r.id,
                    name: r.name,
                    value: pct(r.trip.at13ts, r.received.at13ts - r.trip.at13ts),
                    tip: [
                      { label: 'Collected', value: formatLitres(r.collected.at13ts) },
                      { label: 'Received', value: formatLitres(r.received.at13ts) },
                      { label: 'Trip', value: formatLitres(r.trip.at13ts) },
                    ],
                  }))
                  .sort((a, b) => a.value - b.value)}
              />
              <DataTable
                columns={motColumns(view === 'TESTER' ? 'TESTER' : 'ROUTE')}
                rows={(view === 'TESTER' ? drill?.testers : drill?.routes) ?? []}
                getRowId={(r) => r.id}
                loading={drillQuery.isPending}
                noun={view === 'TESTER' ? 'Mobile Testers' : 'routes'}
                emptyTitle="No journeys in this period"
                paginate
                pageSize={20}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
