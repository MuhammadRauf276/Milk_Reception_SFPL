'use client';

/**
 * Charts for the Stage by stage report, in the style of analytics cards: white card, soft shadow, small title, thin
 * marks, hairline grid, legend with dots, hover tooltips. Colours follow the stage (validated for colour blindness):
 * shops violet, intake blue, dispatch slip orange, plant aqua. Loss red, gain green, slip difference amber.
 * Every value is also in the tables under the charts.
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
  intake: '#2a78d6',
  slip: '#eb6834',
  plant: '#1baf7a',
  loss: '#e34948',
  gain: '#1f9d55',
  slipOver: '#eda100',
  grid: '#e7e9ee',
  axis: '#6b7280',
  zero: '#9ca3af',
} as const;

const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${fmt(n / 1_000_000, 1)}M` : Math.abs(n) >= 10_000 ? `${fmt(n / 1000, 0)}k` : Math.abs(n) >= 1000 ? `${fmt(n / 1000, 1)}k` : fmt(n);
const shortDay = (d: string) => {
  const [, m, day] = d.split('-');
  return `${Number(day)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}`;
};
const intakeOf = (r: Pick<StageZmccRow, 'receivedMot' | 'receivedHc' | 'receivedOther'>): StagePair => ({
  liters: r.receivedMot.liters + r.receivedHc.liters + r.receivedOther.liters,
  at13ts: r.receivedMot.at13ts + r.receivedHc.at13ts + r.receivedOther.at13ts,
});

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
    <section className={`min-w-0 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)] ${className ?? ''}`}>
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
    <div className="min-w-40 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs shadow-lg">
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

const axisProps = {
  tick: { fontSize: 11, fill: STAGE_COLORS.axis },
  tickLine: false,
  axisLine: { stroke: STAGE_COLORS.grid },
} as const;

/* ---------------------------- 1. Stage totals ---------------------------- */

export function StageTotalsChart({ report }: { report: StageChainReport }) {
  const t = report.total;
  const data = [
    { stage: 'Shops', value: t.shops.at13ts, liters: t.shops.liters, color: STAGE_COLORS.shops },
    { stage: 'ZMCC intake', value: intakeOf(t).at13ts, liters: intakeOf(t).liters, color: STAGE_COLORS.intake },
    { stage: 'Dispatch slip', value: t.dispatchSlip.at13ts, liters: t.dispatchSlip.liters, color: STAGE_COLORS.slip },
    { stage: 'Plant', value: t.plant.at13ts, liters: t.plant.liters, color: STAGE_COLORS.plant },
  ];
  return (
    <ChartCard title="Milk at each stage" info="@13 TS litres at each stage for the chosen days. Litres and LPD are in the cards above.">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="35%">
            <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
            <XAxis dataKey="stage" {...axisProps} interval={0} tickFormatter={(v: string) => (v === 'ZMCC intake' ? 'Intake' : v === 'Dispatch slip' ? 'Slip' : v)} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p.active && d ? (
                  <TooltipBox title={d.stage} rows={[{ label: '@13 TS', value: `${fmt(d.value)} L`, color: d.color }, { label: 'Litres', value: `${fmt(d.liters)} L` }]} />
                ) : null;
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44} label={{ position: 'top', fontSize: 11, fill: '#374151', formatter: (v: unknown) => compact(Number(v)) }}>
              {data.map((d) => (
                <Cell key={d.stage} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* -------------------------- 2. Loss / gain bars -------------------------- */

export function LossBreakdownChart({ report }: { report: StageChainReport }) {
  const l = report.total.loss;
  const data = [
    { part: 'Tester trip', value: l.motTrip.at13ts, kind: 'real' },
    { part: 'Slip over', value: l.slipOver13ts, kind: 'slip' },
    { part: 'Road', value: l.road.at13ts, kind: 'real' },
    { part: 'Whole', value: l.whole.at13ts, kind: 'real' },
  ];
  const color = (d: (typeof data)[number]) => (d.kind === 'slip' ? STAGE_COLORS.slipOver : d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain);
  return (
    <ChartCard
      title="Where milk is lost or gained"
      info="@13 TS litres. Left of zero is loss, right is gain. Slip over (amber) is the dispatch slip claiming more than the milk had: a recording difference, not milk."
      legend={[
        { label: 'Loss', color: STAGE_COLORS.loss },
        { label: 'Gain', color: STAGE_COLORS.gain },
        { label: 'Slip over (not milk)', color: STAGE_COLORS.slipOver },
      ]}
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }} barCategoryGap="40%">
            <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
            <XAxis type="number" {...axisProps} tickFormatter={compact} />
            <YAxis type="category" dataKey="part" {...axisProps} axisLine={false} width={78} />
            <ReferenceLine x={0} stroke={STAGE_COLORS.zero} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p.active && d ? (
                  <TooltipBox
                    title={d.part}
                    rows={[{ label: d.kind === 'slip' ? 'Slip claims more' : d.value < 0 ? 'Loss' : 'Gain', value: `${fmt(Math.abs(d.value))} L @13 TS`, color: color(d) }]}
                  />
                ) : null;
              }}
            />
            <Bar dataKey="value" radius={4} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: '#374151', formatter: (v: unknown) => compact(Number(v)) }}>
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

/* ---------------------------- 3. Daily trend ----------------------------- */

export function DailyFlowChart({ days }: { days: StageDay[] }) {
  const data = days.map((d) => ({ day: d.day, intake: d.intake.liters, slip: d.dispatchSlip.liters, plant: d.plant.liters }));
  const series = [
    { key: 'intake', label: 'ZMCC intake', color: STAGE_COLORS.intake },
    { key: 'slip', label: 'Dispatched', color: STAGE_COLORS.slip },
    { key: 'plant', label: 'Plant received', color: STAGE_COLORS.plant },
  ] as const;
  return (
    <ChartCard title="Litres per day" info="Litres each day: received into ZMCC tanks, dispatched, and received at the plant." legend={series.map((s) => ({ label: s.label, color: s.color }))}>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
            <XAxis dataKey="day" {...axisProps} tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={28} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ stroke: STAGE_COLORS.zero, strokeWidth: 1 }}
              content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p.active && d ? (
                  <TooltipBox title={shortDay(d.day)} rows={series.map((s) => ({ label: s.label, value: `${fmt(d[s.key])} L`, color: s.color }))} />
                ) : null;
              }}
            />
            {series.map((s) => (
              <Line key={s.key} type="linear" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/* ------------------------- 4. Road loss per day -------------------------- */

export function DailyRoadChart({ days }: { days: StageDay[] }) {
  const data = days
    .filter((d) => d.plant.liters > 0)
    .map((d) => {
      const sent = d.plant.at13ts - d.road.at13ts;
      return { day: d.day, value: d.road.at13ts, pct: sent ? (d.road.at13ts / sent) * 100 : 0 };
    });
  return (
    <ChartCard
      title="Road loss / gain per day"
      info="@13 TS litres: plant received minus what really left the ZMCC (dispatched litres at the tank milk quality). Days without a plant receipt are left out."
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
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
              <XAxis dataKey="day" {...axisProps} tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={28} />
              <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
              <ReferenceLine y={0} stroke={STAGE_COLORS.zero} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TooltipBox
                      title={shortDay(d.day)}
                      rows={[
                        { label: d.value < 0 ? 'Loss' : 'Gain', value: `${fmt(Math.abs(d.value))} L @13 TS`, color: d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain },
                        { label: 'Of milk sent', value: `${fmt(d.pct, 2)}%` },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar dataKey="value" radius={4} maxBarSize={16}>
                {data.map((d) => (
                  <Cell key={d.day} fill={d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain} />
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

export function DailyTsChart({ days }: { days: StageDay[] }) {
  const data = days
    .filter((d) => d.ts.intake != null || d.ts.slip != null || d.ts.plant != null)
    .map((d) => ({ day: d.day, intake: d.ts.intake, slip: d.ts.slip, plant: d.ts.plant }));
  const values = data.flatMap((d) => [d.intake, d.slip, d.plant]).filter((v): v is number => v != null);
  const lo = values.length ? Math.floor((Math.min(...values) - 0.1) * 10) / 10 : 12;
  const hi = values.length ? Math.ceil((Math.max(...values) + 0.1) * 10) / 10 : 14;
  const series = [
    { key: 'intake', label: 'ZMCC intake TS', color: STAGE_COLORS.intake },
    { key: 'slip', label: 'Dispatch slip TS', color: STAGE_COLORS.slip },
    { key: 'plant', label: 'Plant TS', color: STAGE_COLORS.plant },
  ] as const;
  return (
    <ChartCard
      title="Milk quality (TS) per day"
      info="TS = Fat + SNF. Intake and plant should be close. A dispatch slip line above both means the dispatch test is written high."
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
    >
      <div className="h-60">
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">No tests in these days</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
              <XAxis dataKey="day" {...axisProps} tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={28} />
              <YAxis {...axisProps} axisLine={false} width={44} domain={[lo, hi]} tickFormatter={(v: number) => fmt(v, 1)} />
              <Tooltip
                cursor={{ stroke: STAGE_COLORS.zero, strokeWidth: 1 }}
                content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TooltipBox title={shortDay(d.day)} rows={series.map((s) => ({ label: s.label, value: fmt(d[s.key], 2), color: s.color }))} />
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

export function ZmccRankingChart({ zmccs }: { zmccs: StageZmccRow[] }) {
  const data = zmccs
    .map((z) => {
      const base = intakeOf(z).at13ts;
      return { name: z.zmccName, value: base ? (z.loss.whole.at13ts / base) * 100 : 0, liters: z.loss.whole.at13ts, slip: base ? (z.loss.slipOver13ts / base) * 100 : 0 };
    })
    .sort((a, b) => a.value - b.value);
  return (
    <ChartCard title="Whole loss / gain by ZMCC" info="Whole loss or gain (shops and HC to plant) as a share of the ZMCC's intake, @13 TS. Worst first.">
      <div style={{ height: Math.max(140, data.length * 44 + 40) }}>
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">No ZMCC milk in these days</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, left: 8, bottom: 0 }} barCategoryGap="40%">
              <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
              <XAxis type="number" {...axisProps} tickFormatter={(v: number) => `${fmt(v, 1)}%`} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={110} />
              <ReferenceLine x={0} stroke={STAGE_COLORS.zero} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TooltipBox
                      title={d.name}
                      rows={[
                        { label: d.value < 0 ? 'Loss' : 'Gain', value: `${fmt(Math.abs(d.value), 2)}%`, color: d.value < 0 ? STAGE_COLORS.loss : STAGE_COLORS.gain },
                        { label: '@13 TS litres', value: `${fmt(d.liters)} L` },
                        { label: 'Slip over', value: `${fmt(d.slip, 2)}%` },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar dataKey="value" radius={4} maxBarSize={18} label={{ position: 'right', fontSize: 11, fill: '#374151', formatter: (v: unknown) => `${fmt(Number(v), 1)}%` }}>
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

export function RoadCalendar({ days }: { days: StageDay[] }) {
  const [hover, setHover] = React.useState<{ day: string; pct: number | null; road: number } | null>(null);
  if (days.length === 0) return null;
  // Columns are weeks (Monday first), rows are weekdays.
  const first = new Date(`${days[0].day}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<{ day: string; pct: number | null; road: number } | null> = Array.from({ length: lead }, () => null);
  for (const d of days) {
    const sent = d.plant.at13ts - d.road.at13ts;
    cells.push({ day: d.day, pct: d.plant.liters > 0 && sent ? (d.road.at13ts / sent) * 100 : null, road: d.road.at13ts });
  }
  const weeks = Math.ceil(cells.length / 7);
  const colorOf = (pct: number | null) => (pct == null ? '#f8fafc' : STEPS.find((s) => pct <= s.max)!.color);
  return (
    <ChartCard title="Road loss calendar" info="Each square is a day, coloured by road loss or gain as a share of the milk sent. Blank: no plant receipt that day.">
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
          ? `${shortDay(hover.day)}: ${hover.pct == null ? 'no plant receipt' : `${hover.pct < 0 ? 'loss' : 'gain'} ${fmt(Math.abs(hover.pct), 2)}% (${fmt(Math.abs(hover.road))} L @13 TS)`}`
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

/* --------------------------------- Board --------------------------------- */

export function StageChartsBoard({ report }: { report: StageChainReport }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <StageTotalsChart report={report} />
      <LossBreakdownChart report={report} />
      <DailyFlowChart days={report.daily} />
      <DailyTsChart days={report.daily} />
      <DailyRoadChart days={report.daily} />
      <RoadCalendar days={report.daily} />
      <ZmccRankingChart zmccs={report.zmccs} />
    </div>
  );
}

/* --------------------------- One stage, by day --------------------------- */

export function OneStageDailyChart({ title, color, points }: { title: string; color: string; points: Array<{ day: string; liters: number; at13ts: number }> }) {
  return (
    <ChartCard title={title} info="Litres each day for this stage. The @13 TS figure is in the tooltip and the table below.">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
            <XAxis dataKey="day" {...axisProps} tickFormatter={shortDay} interval="preserveStartEnd" minTickGap={28} />
            <YAxis {...axisProps} axisLine={false} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: 'rgba(15,23,42,0.04)' }}
              content={(p: TooltipContentProps<TooltipValueType, string | number>) => {
                const d = p.payload?.[0]?.payload as (typeof points)[number] | undefined;
                return p.active && d ? (
                  <TooltipBox title={shortDay(d.day)} rows={[{ label: 'Litres', value: `${fmt(d.liters)} L`, color }, { label: '@13 TS', value: `${fmt(d.at13ts)} L` }]} />
                ) : null;
              }}
            />
            <Bar dataKey="liters" fill={color} radius={[4, 4, 0, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
