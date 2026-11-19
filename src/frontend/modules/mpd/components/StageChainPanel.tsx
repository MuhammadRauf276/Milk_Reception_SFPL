'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { InfoTip } from '@/components/ui/info-tip';
import { ErrorPopup } from '@/components/ui/error-popup';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import type { StageChainReport, StageCycle, StagePair, StageZmccRow } from '@/backend/modules/management-reporting/stageChainContracts';
import { Signed, formatLitres } from './LossLevelCards';
import { lossQueryParams, type LossFilters } from '../lossFilters';

const INFO = {
  shops: 'Milk the Mobile Testers collected from shops (accepted), by journey date.',
  intake: 'Milk that went into the ZMCC tanks: from Mobile Testers and HC suppliers, with the ZMCC lab tests.',
  slip: 'What the dispatch slips say left the ZMCC (litres and @13 TS from the dispatch test).',
  plant: 'What the plant received: weighbridge net weight with the plant test. Tankers not yet received are left out.',
  motTrip: 'Received at the ZMCC from Mobile Testers minus collected from shops.',
  slipOver: 'Dispatch slip @13 TS minus the same litres at the quality of the milk in the tank. Plus means the slip claims more solids than the milk had. This is a recording difference, not milk.',
  road: 'Plant received minus what really left the ZMCC (the dispatched litres at the tank milk quality). The real loss or gain on the road.',
  whole: 'Shops and HC to plant: the Mobile Tester trip plus the road. The slip difference is not part of it.',
  ts: 'Milk quality (TS = Fat + SNF). Intake and plant should agree; a higher slip TS means the dispatch test is written high.',
};

const L = (n: number | null | undefined) => <span className="tabular-nums">{formatLitres(n)}</span>;
const ts = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));

function Stage({ label, info, value, tsValue }: { label: string; info: string; value: StagePair; tsValue?: number | null }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        {label}
        <InfoTip text={info} className="-my-2" />
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{formatLitres(value.at13ts)}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        @13 TS · {formatLitres(value.liters)} litres{tsValue != null ? ` · TS ${ts(tsValue)}` : ''}
      </p>
    </div>
  );
}

function Step({ label, info, value, tone }: { label: string; info: string; value: number | null | undefined; tone?: 'neutral' }) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-center justify-center px-1 text-center">
      <ArrowRight className="hidden h-4 w-4 text-muted-foreground xl:block" aria-hidden="true" />
      <p className="flex items-center gap-0.5 text-xs text-muted-foreground">
        {label}
        <InfoTip text={info} className="-my-2" />
      </p>
      <p className="text-xs font-semibold">
        {tone === 'neutral' ? (
          <span className="tabular-nums text-amber-700">{value == null ? '—' : `${value > 0 ? '+' : ''}${formatLitres(value)}`}</span>
        ) : (
          <Signed value={value} />
        )}
      </p>
    </div>
  );
}

function Chain({ row }: { row: StageChainReport['total'] }) {
  const intake: StagePair = {
    liters: row.receivedMot.liters + row.receivedHc.liters + row.receivedOther.liters,
    at13ts: row.receivedMot.at13ts + row.receivedHc.at13ts + row.receivedOther.at13ts,
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-stretch">
        <Stage label="Shops" info={INFO.shops} value={row.shops} />
        <Step label="Tester trip" info={INFO.motTrip} value={row.loss.motTrip.at13ts} />
        <Stage label="ZMCC intake" info={INFO.intake} value={intake} tsValue={row.ts.intake} />
        <Step label="Slip over" info={INFO.slipOver} value={row.loss.slipOver13ts} tone="neutral" />
        <Stage label="Dispatch slip" info={INFO.slip} value={row.dispatchSlip} tsValue={row.ts.slip} />
        <Step label="Road" info={INFO.road} value={row.loss.road.at13ts} />
        <Stage label="Plant" info={INFO.plant} value={row.plant} tsValue={row.ts.plant} />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-subtle px-3 py-2 text-xs">
        <span className="flex items-center gap-1">
          <span className="font-semibold">Whole loss / gain</span>
          <InfoTip text={INFO.whole} className="-my-2" />
          <Signed value={row.loss.whole.at13ts} /> <span className="text-muted-foreground">@13 TS</span>
        </span>
        <span className="text-muted-foreground">
          Litres: <Signed value={row.loss.whole.liters} />
        </span>
        <span className="text-muted-foreground tabular-nums">
          Slip TS above tank milk: {row.slipHighCycles} of {row.cycleCount} dispatches
        </span>
        {row.pendingTankers > 0 ? <span className="text-muted-foreground">Not yet at plant: {row.pendingTankers}</span> : null}
      </div>
    </div>
  );
}

const cycleColumns: Array<DataColumn<StageCycle>> = [
  { key: 'day', header: 'Day', primary: true, cell: (c) => <span className="tabular-nums">{c.day.slice(5)}</span> },
  { key: 'tankers', header: 'Tanker', cardAlways: true, cell: (c) => c.tankers.map((t) => t.vehicleNumber ?? t.visitNumber).join(' + ') },
  { key: 'intake', header: 'Intake', align: 'right', cell: (c) => L(c.intake.liters) },
  { key: 'slip', header: 'Dispatched', align: 'right', cell: (c) => L(c.dispatchSlip.liters) },
  { key: 'plant', header: 'Plant', align: 'right', cell: (c) => (c.plant ? L(c.plant.liters) : <span className="text-muted-foreground">Pending</span>) },
  { key: 'left', header: 'Left in tank', align: 'right', cell: (c) => L(c.leftInTank.liters) },
  {
    key: 'ts',
    header: (
      <span className="inline-flex items-center gap-1">
        TS tank / slip / plant
        <InfoTip text={INFO.ts} className="-my-2" />
      </span>
    ),
    label: 'TS tank / slip / plant',
    align: 'right',
    cell: (c) => (
      <span className="tabular-nums">
        {ts(c.ts.tank)} / <span className={c.ts.slip != null && c.ts.tank != null && c.ts.slip > c.ts.tank + 0.02 ? 'font-semibold text-amber-700' : ''}>{ts(c.ts.slip)}</span> / {ts(c.ts.plant)}
      </span>
    ),
  },
  { key: 'over', header: 'Slip over', align: 'right', cell: (c) => <span className="tabular-nums text-amber-700">{c.slipOver13ts > 0 ? '+' : ''}{formatLitres(c.slipOver13ts)}</span> },
  { key: 'road', header: 'Road @13 TS', align: 'right', cell: (c) => (c.road ? <Signed value={c.road.at13ts} /> : '—') },
];

export function StageChainPanel({ filters }: { filters: LossFilters }) {
  const qs = lossQueryParams(filters).toString();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
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
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const zmccColumns: Array<DataColumn<StageZmccRow>> = [
    { key: 'zmcc', header: 'ZMCC', primary: true, cell: (z) => <span className="font-medium">{z.zmccName}</span> },
    { key: 'shops', header: 'Shops @13 TS', align: 'right', cell: (z) => L(z.shops.at13ts) },
    { key: 'intake', header: 'Intake @13 TS', align: 'right', cell: (z) => L(z.receivedMot.at13ts + z.receivedHc.at13ts + z.receivedOther.at13ts) },
    { key: 'slip', header: 'Slip @13 TS', align: 'right', cell: (z) => L(z.dispatchSlip.at13ts) },
    { key: 'plant', header: 'Plant @13 TS', align: 'right', cell: (z) => L(z.plant.at13ts) },
    { key: 'ts', header: 'TS in / slip / plant', align: 'right', cell: (z) => <span className="tabular-nums">{ts(z.ts.intake)} / {ts(z.ts.slip)} / {ts(z.ts.plant)}</span> },
    { key: 'trip', header: 'Tester trip', align: 'right', cell: (z) => <Signed value={z.loss.motTrip.at13ts} /> },
    { key: 'over', header: 'Slip over', align: 'right', cell: (z) => <span className="tabular-nums text-amber-700">{z.loss.slipOver13ts > 0 ? '+' : ''}{formatLitres(z.loss.slipOver13ts)}</span> },
    { key: 'road', header: 'Road', align: 'right', cell: (z) => <Signed value={z.loss.road.at13ts} /> },
    { key: 'whole', header: 'Whole', align: 'right', cell: (z) => <Signed value={z.loss.whole.at13ts} /> },
    {
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
    },
  ];

  return (
    <div className={`space-y-3 ${query.isFetching ? 'opacity-60' : ''}`}>
      <ErrorPopup message={query.isError ? query.error.message || 'Stage by stage figures could not be loaded.' : null} onRetry={() => void query.refetch()} />
      {report ? <Chain row={report.total} /> : <div className="h-36 animate-pulse rounded-2xl bg-muted" />}
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
            </div>
          ) : null
        }
      />
    </div>
  );
}
