'use client';

import React from 'react';
import { ErrorPopup } from '@/components/ui/error-popup';
import type { QtyPair } from '@/backend/modules/management-reporting/visuals/common';
import { tripOf, tripPct, tsOfLiters, type TesterRow, type TestersDayRow, type TestersVisuals } from '@/backend/modules/management-reporting/visuals/testersContracts';
import type { VisualsTabProps } from '../VisualsWorkspace';
import {
  ChartGrid,
  KpiRow,
  KpiTile,
  PickList,
  RankedBarsChart,
  SERIES_COLORS,
  STAGE_COLORS,
  TrendChart,
  VisualTable,
  bucketRows,
  fmtCompact,
  fmtLiters,
  fmtNum,
  fmtPct,
  useVisuals,
  type TrendSeries,
  type VisualColumn,
  measurePoints,
  measureValue,
} from '../visualsKit';

type DayDerived = TestersDayRow & { trip: QtyPair; tripGain: QtyPair; tripLoss: QtyPair };

/** Trip loss/gain of a day or a week, worked out again from the summed fields, split into gain and loss for the colours. */
function withTrip(r: TestersDayRow): DayDerived {
  const trip = tripOf(r.received, r.collectedArrived);
  return {
    ...r,
    trip,
    tripGain: { liters: Math.max(0, trip.liters), at13ts: Math.max(0, trip.at13ts) },
    tripLoss: { liters: Math.min(0, trip.liters), at13ts: Math.min(0, trip.at13ts) },
  };
}

function totalsOf(days: TestersDayRow[]) {
  const t = {
    collected: { liters: 0, at13ts: 0 },
    collectedArrived: { liters: 0, at13ts: 0 },
    received: { liters: 0, at13ts: 0 },
    journeys: 0,
    notArrived: 0,
    shops: 0,
  };
  for (const d of days) {
    t.collected.liters += d.collected.liters;
    t.collected.at13ts += d.collected.at13ts;
    t.collectedArrived.liters += d.collectedArrived.liters;
    t.collectedArrived.at13ts += d.collectedArrived.at13ts;
    t.received.liters += d.received.liters;
    t.received.at13ts += d.received.at13ts;
    t.journeys += d.journeys;
    t.notArrived += d.notArrived;
    t.shops += d.shops;
  }
  return t;
}

export function TestersTab({ filters, unit, bucket, measure, ids, setIds }: VisualsTabProps) {
  const query = useVisuals<TestersVisuals>('TESTERS', filters, ids);
  const cur = query.data?.current;
  const prev = query.data?.previous;
  const u = unit === 'at13' ? 'at13ts' : 'liters';
  const unitLabel = unit === 'at13' ? '@13 TS' : 'L';
  const fmtFull = (v: number | null) => (v == null ? '—' : unit === 'at13' ? `${fmtNum(v)} L @13 TS` : fmtLiters(v));
  const signed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v)}`);

  const meta = query.data?.meta;
  const points = React.useMemo(
    () => (cur ? (meta ? measurePoints(bucketRows(cur.days, bucket, withTrip), measure, bucket, meta.from, meta.to) : bucketRows(cur.days, bucket, withTrip)) : []),
    [cur, bucket, measure, meta]
  );
  const kind = measure === 'perDay' ? ('Per day' as const) : ('Total' as const);
  const m = (v: number | null | undefined) => measureValue(v, measure, meta?.days ?? 1);

  if (!cur) {
    return (
      <>
        <ErrorPopup message={query.isError ? 'The figures could not be loaded.' : null} onRetry={() => void query.refetch()} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  const t = totalsOf(cur.days);
  const pv = prev ? totalsOf(prev.days) : null;
  const trip = (x: ReturnType<typeof totalsOf>) => tripOf(x.received, x.collectedArrived);
  const tripNow = trip(t);
  const tripBefore = pv ? trip(pv) : null;
  const perJourney = (x: ReturnType<typeof totalsOf>) => (x.journeys > 0 ? x.shops / x.journeys : null);

  const rowTrip = (r: TesterRow) => tripOf(r.received, r.collectedArrived);
  const testers = cur.testers;
  const tripPctOf = (r: TesterRow) => tripPct(rowTrip(r)[u], r.collectedArrived[u]);

  const columns: Array<VisualColumn<TesterRow>> = [
    { key: 'name', label: 'Mobile Tester', value: (r) => r.name },
    { key: 'code', label: 'Code', value: (r) => r.code },
    { key: 'zmcc', label: 'ZMCC', value: (r) => r.zmccName },
    { key: 'journeys', label: 'Journeys', value: (r) => r.journeys, align: 'right' },
    { key: 'open', label: 'Not arrived', value: (r) => r.notArrived, align: 'right' },
    { key: 'shops', label: 'Shops', value: (r) => r.shops, align: 'right' },
    { key: 'rejected', label: 'Rejected', value: (r) => r.rejected, align: 'right' },
    { key: 'collected', label: `Collected ${unitLabel}`, value: (r) => r.collected[u], align: 'right' },
    { key: 'received', label: `Received ${unitLabel}`, value: (r) => r.received[u], align: 'right' },
    { key: 'trip', label: 'Journey L/G', value: (r) => rowTrip(r)[u], format: signed, align: 'right' },
    { key: 'tripPct', label: 'Journey %', value: (r) => tripPctOf(r), format: (v) => fmtPct(v, 2), align: 'right' },
    { key: 'tsc', label: 'TS collected', value: (r) => tsOfLiters(r.collected.liters, r.collected.at13ts), format: (v) => fmtNum(v, 2), align: 'right' },
    { key: 'tsr', label: 'TS received', value: (r) => tsOfLiters(r.received.liters, r.received.at13ts), format: (v) => fmtNum(v, 2), align: 'right' },
  ];

  const lineSeries: TrendSeries[] = cur.lineTesters.map((x, i) => ({ key: `byTester.t${x.id}.${u}`, label: x.name, color: SERIES_COLORS[i] ?? SERIES_COLORS[0], type: 'line' }));
  const tsPoints = testers.slice(0, 12).map((r) => ({
    day: r.id,
    label: r.name,
    collected: tsOfLiters(r.collected.liters, r.collected.at13ts) ?? 0,
    received: tsOfLiters(r.received.liters, r.received.at13ts) ?? 0,
  }));

  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The figures could not be loaded.' : null} onRetry={() => void query.refetch()} />
      <PickList label="Mobile Testers" items={cur.testerOptions} picked={ids} onChange={setIds} />

      <KpiRow>
        <KpiTile label={`Collected ${unitLabel}`} kind={kind} value={m(t.collected[u])} previous={pv ? m(pv.collected[u]) : undefined} format={fmtFull} info="Accepted shop milk on journeys in these days." />
        <KpiTile label={`Received ${unitLabel}`} kind={kind} value={m(t.received[u])} previous={pv ? m(pv.received[u]) : undefined} format={fmtFull} info="Milk the ZMCC tanks received from these journeys." />
        <KpiTile
          label="MOT journey loss / gain" signed
          kind={kind}
          value={m(tripNow[u])}
          previous={tripBefore ? m(tripBefore[u]) : undefined}
          format={(v) => (v == null ? '—' : `${signed(v)} ${unit === 'at13' ? 'L @13 TS' : 'L'}`)}
          sub={fmtPct(tripPct(tripNow[u], t.collectedArrived[u]), 2)}
          info="Received minus collected, only for journeys that arrived. A loss is negative."
        />
        <KpiTile label="Journeys" kind="Count" value={t.journeys} previous={pv?.journeys} format={(v) => fmtNum(v)} sub={`${fmtNum(t.notArrived)} not arrived`} better="none" info="Journeys that were not cancelled, and how many have not reached the ZMCC." />
        <KpiTile label="Shops per journey" kind="Average" value={perJourney(t)} previous={pv ? perJourney(pv) : undefined} format={(v) => fmtNum(v, 1)} info="Shops that gave accepted milk, divided by journeys." />
      </KpiRow>

      <ChartGrid>
        <TrendChart
          title={`Collected and received (${unitLabel})`}
          info="Daily milk collected at shops against milk received at the ZMCC. Same axis."
          points={points}
          series={[
            { key: `collected.${u}`, label: 'Collected', color: SERIES_COLORS[0] },
            { key: `received.${u}`, label: 'Received', color: SERIES_COLORS[1] },
          ]}
          format={fmtCompact}
        />
        <TrendChart
          title={`MOT journey loss / gain (${unitLabel})`}
          info="Received minus collected for journeys that arrived. Red is a loss, green a gain."
          points={points}
          series={[
            { key: `tripLoss.${u}`, label: 'Loss', color: STAGE_COLORS.loss, stack: 's' },
            { key: `tripGain.${u}`, label: 'Gain', color: STAGE_COLORS.gain, stack: 's' },
          ]}
          format={fmtCompact}
        />
        {lineSeries.length ? (
          <TrendChart title={`Collected per tester (${unitLabel})`} info="Daily shop milk of each picked Mobile Tester." points={points} series={lineSeries} format={fmtCompact} />
        ) : null}
        <RankedBarsChart
          title="Ranking by collected"
          info="Mobile Testers with the most shop milk."
          rows={testers.map((r) => ({ id: r.id, name: r.name, value: r.collected[u], tip: [{ label: 'Received', value: fmtFull(r.received[u]) }, { label: 'Journeys', value: fmtNum(r.journeys) }] }))}
          color={SERIES_COLORS[0]}
          format={fmtCompact}
        />
        <RankedBarsChart
          title="MOT journey loss / gain %"
          info="MOT journey loss or gain as a share of the milk collected on journeys that arrived. Loss is negative."
          signed
          percent
          rows={testers
            .map((r) => ({ r, v: tripPctOf(r) }))
            .filter((x): x is { r: TesterRow; v: number } => x.v != null)
            .sort((a, b) => a.v - b.v)
            .map(({ r, v }) => ({ id: r.id, name: r.name, value: v, tip: [{ label: 'Journey loss / gain', value: signed(rowTrip(r)[u]) }] }))}
          format={(v) => fmtPct(v, 2)}
        />
        <TrendChart
          title="TS collected and received"
          info="Total solids of the milk at the shops against at the ZMCC, per Mobile Tester. Details in the table."
          points={tsPoints}
          series={[
            { key: 'collected', label: 'Collected', color: SERIES_COLORS[0] },
            { key: 'received', label: 'Received', color: SERIES_COLORS[1] },
          ]}
          format={(v) => fmtNum(v, 1)}
          tipFormat={(v) => fmtNum(v, 2)}
        />
        <RankedBarsChart
          title="Rejected shops"
          info="Shop collections rejected, per Mobile Tester."
          rows={[...testers].filter((r) => r.rejected > 0).sort((a, b) => b.rejected - a.rejected).map((r) => ({ id: r.id, name: r.name, value: r.rejected, tip: [{ label: 'Shops', value: fmtNum(r.shops) }] }))}
          color={STAGE_COLORS.loss}
          format={(v) => fmtNum(v)}
        />
      </ChartGrid>

      <VisualTable title="Mobile Testers" rows={testers} columns={columns} rowKey={(r) => r.id} initialSort="collected" />
    </div>
  );
}
