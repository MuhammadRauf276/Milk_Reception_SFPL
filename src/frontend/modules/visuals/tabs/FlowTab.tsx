'use client';

/**
 * Loss flow: purchased (shops + HC) -> area loss/gain -> ZMCC intake -> dispatched -> transit loss/gain -> plant.
 * Every figure comes from the stage chain report; the identity that explains plant minus purchased is explainWhole.
 */
import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from 'recharts';
import { ErrorPopup } from '@/components/ui/error-popup';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import type { StagePair, StageTotal, StageZmccRow } from '@/backend/modules/management-reporting/stageChainContracts';
import {
  explainWhole,
  transitDays,
  waterfallSteps,
  type FlowUnit,
  type FlowVisuals,
  type WaterfallStep,
  type WholeExplained,
} from '@/backend/modules/management-reporting/visuals/flowContracts';
import { STAGE_COLORS } from '../../mpd/components/StageCharts';
import type { VisualsTabProps } from '../VisualsWorkspace';
import {
  ChartCard,
  ChartGrid,
  KpiTile,
  TipBox,
  TrendChart,
  VisualTable,
  bucketRows,
  fmtCompact,
  fmtNum,
  fmtPct,
  measurePoints,
  measureText,
  measureValue,
  useVisuals,
  type VisualColumn,
} from '../visualsKit';

const pick = (p: StagePair | undefined, unit: FlowUnit) => (p ? (unit === 'at13' ? p.at13ts : p.liters) : 0);
const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}`;
const signedCompact = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtCompact(Math.abs(v))}`;

type Source = StageTotal | StageZmccRow;
/**
 * Tank level at the end minus at the start of the period, per ZMCC: litres exactly from the tank ledger; in @13 TS
 * those litres at the ZMCC's tank milk TS (the milk left after its last fill), else its intake TS.
 */
const withTank = (row: Source, tanks: FlowVisuals['tanks'], zmccs: StageZmccRow[], ids: string[] | null) => {
  let liters = 0;
  let at13ts = 0;
  for (const t of tanks) {
    if (ids && !ids.includes(t.zmccId)) continue;
    const dL = t.days.length ? t.days[t.days.length - 1].closing - t.days[0].opening : 0;
    const z = zmccs.find((x) => x.zmccId === t.zmccId);
    const tankTs = z && z.tankEnd.liters > 0 && z.tankEnd.at13ts > 0 ? (z.tankEnd.at13ts * 13) / z.tankEnd.liters : (z?.ts.intake ?? row.ts.intake ?? 13);
    liters += dL;
    at13ts += (dL * tankTs) / 13;
  }
  return { ...row, tankChange: { liters, at13ts } };
};

const intakeOf = (t: Source, unit: FlowUnit) =>
  pick(t.receivedMot, unit) + pick(t.receivedHc, unit) + pick(t.receivedOther, unit) + pick(t.adminIn, unit) - pick(t.adminOut, unit);

/* ------------------------------- Waterfall ------------------------------- */

interface WfRow {
  name: string;
  basePos: number;
  baseNeg: number;
  visPos: number;
  visNeg: number;
  color: string;
  dir: 'up' | 'down';
  step: WaterfallStep;
  /** Label text carried on the piece that shows it ("R:" right of the bar, "L:" left), so it never lands on another row. */
  lp: string;
  ln: string;
}

const stepColor = (s: WaterfallStep) =>
  s.key === 'purchased' ? STAGE_COLORS.shops : s.key === 'plant' ? STAGE_COLORS.plant : s.key === 'unexplained' ? STAGE_COLORS.overstated : s.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain;

function wfRows(steps: WaterfallStep[]): WfRow[] {
  return steps.map((s) => {
    const lo = Math.min(s.start, s.end);
    const hi = Math.max(s.start, s.end);
    const row = { name: s.label, basePos: 0, baseNeg: 0, visPos: 0, visNeg: 0, color: stepColor(s), dir: (s.end >= s.start ? 'up' : 'down') as 'up' | 'down', step: s, lp: '', ln: '' };
    if (lo >= 0) {
      row.basePos = lo;
      row.visPos = hi - lo;
    } else if (hi <= 0) {
      row.baseNeg = hi;
      row.visNeg = lo - hi;
    } else {
      row.visPos = hi;
      row.visNeg = lo;
    }
    const text = s.kind === 'total' ? fmtCompact(s.value) : signedCompact(s.value);
    const side = row.dir === 'up' ? 'R' : 'L';
    const onPos = row.dir === 'up' ? row.visPos !== 0 : row.visNeg === 0;
    return { ...row, lp: onPos ? `${side}:${text}` : '', ln: onPos ? '' : `${side}:${text}` };
  });
}

function WaterfallChart({ steps, unitText, measure }: { steps: WaterfallStep[]; unitText: string; measure: VisualsTabProps['measure'] }) {
  const rows = React.useMemo(() => wfRows(steps), [steps]);
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.start, s.end)));
  const hi = Math.max(0, ...steps.map((s) => Math.max(s.start, s.end)));
  const pad = (hi - lo) * 0.16 || 1;
  const domain: [number, number] = [lo < 0 ? lo - pad : 0, hi + pad];

  // The text comes with the bar piece itself (dataKey lp / ln), so a skipped zero-size piece cannot shift labels.
  const label = (p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
    const v = String(p.value ?? '');
    if (!v) return null;
    // Always just past the bar's right end, outside the bar, whichever way it goes.
    const text = v.slice(2);
    const x = Number(p.x ?? 0);
    const w = Number(p.width ?? 0);
    const y = Number(p.y ?? 0) + Number(p.height ?? 0) / 2;
    return (
      <text x={Math.max(x, x + w) + 5} y={y} dy={4} fontSize={11} fill="#374151" textAnchor="start">
        {text}
      </text>
    );
  };

  return (
    <ChartCard
      title={`Where milk is lost or gained (${measureText(measure)})`}
      info={`From what we purchased to what the plant received, in ${unitText}. Red = loss, green = gain, grey = not explained by the report. Each bar starts where the one before ended.`}
      legend={[
        { label: 'Loss', color: STAGE_COLORS.loss },
        { label: 'Gain', color: STAGE_COLORS.gain },
        { label: 'Unexplained', color: STAGE_COLORS.overstated },
      ]}
    >
      <div style={{ height: rows.length * 36 + 40 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
            <XAxis type="number" domain={domain} tick={{ fontSize: 11, fill: STAGE_COLORS.axis }} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtCompact(v)} />
            <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 11, fill: STAGE_COLORS.axis }} tickLine={false} axisLine={{ stroke: STAGE_COLORS.grid }} interval={0} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                const r = p.active ? (p.payload?.[0]?.payload as WfRow | undefined) : undefined;
                if (!r) return null;
                return (
                  <TipBox
                    title={r.step.label}
                    rows={[
                      { label: r.step.kind === 'total' ? 'Amount' : 'Loss/gain', value: `${r.step.kind === 'total' ? fmtNum(r.step.value) : signed(r.step.value)} L` },
                      ...(r.step.kind === 'delta' ? [{ label: 'Running level', value: `${fmtNum(r.step.end)} L` }] : []),
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="basePos" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="baseNeg" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="visPos" stackId="w" isAnimationActive={false} maxBarSize={22}>
              {rows.map((r) => (
                <Cell key={r.step.key} fill={r.color} />
              ))}
              <LabelList dataKey="lp" content={label} />
            </Bar>
            <Bar dataKey="visNeg" stackId="w" isAnimationActive={false} maxBarSize={22}>
              {rows.map((r) => (
                <Cell key={r.step.key} fill={r.color} />
              ))}
              <LabelList dataKey="ln" content={label} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ----------------------------- Flow strip cards ---------------------------- */

function Strip({ cards }: { cards: React.ReactNode[] }) {
  // Numbered steps in a grid that wraps, so every figure shows in full at any width.
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-6">
      {cards.map((c, i) => (
        <li key={i} className="relative min-w-0">
          <span className="absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">
            {i + 1}
          </span>
          {c}
        </li>
      ))}
    </ol>
  );
}

/* --------------------------------- Tab ----------------------------------- */

interface ZmccLine {
  id: string;
  name: string;
  purchased: number;
  inMc: number;
  inHc: number;
  dispatched: number;
  plant: number;
  area: number;
  transit: number;
  whole: number;
  percent: number | null;
}

interface TankerLine {
  id: string;
  vehicle: string;
  zmcc: string;
  day: string;
  status: string;
  slip: number;
  plant: number | null;
  transit: number | null;
  over: number | null;
  road: number | null;
}

export function FlowTab({ filters, setFilters, unit, bucket, measure }: VisualsTabProps) {
  const query = useVisuals<FlowVisuals>('FLOW', filters);
  const data = query.data?.current;
  const before = query.data?.previous;
  const unitText = unit === 'at13' ? '@13 TS litres' : 'litres';
  const u = unit === 'at13' ? 'L @13' : 'L';
  const kind = measure === 'perDay' ? 'Per day' : 'Total';
  const mt = measureText(measure);

  const stage = data?.stage;
  const days = stage?.days ?? 1;
  const prevDays = before?.stage.days ?? days;
  const mv = (v: number) => measureValue(v, measure, days) ?? 0;
  const fmtL = (v: number | null) => `${fmtCompact(v ?? 0)} ${u}`;
  const fmtS = (v: number | null) => `${signedCompact(v ?? 0)} ${u}`;

  const whole = React.useMemo<WholeExplained | null>(() => (data ? explainWhole(withTank(data.stage.total, data.tanks, data.stage.zmccs, null), unit) : null), [data, unit]);
  const wholeBefore = React.useMemo<WholeExplained | null>(() => (before ? explainWhole(withTank(before.stage.total, before.tanks, before.stage.zmccs, null), unit) : null), [before, unit]);
  const scale = measure === 'perDay' && days > 0 ? 1 / days : 1;
  const steps = React.useMemo(() => (whole ? waterfallSteps(whole, scale) : []), [whole, scale]);

  const dayRows = React.useMemo(() => {
    if (!stage) return [];
    const tr = new Map(transitDays(stage, unit).map((d) => [d.day, d]));
    return stage.daily.map((d) => {
      const t = tr.get(d.day);
      const transit = t?.transit ?? 0;
      return {
        day: d.day,
        mc: pick(d.shops, unit),
        hc: pick(d.intakeHc, unit),
        intake: pick(d.intakeMc, unit) + pick(d.intakeHc, unit) + pick(d.intakeOther, unit),
        dispatched: pick(d.dispatchSlip, unit),
        plant: pick(d.plant, unit),
        transitLoss: Math.min(0, transit),
        transitGain: Math.max(0, transit),
      };
    });
  }, [stage, unit]);
  const points = React.useMemo(
    () => (stage ? measurePoints(bucketRows(dayRows, bucket), measure, bucket, stage.from, stage.to) : []),
    [dayRows, bucket, measure, stage]
  );

  const zmccLines = React.useMemo<ZmccLine[]>(() => {
    if (!data) return [];
    return data.stage.zmccs.map((z) => {
      const w = explainWhole(withTank(z, data.tanks, data.stage.zmccs, [z.zmccId]), unit);
      return {
        id: z.zmccId,
        name: z.zmccName,
        purchased: mv(w.purchased),
        inMc: mv(pick(z.receivedMot, unit)),
        inHc: mv(pick(z.receivedHc, unit)),
        dispatched: mv(pick(z.dispatchSlip, unit)),
        plant: mv(w.plant),
        area: mv(pick(z.loss.motTrip, unit)),
        transit: mv(pick(z.loss.roadVsSlip, unit)),
        whole: mv(w.difference),
        percent: w.percent,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, unit, measure]);

  const tankerLines = React.useMemo<TankerLine[]>(() => {
    if (!data) return [];
    const out: TankerLine[] = [];
    for (const z of data.stage.zmccs) {
      z.cycles.forEach((c, ci) =>
        c.tankers.forEach((t, ti) => {
          const slip = pick(t.dispatch, unit);
          const plant = t.plant ? pick(t.plant, unit) : null;
          out.push({
            id: `${z.zmccId}-${ci}-${t.visitId}-${ti}`,
            vehicle: t.vehicleNumber ?? t.visitNumber ?? '—',
            zmcc: z.zmccName,
            day: c.day,
            status: plant == null ? 'Not at plant yet' : 'Received',
            slip,
            plant,
            transit: plant == null ? null : plant - slip,
            over: unit === 'at13' ? t.overstated13ts : null,
            road: t.road ? pick(t.road, unit) : null,
          });
        })
      );
    }
    return out;
  }, [data, unit]);

  const pickZmcc = (id: string) => setFilters({ ...filters, zmccIds: [id] });
  const zmccPoints = React.useMemo(() => zmccLines.map((z) => ({ day: z.id, label: z.name, ...z })), [zmccLines]);

  const lineTip = (w: WholeExplained) =>
    `${w.parts
      .filter((p) => Math.abs(p.value) >= 0.005)
      .map((p) => `${p.label} ${signed(mv(p.value))}`)
      .join(', ')}${Math.abs(w.unexplained) >= 0.005 ? `, Unexplained ${signed(mv(w.unexplained))}` : ''}. ${u}, ${mt}.`;

  const zmccColumns: Array<VisualColumn<ZmccLine>> = [
    { key: 'name', label: 'ZMCC', value: (r) => r.name },
    { key: 'purchased', label: 'Purchased', value: (r) => r.purchased, align: 'right' },
    { key: 'inMc', label: 'Intake MC', value: (r) => r.inMc, align: 'right' },
    { key: 'inHc', label: 'Intake HC', value: (r) => r.inHc, align: 'right' },
    { key: 'dispatched', label: 'Dispatched', value: (r) => r.dispatched, align: 'right' },
    { key: 'plant', label: 'Plant', value: (r) => r.plant, align: 'right' },
    { key: 'area', label: 'Area', value: (r) => r.area, align: 'right', format: (v) => signed(v) },
    { key: 'transit', label: 'Transit', value: (r) => r.transit, align: 'right', format: (v) => signed(v) },
    { key: 'whole', label: 'Whole', value: (r) => r.whole, align: 'right', format: (v) => signed(v) },
    { key: 'percent', label: 'Whole %', value: (r) => r.percent, align: 'right', format: (v) => fmtPct(v) },
  ];
  const tankerColumns: Array<VisualColumn<TankerLine>> = [
    { key: 'vehicle', label: 'Vehicle', value: (r) => r.vehicle },
    { key: 'zmcc', label: 'ZMCC', value: (r) => r.zmcc },
    { key: 'day', label: 'Day', value: (r) => r.day },
    { key: 'status', label: 'Status', value: (r) => r.status },
    { key: 'slip', label: 'Dispatched', value: (r) => r.slip, align: 'right' },
    { key: 'plant', label: 'Plant', value: (r) => r.plant, align: 'right' },
    { key: 'transit', label: 'Transit', value: (r) => r.transit, align: 'right', format: (v) => signed(v) },
    ...(unit === 'at13' ? [{ key: 'over', label: 'Overstated', value: (r: TankerLine) => r.over, align: 'right' as const, format: (v: number) => signed(v) }] : []),
    { key: 'road', label: 'Road', value: (r) => r.road, align: 'right', format: (v) => signed(v) },
  ];

  const total = stage?.total;
  const prev = before?.stage.total;
  const pv = (v: number) => measureValue(v, measure, prevDays) ?? 0;

  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The loss flow could not be loaded.' : null} />
      {!data || !stage || !total || !whole ? (
        <div className="h-48 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <Strip
            cards={[
              <KpiTile
                key="p"
                kind={kind}
                label="Purchased"
                value={mv(whole.purchased)}
                previous={wholeBefore ? pv(wholeBefore.purchased) : undefined}
                format={fmtL}
                better="none"
                sub={`MC ${fmtCompact(mv(pick(total.shops, unit)))} · HC ${fmtCompact(mv(pick(total.receivedHc, unit)))}`}
                info={`What we bought: accepted shops of Mobile Testers (on the journey day) plus HC milk (on the day received), in ${unitText}.`}
              />,
              <KpiTile
                key="a"
                kind={kind}
                label="Area loss/gain" signed
                value={mv(pick(total.loss.motTrip, unit))}
                previous={prev ? pv(pick(prev.loss.motTrip, unit)) : undefined}
                format={fmtS}
                sub={`On way ${fmtCompact(mv(pick(total.shopsOnWay, unit)))}`}
                info={`All Mobile Tester journeys of the ZMCC added up: received at the ZMCC minus collected at the shops, in ${unitText}. Journeys not at the ZMCC yet (On way) are not a loss.`}
              />,
              <KpiTile
                key="i"
                kind={kind}
                label="ZMCC intake"
                value={mv(intakeOf(total, unit))}
                previous={prev ? pv(intakeOf(prev, unit)) : undefined}
                format={fmtL}
                better="none"
                sub={`MC ${fmtCompact(mv(pick(total.receivedMot, unit)))} · HC ${fmtCompact(mv(pick(total.receivedHc, unit)))} · other ${fmtCompact(mv(pick(total.receivedOther, unit)))} · admin ${signedCompact(mv(pick(total.adminIn, unit) - pick(total.adminOut, unit)))}`}
                info={`Milk received into the tanks: Mobile Testers (MC), HC, other receipts, plus what a Super Admin added or removed, in ${unitText}.`}
              />,
              <KpiTile
                key="d"
                kind={kind}
                label="Dispatched"
                value={mv(pick(total.dispatchSlip, unit))}
                previous={prev ? pv(pick(prev.dispatchSlip, unit)) : undefined}
                format={fmtL}
                better="none"
                sub={whole.pendingSlip > 0 ? `Not at plant ${fmtCompact(mv(whole.pendingSlip))}` : undefined}
                info={`What the dispatch slips say left the ZMCCs, in ${unitText}. Not at plant = tankers the plant has not received yet (${total.pendingTankers}).`}
              />,
              <KpiTile
                key="t"
                kind={kind}
                label="Transit loss/gain" signed
                value={mv(pick(total.loss.roadVsSlip, unit))}
                previous={prev ? pv(pick(prev.loss.roadVsSlip, unit)) : undefined}
                format={fmtS}
                sub={unit === 'at13' ? `Overstated ${signedCompact(mv(total.loss.slipOver13ts))} · Road ${signedCompact(mv(pick(total.loss.road, unit)))}` : `Road ${signedCompact(mv(pick(total.loss.road, unit)))}`}
                info={`Plant received minus dispatched, for the tankers the plant received: the level the plant counts on. It splits into Overstated (the slip claims more @13 TS than the tank milk held; not milk) and Road (plant against the real tank milk), in ${unitText}.`}
              />,
              <KpiTile
                key="l"
                kind={kind}
                label="Plant received"
                value={mv(pick(total.plant, unit))}
                previous={prev ? pv(pick(prev.plant, unit)) : undefined}
                format={fmtL}
                sub={`${total.pendingTankers} tankers to come`}
                info={`What the plant measured for the tankers it received, in ${unitText}. Plant figures count on the day the tank fill was dispatched.`}
              />,
            ]}
          />

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1 text-sm font-semibold text-foreground">
                Purchased vs plant
                <InfoTip
                  text={`Plant received minus purchased. What explains it: ${lineTip(whole)} Shops count on the journey day, HC on the day received, plant on the day the tank fill was dispatched, so some of the difference is only timing.`}
                  className="-my-2"
                />
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{kind}</span>
              </h4>
              <p className={cn('text-lg font-semibold tabular-nums', whole.difference < 0 ? 'text-destructive' : whole.difference > 0 ? 'text-emerald-700' : 'text-foreground')}>
                {signed(mv(whole.difference))} {u} · {whole.percent == null ? '—' : `${whole.percent > 0 ? '+' : ''}${fmtNum(whole.percent, 1)}%`}
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {[...whole.parts.filter((p) => Math.abs(p.value) >= 0.005), { key: 'unexplained', label: 'Unexplained', value: whole.unexplained, info: 'What the parts do not explain: date differences between shops, HC and tank cycles, corrections.' }].map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-3 text-secondary-foreground">
                  <dt className="flex items-center gap-1">
                    {p.label}
                    <InfoTip text={p.info} className="-my-2" />
                  </dt>
                  <dd className={cn('tabular-nums', p.value < 0 ? 'text-destructive' : p.value > 0 ? 'text-emerald-700' : 'text-foreground')}>{signed(mv(p.value))}</dd>
                </div>
              ))}
            </dl>
          </section>

          <WaterfallChart steps={steps} unitText={unitText} measure={measure} />

          <ChartGrid>
            <TrendChart
              title={`Purchased, intake, dispatched, plant (${mt})`}
              info={`By period, in ${unitText}. Purchased is MC shops and HC stacked. Intake is MC, HC and other receipts. Plant counts on the dispatch day; HC on the day received; shops on the journey day.`}
              points={points}
              series={[
                { key: 'mc', label: 'Purchased MC', color: STAGE_COLORS.mc, stack: 'p' },
                { key: 'hc', label: 'Purchased HC', color: STAGE_COLORS.hc, stack: 'p' },
                { key: 'intake', label: 'ZMCC intake', color: STAGE_COLORS.otherPart },
                { key: 'dispatched', label: 'Dispatched', color: STAGE_COLORS.dispatch },
                { key: 'plant', label: 'Plant received', color: STAGE_COLORS.plant },
              ]}
            />
            <div className="space-y-4">
              <TrendChart
                title={`Dispatched vs plant received (${mt})`}
                info={`By period, in ${unitText}. The gap includes tankers the plant has not received yet.`}
                points={points}
                series={[
                  { key: 'dispatched', label: 'Dispatched', color: STAGE_COLORS.dispatch },
                  { key: 'plant', label: 'Plant received', color: STAGE_COLORS.plant },
                ]}
                height={200}
              />
              <TrendChart
                title={`Transit loss/gain (${mt})`}
                info={`Plant received minus dispatched, for the tankers the plant received, by dispatch day, in ${unitText}. Tankers not at the plant yet are left out.`}
                points={points}
                series={[
                  { key: 'transitLoss', label: 'Loss', color: STAGE_COLORS.loss, stack: 't' },
                  { key: 'transitGain', label: 'Gain', color: STAGE_COLORS.gain, stack: 't' },
                ]}
                height={160}
              />
            </div>
          </ChartGrid>

          <ChartGrid>
            <TrendChart
              title={`Per ZMCC: purchased, dispatched, plant (${mt})`}
              info={`In ${unitText}. Click a ZMCC to look at it alone.`}
              points={zmccPoints}
              series={[
                { key: 'purchased', label: 'Purchased', color: STAGE_COLORS.shops },
                { key: 'dispatched', label: 'Dispatched', color: STAGE_COLORS.dispatch },
                { key: 'plant', label: 'Plant received', color: STAGE_COLORS.plant },
              ]}
              onPick={pickZmcc}
            />
            <TrendChart
              title={`Per ZMCC: area, transit, whole (${mt})`}
              info={`Loss/gain in ${unitText}. Whole = plant received minus purchased. Click a ZMCC to look at it alone.`}
              points={zmccPoints}
              series={[
                { key: 'area', label: 'Area', color: STAGE_COLORS.mc },
                { key: 'transit', label: 'Transit', color: STAGE_COLORS.dispatch },
                { key: 'whole', label: 'Whole', color: STAGE_COLORS.overstated },
              ]}
              onPick={pickZmcc}
            />
          </ChartGrid>

          <VisualTable title={`Per ZMCC (${mt}, ${u})`} rows={zmccLines} columns={zmccColumns} rowKey={(r) => r.id} initialSort="purchased" />

          <VisualTable title={`Dispatched vs plant per tanker (${u})`} rows={tankerLines} columns={tankerColumns} rowKey={(r) => r.id} initialSort="day" maxRows={500} />
        </>
      )}
    </div>
  );
}
