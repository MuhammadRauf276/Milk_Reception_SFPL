'use client';

import React from 'react';
import { ErrorPopup } from '@/components/ui/error-popup';
import type { StageDay, StagePair } from '@/backend/modules/management-reporting/stageChainContracts';
import type { TankDay, ZmccVisuals } from '@/backend/modules/management-reporting/visuals/zmccContracts';
import { StageChartsBoard, STAGE_COLORS, type ChartBucket } from '../../mpd/components/StageCharts';
import type { VisualsTabProps } from '../VisualsWorkspace';
import { ChartGrid, KpiRow, KpiTile, TrendChart, VisualTable, bucketRows, fmtCompact, fmtNum, useVisuals, type VisualColumn } from '../visualsKit';

const pickPair = (p: StagePair, unit: VisualsTabProps['unit']) => (unit === 'at13' ? p.at13ts : p.liters);

/** The days a clicked chart period covers: one day, its week (Monday to Sunday) or its month. */
function periodRange(dayKey: string, bucket: ChartBucket): { from: string; to: string } {
  if (bucket === 'DAY') return { from: dayKey, to: dayKey };
  const start = Date.parse(`${dayKey}T00:00:00Z`);
  if (bucket === 'WEEK') return { from: dayKey, to: new Date(start + 6 * 86400000).toISOString().slice(0, 10) };
  const d = new Date(start);
  return { from: dayKey, to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) };
}

function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}
const bucketKey = (day: string, bucket: ChartBucket) => (bucket === 'DAY' ? day : bucket === 'WEEK' ? weekStart(day) : `${day.slice(0, 7)}-01`);

/** Tank days grouped by period: milk in and out add up, the level is the one at the end of the period. */
function tankPoints(days: TankDay[], bucket: ChartBucket) {
  const closing = new Map<string, number>();
  const opening = new Map<string, number>();
  for (const d of days) {
    const k = bucketKey(d.day, bucket);
    if (!opening.has(k)) opening.set(k, d.opening);
    closing.set(k, d.closing);
  }
  return bucketRows(days.map((d) => ({ day: d.day, inL: d.inL, outL: d.outL })), bucket).map((p) => ({
    ...p,
    opening: opening.get(p.day) ?? 0,
    closing: closing.get(p.day) ?? 0,
  }));
}

/** Several ZMCCs together: the days added up. */
function sumTankDays(lists: TankDay[][]): TankDay[] {
  const first = lists[0] ?? [];
  return first.map((d, i) => ({
    day: d.day,
    opening: lists.reduce((s, l) => s + l[i].opening, 0),
    inL: lists.reduce((s, l) => s + l[i].inL, 0),
    outL: lists.reduce((s, l) => s + l[i].outL, 0),
    closing: lists.reduce((s, l) => s + l[i].closing, 0),
  }));
}

const lastClosing = (tanks: ZmccVisuals['tanks'] | undefined) => (tanks ?? []).reduce((s, t) => s + (t.days[t.days.length - 1]?.closing ?? 0), 0);

interface DayRow {
  key: string;
  day: string;
  zmcc: string;
  opening: number;
  inMc: number;
  inHc: number;
  out: number;
  closing: number;
  plant: number;
}

export function ZmccTab({ filters, setFilters, unit, bucket }: VisualsTabProps) {
  const query = useVisuals<ZmccVisuals>('ZMCC', filters);
  const data = query.data?.current;
  const before = query.data?.previous;
  const [tankZmcc, setTankZmcc] = React.useState('ALL');
  const unitText = unit === 'at13' ? '@13 TS litres' : 'litres';

  const stage = data?.stage;
  const total = stage?.total;
  const prevTotal = before?.stage.total;
  const tanks = React.useMemo(() => data?.tanks ?? [], [data]);
  const chosen = tankZmcc !== 'ALL' && tanks.some((t) => t.zmccId === tankZmcc) ? tankZmcc : 'ALL';
  const tankDays = React.useMemo(
    () => (chosen === 'ALL' ? sumTankDays(tanks.map((t) => t.days)) : (tanks.find((t) => t.zmccId === chosen)?.days ?? [])),
    [tanks, chosen]
  );
  const tankSeries = React.useMemo(() => tankPoints(tankDays, bucket), [tankDays, bucket]);
  const intakePoints = React.useMemo(() => bucketRows<StageDay>(stage?.daily ?? [], bucket), [stage, bucket]);

  const pick = (day: string) => setFilters({ ...filters, ...periodRange(day, bucket) });
  const pickZmcc = (id: string) => setFilters({ ...filters, zmccIds: [id] });

  const rows = React.useMemo<DayRow[]>(() => {
    if (!stage) return [];
    const out: DayRow[] = [];
    for (const t of tanks) {
      const sDays = new Map((stage.zmccs.find((z) => z.zmccId === t.zmccId)?.daily ?? []).map((d) => [d.day, d]));
      for (const d of t.days) {
        const s = sDays.get(d.day);
        const inMc = s ? pickPair(s.intakeMc, unit) : 0;
        const inHc = s ? pickPair(s.intakeHc, unit) : 0;
        const plant = s ? pickPair(s.plant, unit) : 0;
        if (!(d.inL || d.outL || inMc || inHc || plant)) continue;
        out.push({ key: `${t.zmccId}-${d.day}`, day: d.day, zmcc: t.zmccName, opening: d.opening, inMc, inHc, out: d.outL, closing: d.closing, plant });
      }
    }
    return out;
  }, [stage, tanks, unit]);

  const columns: Array<VisualColumn<DayRow>> = [
    { key: 'day', label: 'Day', value: (r) => r.day },
    { key: 'zmcc', label: 'ZMCC', value: (r) => r.zmcc },
    { key: 'opening', label: 'Opening L', value: (r) => r.opening, align: 'right' },
    { key: 'inMc', label: 'In MC', value: (r) => r.inMc, align: 'right' },
    { key: 'inHc', label: 'In HC', value: (r) => r.inHc, align: 'right' },
    { key: 'out', label: 'Out L', value: (r) => r.out, align: 'right' },
    { key: 'closing', label: 'Closing L', value: (r) => r.closing, align: 'right' },
    { key: 'plant', label: 'Plant', value: (r) => r.plant, align: 'right' },
  ];

  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The ZMCC figures could not be loaded.' : null} />
      {!data || !stage || !total ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <KpiRow>
            <KpiTile
              label="Intake MC"
              value={pickPair(total.receivedMot, unit)}
              previous={prevTotal ? pickPair(prevTotal.receivedMot, unit) : undefined}
              format={(v) => `${fmtCompact(v ?? 0)} L`}
              info={`Milk from Mobile Testers into the tanks, in ${unitText}.`}
            />
            <KpiTile
              label="Intake HC"
              value={pickPair(total.receivedHc, unit)}
              previous={prevTotal ? pickPair(prevTotal.receivedHc, unit) : undefined}
              format={(v) => `${fmtCompact(v ?? 0)} L`}
              info={`Milk from HC suppliers into the tanks, in ${unitText}.`}
            />
            <KpiTile
              label="Dispatched"
              value={pickPair(total.dispatchSlip, unit)}
              previous={prevTotal ? pickPair(prevTotal.dispatchSlip, unit) : undefined}
              format={(v) => `${fmtCompact(v ?? 0)} L`}
              better="none"
              info={`What the dispatch slips say left the ZMCCs, in ${unitText}.`}
            />
            <KpiTile
              label="Plant received"
              value={pickPair(total.plant, unit)}
              previous={prevTotal ? pickPair(prevTotal.plant, unit) : undefined}
              format={(v) => `${fmtCompact(v ?? 0)} L`}
              info={`What the plant measured for tankers received, in ${unitText}.`}
            />
            <KpiTile
              label="Road loss / gain"
              value={pickPair(total.loss.road, unit)}
              previous={prevTotal ? pickPair(prevTotal.loss.road, unit) : undefined}
              format={(v) => `${(v ?? 0) > 0 ? '+' : ''}${fmtCompact(v ?? 0)} L`}
              info={`Plant received minus what really left the ZMCC, in ${unitText}. Negative = loss.`}
            />
            <KpiTile
              label="Tank level"
              value={lastClosing(tanks)}
              previous={before ? lastClosing(before.tanks) : undefined}
              format={(v) => `${fmtCompact(v ?? 0)} L`}
              better="none"
              info="Litres in the tanks at the end of the last day, from the tank ledger. The ledger has no @13 TS."
            />
          </KpiRow>

          <StageChartsBoard report={stage} unit={unit} bucket={bucket} onPick={pick} onPickZmcc={pickZmcc} />

          <div className="space-y-2">
            {tanks.length > 1 ? (
              <label className="flex items-center gap-2 text-xs font-medium text-secondary-foreground">
                ZMCC
                <select
                  value={chosen}
                  onChange={(e) => setTankZmcc(e.target.value)}
                  className="min-h-10 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                >
                  <option value="ALL">All ZMCCs</option>
                  {tanks.map((t) => (
                    <option key={t.zmccId} value={t.zmccId}>
                      {t.zmccName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <TrendChart
              title="Tank: in, out and level"
              info="Litres from the tank ledger (no @13 TS). Bars: milk in and out. Line: level at the end of the period. A big dispatch on a low-intake day is covered by the milk already in the tank."
              points={tankSeries}
              series={[
                { key: 'inL', label: 'In', color: STAGE_COLORS.mc },
                { key: 'outL', label: 'Out', color: STAGE_COLORS.dispatch },
                { key: 'closing', label: 'Level', color: STAGE_COLORS.plant, type: 'line' },
              ]}
              tipFormat={(v) => `${fmtNum(v)} L`}
              onPick={pick}
            />
          </div>

          <ChartGrid>
            <TrendChart
              title="MC vs HC intake"
              info={`Milk into the tanks by source, in ${unitText}.`}
              points={intakePoints}
              series={[
                { key: unit === 'at13' ? 'intakeMc.at13ts' : 'intakeMc.liters', label: 'MC', color: STAGE_COLORS.mc, stack: 'i' },
                { key: unit === 'at13' ? 'intakeHc.at13ts' : 'intakeHc.liters', label: 'HC', color: STAGE_COLORS.hc, stack: 'i' },
                { key: unit === 'at13' ? 'intakeOther.at13ts' : 'intakeOther.liters', label: 'Other', color: STAGE_COLORS.otherPart, stack: 'i' },
              ]}
              onPick={pick}
            />
          </ChartGrid>

          <VisualTable title="Per day" rows={rows} columns={columns} rowKey={(r) => r.key} initialSort="day" />
        </>
      )}
    </div>
  );
}
