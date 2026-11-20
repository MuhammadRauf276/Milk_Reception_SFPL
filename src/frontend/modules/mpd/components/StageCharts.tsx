'use client';

/**
 * Charts for the Stage by stage report, in the style of analytics cards: white card, soft shadow, small title, thin
 * marks, hairline grid, legend with dots, hover tooltips. Colours follow the stage and were checked for colour
 * blindness in legend order: Mobile Tester (MC) intake blue, HC intake yellow, plant aqua, ZMCC dispatch orange;
 * shops violet. Loss red, gain green, dispatch overstated grey (not milk). Every value is also in the tables below.
 */
import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';
import { InfoTip } from '@/components/ui/info-tip';
import type { StageChainReport, StageDay, StagePair, StageZmccRow } from '@/backend/modules/management-reporting/stageChainContracts';

export const STAGE_COLORS = {
  shops: '#6250d6',
  mc: '#2a78d6',
  mcPart: '#2a78d6',
  hcPart: '#9cc3f0',
  hc: '#eda100',
  dispatch: '#eb6834',
  plant: '#1baf7a',
  loss: '#e34948',
  gain: '#1f9d55',
  overstated: '#94a3b8',
  otherPart: '#cbd5e1',
  grid: '#e7e9ee',
  axis: '#6b7280',
  zero: '#9ca3af',
} as const;

export type ChartUnit = 'at13' | 'liters';
export type ChartBucket = 'DAY' | 'WEEK' | 'MONTH';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${fmt(n / 1_000_000, 1)}M` : Math.abs(n) >= 10_000 ? `${fmt(n / 1000, 0)}k` : Math.abs(n) >= 1000 ? `${fmt(n / 1000, 1)}k` : fmt(n);
const shortDay = (d: string) => {
  const [, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
};
const unitText = (u: ChartUnit) => (u === 'at13' ? '@13 TS' : 'litres');
const pick = (p: StagePair, u: ChartUnit) => (u === 'at13' ? p.at13ts : p.liters);
const tsOf = (p: StagePair) => (p.liters > 0 ? (p.at13ts * 13) / p.liters : null);
const addP = (a: StagePair, b: StagePair): StagePair => ({ liters: a.liters + b.liters, at13ts: a.at13ts + b.at13ts });
const zero = (): StagePair => ({ liters: 0, at13ts: 0 });
const intakeOf = (r: Pick<StageZmccRow, 'receivedMot' | 'receivedHc' | 'receivedOther'>): StagePair => ({
  liters: r.receivedMot.liters + r.receivedHc.liters + r.receivedOther.liters,
  at13ts: r.receivedMot.at13ts + r.receivedHc.at13ts + r.receivedOther.at13ts,
});

/* ------------------------------ Grouping -------------------------------- */

export type BucketPoint = StageDay & { label: string };

function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

/** Days added up into weeks (Monday first) or months. TS is worked out again from the sums. */
export function bucketDays(days: StageDay[], bucket: ChartBucket): BucketPoint[] {
  if (bucket === 'DAY') return days.map((d) => ({ ...d, label: shortDay(d.day) }));
  const map = new Map<string, BucketPoint>();
  for (const d of days) {
    const key = bucket === 'WEEK' ? weekStart(d.day) : `${d.day.slice(0, 7)}-01`;
    const label = bucket === 'WEEK' ? `Wk ${shortDay(key)}` : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    const cur: BucketPoint = map.get(key) ?? {
      day: key,
      label,
      shops: zero(),
      intake: zero(),
      intakeMc: zero(),
      intakeHc: zero(),
      intakeOther: zero(),
      dispatchSlip: zero(),
      plant: zero(),
      slipOver13ts: 0,
      road: zero(),
      ts: { intake: null, slip: null, plant: null },
    };
    cur.shops = addP(cur.shops, d.shops);
    cur.intake = addP(cur.intake, d.intake);
    cur.intakeMc = addP(cur.intakeMc, d.intakeMc);
    cur.intakeHc = addP(cur.intakeHc, d.intakeHc);
    cur.intakeOther = addP(cur.intakeOther, d.intakeOther);
    cur.dispatchSlip = addP(cur.dispatchSlip, d.dispatchSlip);
    cur.plant = addP(cur.plant, d.plant);
    cur.road = addP(cur.road, d.road);
    cur.slipOver13ts += d.slipOver13ts;
    map.set(key, cur);
  }
  return [...map.values()].map((b) => ({ ...b, ts: { intake: tsOf(b.intake), slip: tsOf(b.dispatchSlip), plant: tsOf(b.plant) } }));
}

/* --------------------------------- Card --------------------------------- */

export function ChartCard({
  title,
  info,
  legend,
  children,
  className,
}: {
  title: string;
  info?: string;
  legend?: Array<{ label: string; color: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)] [&_svg:focus]:outline-none [&_svg:focus-visible]:outline-2 [&_svg:focus-visible]:outline-primary [&_.recharts-wrapper:focus]:outline-none ${className ?? ''}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h4 className="flex items-center gap-1 text-sm font-semibold text-foreground">
          {title}
          {info ? <InfoTip text={info} className="-my-2" /> : null}
        </h4>
      </div>
      {children}
      {legend && legend.length > 1 ? (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-foreground">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: Array<{ label: string; value: string; color?: string }> }) {
  return (
    <div className="min-w-44 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-secondary-foreground">
          <span className="flex items-center gap-1.5">
            {r.color ? <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden="true" /> : null}
            {r.label}
          </span>
          <span className="tabular-nums font-medium text-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

type TipProps = TooltipContentProps<TooltipValueType, string | number>;
/** Called with the clicked period (its first day key). */
export type PickPeriod = (dayKey: string) => void;
const clickIndex = (state: unknown): number | null => {
  const i = (state as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex;
  const n = i == null ? NaN : Number(i);
  return Number.isFinite(n) ? n : null;
};
const axisProps = { tick: { fontSize: 11, fill: STAGE_COLORS.axis }, tickLine: false, axisLine: { stroke: STAGE_COLORS.grid } } as const;
const timeAxis = { ...axisProps, dataKey: 'label', interval: 'preserveStartEnd' as const, minTickGap: 28 };
const withZero = [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)] as [(n: number) => number, (n: number) => number];
// Room past the longest bar so its value label never runs into the axis labels.
const withZeroRoom = [(min: number) => Math.min(0, min * 1.6), (max: number) => Math.max(0, max * 1.6)] as [(n: number) => number, (n: number) => number];


/** A value just past the far end of a horizontal bar: left of a loss bar, right of a gain bar. */
function endLabel(format: (v: number) => string) {
  const EndLabel = (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => {
    const x = Number(props.x ?? 0);
    const w = Number(props.width ?? 0);
    const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2;
    const v = Number(props.value ?? 0);
    const left = Math.min(x, x + w);
    const right = Math.max(x, x + w);
    return (
      <text x={v < 0 ? left - 4 : right + 4} y={y} dy={4} fontSize={11} fill="#374151" textAnchor={v < 0 ? 'end' : 'start'}>
        {format(v)}
      </text>
    );
  };
  return EndLabel;
}

/* ---------------------------- 1. Stage totals ---------------------------- */

export function StageTotalsChart({ report, unit }: { report: StageChainReport; unit: ChartUnit }) {
  const t = report.total;
  const other = pick(t.receivedOther, unit);
  const data = [
    { stage: 'Shops', base: pick(t.shops, unit), hc: 0, other: 0, color: STAGE_COLORS.shops },
    { stage: 'Intake', base: pick(t.receivedMot, unit), hc: pick(t.receivedHc, unit), other, color: STAGE_COLORS.mcPart },
    { stage: 'Dispatch', base: pick(t.dispatchSlip, unit), hc: 0, other: 0, color: STAGE_COLORS.dispatch },
    { stage: 'Plant', base: pick(t.plant, unit), hc: 0, other: 0, color: STAGE_COLORS.plant },
  ];
  return (
    <ChartCard
      title="Milk at each stage"
      info={`${unitText(unit)} at each stage. The intake bar is split: Mobile Testers (dark) and HC suppliers (light).`}
      legend={[
        { label: 'Intake from Mobile Testers', color: STAGE_COLORS.mcPart },
        { label: 'Intake from HC', color: STAGE_COLORS.hcPart },
        ...(other ? [{ label: 'Other tank receipts', color: STAGE_COLORS.otherPart }] : []),
      ]}
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="35%">
            <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
            <XAxis dataKey="stage" {...axisProps} interval={0} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!p.active || !d) return null;
                const rows =
                  d.stage === 'Intake'
                    ? [
                        { label: 'Mobile Testers (MC)', value: `${fmt(d.base)} L`, color: STAGE_COLORS.mcPart },
                        { label: 'HC suppliers', value: `${fmt(d.hc)} L`, color: STAGE_COLORS.hcPart },
                        ...(d.other ? [{ label: 'Other receipts', value: `${fmt(d.other)} L`, color: STAGE_COLORS.otherPart }] : []),
                        { label: 'Total', value: `${fmt(d.base + d.hc + d.other)} L` },
                      ]
                    : [{ label: unitText(unit), value: `${fmt(d.base)} L`, color: d.color }];
                return <TooltipBox title={d.stage === 'Dispatch' ? 'ZMCC dispatch' : d.stage} rows={rows} />;
              }}
            />
            <Bar dataKey="base" stackId="s" maxBarSize={44} radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.stage} fill={d.color} />
              ))}
            </Bar>
            <Bar dataKey="hc" stackId="s" maxBarSize={44} fill={STAGE_COLORS.hcPart} radius={other ? [0, 0, 0, 0] : [4, 4, 0, 0]} stroke="#ffffff" strokeWidth={2} />
            {other ? <Bar dataKey="other" stackId="s" maxBarSize={44} fill={STAGE_COLORS.otherPart} radius={[4, 4, 0, 0]} stroke="#ffffff" strokeWidth={2} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-1 grid grid-cols-4 gap-1 text-center text-xs tabular-nums font-semibold text-foreground">
        {data.map((d) => (
          <li key={d.stage}>{compact(d.base + d.hc + d.other)}</li>
        ))}
      </ul>
    </ChartCard>
  );
}

/* -------------------------- 2. Loss / gain bars -------------------------- */

export function LossBreakdownChart({ report, unit }: { report: StageChainReport; unit: ChartUnit }) {
  const l = report.total.loss;
  const data = [
    { part: 'Tester trip', value: pick(l.motTrip, unit), kind: 'real' },
    ...(unit === 'at13' ? [{ part: 'Overstated', value: l.slipOver13ts, kind: 'over' }] : []),
    { part: 'Road', value: pick(l.road, unit), kind: 'real' },
    { part: 'Whole', value: pick(l.whole, unit), kind: 'real' },
  ];
  const color = (d: (typeof data)[number]) => (d.kind === 'over' ? STAGE_COLORS.overstated : d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain);
  return (
    <ChartCard
      title="Where milk is lost or gained"
      info={`${unitText(unit)}. Left of zero is loss, right is gain. Dispatch overstated (grey): the ZMCC dispatch claims more @13 TS than the milk had, a recording difference, not milk.`}
      legend={[
        { label: 'Loss', color: STAGE_COLORS.loss },
        { label: 'Gain', color: STAGE_COLORS.gain },
        ...(unit === 'at13' ? [{ label: 'Dispatch overstated (not milk)', color: STAGE_COLORS.overstated }] : []),
      ]}
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }} barCategoryGap="40%">
            <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
            <XAxis type="number" {...axisProps} tickFormatter={compact} domain={withZeroRoom} />
            <YAxis type="category" dataKey="part" {...axisProps} axisLine={false} width={78} />
            <ReferenceLine x={0} stroke={STAGE_COLORS.zero} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p.active && d ? (
                  <TooltipBox
                    title={d.part === 'Overstated' ? 'Dispatch overstated' : d.part}
                    rows={[{ label: d.kind === 'over' ? 'Claimed more' : d.value < 0 ? 'Loss' : 'Gain', value: `${fmt(Math.abs(d.value))} L`, color: color(d) }]}
                  />
                ) : null;
              }}
            />
            <Bar dataKey="value" radius={4} maxBarSize={18} label={endLabel(compact)}>
              {data.map((d) => (
                <Cell key={d.part} fill={color(d)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* --------------------- 3. Intake (MC, HC) vs dispatch -------------------- */

export function IntakeDispatchChart({ points, unit, onPick }: { points: BucketPoint[]; unit: ChartUnit; onPick?: PickPeriod }) {
  const data = points.map((d) => ({
    day: d.day,
    label: d.label,
    mc: pick(d.intakeMc, unit),
    hc: pick(d.intakeHc, unit),
    other: pick(d.intakeOther, unit),
    plant: pick(d.plant, unit),
    dispatch: pick(d.dispatchSlip, unit),
  }));
  // Legend order is the order the colours were checked in.
  const series = [
    { key: 'mc', label: 'Intake from Mobile Testers', color: STAGE_COLORS.mc },
    { key: 'hc', label: 'Intake from HC', color: STAGE_COLORS.hc },
    { key: 'plant', label: 'Plant received', color: STAGE_COLORS.plant },
    { key: 'dispatch', label: 'ZMCC dispatch', color: STAGE_COLORS.dispatch },
  ] as const;
  return (
    <ChartCard
      title="Intake and dispatch"
      info={`${unitText(unit)}: milk received into ZMCC tanks from Mobile Testers and HC suppliers, what the ZMCC dispatched, and what the plant received.`}
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            style={onPick ? { cursor: 'pointer' } : undefined}
            onClick={(st: unknown) => {
              const i = clickIndex(st);
              if (onPick && i != null && data[i]) onPick(data[i].day);
            }}
          >
            <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
            <XAxis {...timeAxis} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ stroke: STAGE_COLORS.zero, strokeWidth: 1 }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p.active && d ? (
                  <TooltipBox
                    title={d.label}
                    rows={[...series.map((s) => ({ label: s.label, value: `${fmt(d[s.key])} L`, color: s.color })), { label: 'Total intake', value: `${fmt(d.mc + d.hc + d.other)} L` }]}
                  />
                ) : null;
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={data.length <= 31 ? { r: 3, strokeWidth: 2, stroke: '#ffffff', fill: s.color } : false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ------------------------- 4. Road loss per period ----------------------- */

export function RoadChart({ points, unit, onPick }: { points: BucketPoint[]; unit: ChartUnit; onPick?: PickPeriod }) {
  const data = points
    .filter((d) => d.plant.liters > 0)
    .map((d) => {
      const value = pick(d.road, unit);
      const sent = pick(d.plant, unit) - value;
      return { day: d.day, label: d.label, value, pct: sent ? (value / sent) * 100 : 0 };
    });
  return (
    <ChartCard
      title="Road loss / gain"
      info={`${unitText(unit)}: plant received minus what really left the ZMCC (the dispatched litres at the tank milk quality). Periods without a plant receipt are left out.`}
      legend={[
        { label: 'Loss', color: STAGE_COLORS.loss },
        { label: 'Gain', color: STAGE_COLORS.gain },
      ]}
    >
      <div className="h-60">
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">No plant receipts in these days</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="30%"
              style={onPick ? { cursor: 'pointer' } : undefined}
              onClick={(st: unknown) => {
                const i = clickIndex(st);
                if (onPick && i != null && data[i]) onPick(data[i].day);
              }}
            >
              <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
              <XAxis {...timeAxis} />
              <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} domain={withZero} />
              <ReferenceLine y={0} stroke={STAGE_COLORS.zero} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TooltipBox
                      title={d.label}
                      rows={[
                        { label: d.value < 0 ? 'Loss' : 'Gain', value: `${fmt(Math.abs(d.value))} L`, color: d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain },
                        { label: 'Of milk sent', value: `${fmt(d.pct, 2)}%` },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar dataKey="value" radius={4} maxBarSize={16}>
                {data.map((d) => (
                  <Cell key={d.label} fill={d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/* ------------------------------ 5. TS lines ------------------------------ */

export function TsChart({ points, onPick }: { points: BucketPoint[]; onPick?: PickPeriod }) {
  const data = points
    .filter((d) => d.ts.intake != null || d.ts.slip != null || d.ts.plant != null)
    .map((d) => ({ day: d.day, label: d.label, intake: d.ts.intake, dispatch: d.ts.slip, plant: d.ts.plant }));
  const values = data.flatMap((d) => [d.intake, d.dispatch, d.plant]).filter((v): v is number => v != null);
  const lo = values.length ? Math.floor((Math.min(...values) - 0.1) * 10) / 10 : 12;
  const hi = values.length ? Math.ceil((Math.max(...values) + 0.1) * 10) / 10 : 14;
  const series = [
    { key: 'intake', label: 'ZMCC intake TS', color: STAGE_COLORS.mc },
    { key: 'plant', label: 'Plant TS', color: STAGE_COLORS.plant },
    { key: 'dispatch', label: 'ZMCC dispatch TS', color: STAGE_COLORS.dispatch },
  ] as const;
  return (
    <ChartCard
      title="Milk quality (TS)"
      info="TS = Fat + SNF. Intake and plant should be close. A ZMCC dispatch line above both means the dispatch test is written high."
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
    >
      <div className="h-60">
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">No tests in these days</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              style={onPick ? { cursor: 'pointer' } : undefined}
              onClick={(st: unknown) => {
                const i = clickIndex(st);
                if (onPick && i != null && data[i]) onPick(data[i].day);
              }}
            >
              <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
              <XAxis {...timeAxis} />
              <YAxis {...axisProps} axisLine={false} width={44} domain={[lo, hi]} tickFormatter={(v: number) => fmt(v, 1)} />
              <Tooltip
                cursor={{ stroke: STAGE_COLORS.zero, strokeWidth: 1 }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? <TooltipBox title={d.label} rows={series.map((s) => ({ label: s.label, value: fmt(d[s.key], 2), color: s.color }))} /> : null;
                }}
              />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={data.length <= 31 ? { r: 3, strokeWidth: 2, stroke: '#ffffff', fill: s.color } : false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/* --------------------------- 6. ZMCC ranking ----------------------------- */

export function ZmccRankingChart({ zmccs, unit, onPickZmcc }: { zmccs: StageZmccRow[]; unit: ChartUnit; onPickZmcc?: (id: string) => void }) {
  const data = zmccs
    .map((z) => {
      const base = pick(intakeOf(z), unit);
      const whole = pick(z.loss.whole, unit);
      const in13 = intakeOf(z).at13ts;
      return { id: z.zmccId, name: z.zmccName, value: base ? (whole / base) * 100 : 0, amount: whole, over: in13 ? (z.loss.slipOver13ts / in13) * 100 : 0 };
    })
    .sort((a, b) => a.value - b.value);
  return (
    <ChartCard title="Whole loss / gain by ZMCC" info={`Whole loss or gain (shops and HC to plant) as a share of the ZMCC's intake, ${unitText(unit)}. Worst first. Click a ZMCC to show only it.`}>
      <div style={{ height: Math.max(140, data.length * 44 + 40) }}>
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">No ZMCC milk in these days</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, left: 8, bottom: 0 }} barCategoryGap="40%">
              <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
              <XAxis type="number" {...axisProps} tickFormatter={(v: number) => `${fmt(v, 1)}%`} domain={withZeroRoom} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={110} />
              <ReferenceLine x={0} stroke={STAGE_COLORS.zero} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TooltipBox
                      title={d.name}
                      rows={[
                        { label: d.value < 0 ? 'Loss' : 'Gain', value: `${fmt(Math.abs(d.value), 2)}%`, color: d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain },
                        { label: unitText(unit), value: `${fmt(d.amount)} L` },
                        { label: 'Dispatch overstated', value: `${fmt(d.over, 2)}%` },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar
                dataKey="value"
                radius={4}
                maxBarSize={18}
                label={endLabel((v) => `${fmt(v, 1)}%`)}
                style={onPickZmcc ? { cursor: 'pointer' } : undefined}
                onClick={(entry: unknown) => {
                  const id = (entry as { payload?: { id?: string } } | null)?.payload?.id;
                  if (onPickZmcc && id) onPickZmcc(id);
                }}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/* --------------------------- 7. Calendar heatmap ------------------------- */

const STEPS = [
  { max: -2, color: '#b42d2c', label: 'Loss above 2%' },
  { max: -0.5, color: '#e34948', label: 'Loss 0.5–2%' },
  { max: -0.05, color: '#f4a3a1', label: 'Loss under 0.5%' },
  { max: 0.05, color: '#e5e7eb', label: 'Even' },
  { max: 0.5, color: '#a7dfc0', label: 'Gain under 0.5%' },
  { max: Infinity, color: '#1f9d55', label: 'Gain 0.5% or more' },
];

export function RoadCalendar({ days, unit, onPick }: { days: StageDay[]; unit: ChartUnit; onPick?: PickPeriod }) {
  const [hover, setHover] = React.useState<{ day: string; pct: number | null; road: number } | null>(null);
  if (days.length === 0) return null;
  const first = new Date(`${days[0].day}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<{ day: string; pct: number | null; road: number } | null> = Array.from({ length: lead }, () => null);
  for (const d of days) {
    const road = pick(d.road, unit);
    const sent = pick(d.plant, unit) - road;
    cells.push({ day: d.day, pct: d.plant.liters > 0 && sent ? (road / sent) * 100 : null, road });
  }
  const weeks = Math.ceil(cells.length / 7);
  const colorOf = (pct: number | null) => (pct == null ? '#f8fafc' : STEPS.find((s) => pct <= s.max)!.color);
  return (
    <ChartCard title="Road loss calendar" info="Each square is a day (weeks run down, Monday first), coloured by road loss or gain as a share of the milk sent. Pale: no plant receipt that day.">
      <div className="overflow-x-auto">
        <div className="inline-grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'repeat(7, 14px)', gridTemplateColumns: `repeat(${weeks}, 14px)` }}>
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const c = cells[i] ?? null;
            if (!c) return <span key={i} className="h-3.5 w-3.5" aria-hidden="true" />;
            return (
              <button
                key={c.day}
                type="button"
                className="h-3.5 w-3.5 rounded-[3px] outline-offset-1 focus-visible:outline-2 focus-visible:outline-primary"
                style={{ backgroundColor: colorOf(c.pct) }}
                aria-label={`${c.day}: ${c.pct == null ? 'no plant receipt' : `${c.pct < 0 ? 'loss' : 'gain'} ${fmt(Math.abs(c.pct), 2)}%`}`}
                onClick={() => onPick?.(c.day)}
                onMouseEnter={() => setHover(c)}
                onFocus={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
              />
            );
          })}
        </div>
      </div>
      <p className="mt-2 min-h-5 text-xs tabular-nums text-secondary-foreground">
        {hover
          ? `${shortDay(hover.day)}: ${hover.pct == null ? 'no plant receipt' : `${hover.pct < 0 ? 'loss' : 'gain'} ${fmt(Math.abs(hover.pct), 2)}% (${fmt(Math.abs(hover.road))} L)`}`
          : 'Point at a day to see it'}
      </p>
      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary-foreground">
        {STEPS.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/* --------------------------- One stage, by period ------------------------ */

export function OneStageChart({
  title,
  color,
  points,
  unit,
  onPick,
}: {
  title: string;
  color: string;
  points: Array<{ day: string; label: string; value: number }>;
  unit: ChartUnit;
  onPick?: PickPeriod;
}) {
  return (
    <ChartCard title={title} info={`${unitText(unit)} for this stage. Every figure is also in the table below.`}>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={points}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="30%"
            style={onPick ? { cursor: 'pointer' } : undefined}
            onClick={(st: unknown) => {
              const i = clickIndex(st);
              if (onPick && i != null && points[i]) onPick(points[i].day);
            }}
          >
            <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
            <XAxis {...timeAxis} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TipProps) => {
                const d = p.payload?.[0]?.payload as (typeof points)[number] | undefined;
                return p.active && d ? <TooltipBox title={d.label} rows={[{ label: unitText(unit), value: `${fmt(d.value)} L`, color }]} /> : null;
              }}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* --------------------------------- Board --------------------------------- */

export function StageChartsBoard({
  report,
  unit,
  bucket,
  onPick,
  onPickZmcc,
}: {
  report: StageChainReport;
  unit: ChartUnit;
  bucket: ChartBucket;
  onPick?: PickPeriod;
  onPickZmcc?: (id: string) => void;
}) {
  const points = bucketDays(report.daily, bucket);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <StageTotalsChart report={report} unit={unit} />
      <LossBreakdownChart report={report} unit={unit} />
      <IntakeDispatchChart points={points} unit={unit} onPick={onPick} />
      <TsChart points={points} onPick={onPick} />
      <RoadChart points={points} unit={unit} onPick={onPick} />
      <RoadCalendar days={report.daily} unit={unit} onPick={(d) => onPick?.(d)} />
      <ZmccRankingChart zmccs={report.zmccs} unit={unit} onPickZmcc={onPickZmcc} />
    </div>
  );
}

/* ------------------------- Ranked bars (drill-down) ---------------------- */

export function RankedBarsChart({
  title,
  info,
  rows,
  signed,
  color,
  format,
  percent,
}: {
  title: string;
  info: string;
  /** The values are percentages: the axis shows %. */
  percent?: boolean;
  rows: Array<{ id: string; name: string; value: number; tip: Array<{ label: string; value: string }> }>;
  /** Loss red / gain green around zero, instead of one colour. */
  signed?: boolean;
  color?: string;
  format: (v: number) => string;
}) {
  const data = rows.slice(0, 12);
  return (
    <ChartCard title={title} info={rows.length > 12 ? `${info} The 12 largest are shown; all are in the table.` : info}>
      <div style={{ height: Math.max(140, data.length * 36 + 40) }}>
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">Nothing in these days</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 0 }} barCategoryGap="35%">
              <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
              <XAxis type="number" {...axisProps} allowDecimals={!!percent} tickFormatter={(v: number) => (percent ? `${fmt(v, 1)}%` : compact(v))} domain={signed ? withZeroRoom : [0, (max: number) => max * 1.25]} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={140} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
              {signed ? <ReferenceLine x={0} stroke={STAGE_COLORS.zero} /> : null}
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? <TooltipBox title={d.name} rows={d.tip} /> : null;
                }}
              />
              <Bar dataKey="value" radius={4} maxBarSize={16} label={endLabel(format)}>
                {data.map((d) => (
                  <Cell key={d.id} fill={signed ? (d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain) : (color ?? STAGE_COLORS.mc)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}
