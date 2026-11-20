'use client';

/**
 * Building blocks for the Visuals tabs, in the analytics-card style of the Milk flow charts: white card, soft shadow,
 * thin marks, hairline grid, dot legends, hover tooltips, one value axis per chart. Colours keep a fixed order
 * (checked for colour blindness): blue, yellow, aqua, orange, violet, then grey for "Others".
 */
import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { fetchJson } from '@/lib/query/fetchJson';
import { cn } from '@/lib/utils';
import type { VisualTab, VisualsResponse } from '@/backend/modules/management-reporting/visuals/common';
import { lossQueryParams, type LossFilters } from '../mpd/lossFilters';
import { ChartCard, RankedBarsChart, STAGE_COLORS, type ChartBucket } from '../mpd/components/StageCharts';

export { ChartCard, RankedBarsChart, STAGE_COLORS };

/** Categorical order for entities (Mobile Testers, suppliers, ZMCCs …). Never cycled: the 6th and later go to Others. */
export const SERIES_COLORS = ['#2a78d6', '#eda100', '#1baf7a', '#eb6834', '#6250d6'] as const;
export const OTHERS_COLOR = '#cbd5e1';
export const ACCEPT_COLOR = STAGE_COLORS.gain;
export const REJECT_COLOR = STAGE_COLORS.loss;

/* -------------------------------- Data ---------------------------------- */

/** Loads one tab: the chosen days and the same number of days before. Kept for a minute, like the server. */
export function useVisuals<T>(tab: VisualTab, filters: LossFilters, ids: string[] = []) {
  const q = lossQueryParams(filters);
  if (ids.length) q.set('ids', [...ids].sort().join(','));
  const qs = q.toString();
  return useQuery({
    queryKey: ['visuals', tab, qs],
    queryFn: ({ signal }) =>
      fetchJson<VisualsResponse<T>>(`/api/management/visuals/${tab.toLowerCase()}?${qs}`, { headers: { Accept: 'application/json' }, signal, timeoutMs: 30_000 }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/* ------------------------------ Formatting ------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${fmtNum(n / 1_000_000, 1)}M` : Math.abs(n) >= 10_000 ? `${fmtNum(n / 1000, 0)}k` : Math.abs(n) >= 1000 ? `${fmtNum(n / 1000, 1)}k` : fmtNum(n);
export const fmtLiters = (n: number | null | undefined) => (n == null ? '—' : `${fmtNum(n)} L`);
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null || !Number.isFinite(n) ? '—' : `${fmtNum(n, digits)}%`);
/** Minutes as "2 h 05 m" or "45 m". */
export const fmtMinutes = (m: number | null | undefined) => {
  if (m == null || !Number.isFinite(m)) return '—';
  const total = Math.round(m);
  const h = Math.floor(Math.abs(total) / 60);
  const mm = Math.abs(total) % 60;
  return `${total < 0 ? '−' : ''}${h ? `${h} h ${String(mm).padStart(2, '0')} m` : `${mm} m`}`;
};
/** Minutes for a chart axis: "45m", "5.5h", "120h". */
export const fmtMinutesAxis = (m: number) => {
  if (!Number.isFinite(m)) return '';
  const a = Math.abs(m);
  return a < 60 ? `${fmtNum(m)}m` : a < 600 ? `${fmtNum(m / 60, 1)}h` : `${fmtNum(m / 60)}h`;
};
export const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** Share of a part in a whole, in %, or null when the whole is zero. */
export const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
/** Change from before to now in %, or null when before is zero. */
export const pctChange = (now: number, before: number) => (before !== 0 ? ((now - before) / Math.abs(before)) * 100 : null);

/* ------------------------------- Grouping -------------------------------- */

function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

export type Bucketed<T> = T & { label: string };

/** Numbers add up; nested objects of numbers (like a {liters, at13ts} pair) add up field by field; other values keep the first. */
function addInto(acc: Record<string, unknown>, row: Record<string, unknown>) {
  for (const [k, v] of Object.entries(row)) {
    if (k === 'day' || k === 'label') continue;
    if (typeof v === 'number') acc[k] = (typeof acc[k] === 'number' ? (acc[k] as number) : 0) + v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = (acc[k] && typeof acc[k] === 'object' ? { ...(acc[k] as Record<string, unknown>) } : {}) as Record<string, unknown>;
      addInto(inner, v as Record<string, unknown>);
      acc[k] = inner;
    } else if (!(k in acc)) acc[k] = v;
  }
}

/**
 * Daily rows added up into weeks (Monday first) or months, labelled for the axis. Pass `derive` to work out again the
 * values that do not add up (rates, TS, averages) from the summed fields.
 */
export function bucketRows<T extends { day: string }>(rows: T[], bucket: ChartBucket, derive?: (r: T) => T): Array<Bucketed<T>> {
  if (bucket === 'DAY') return rows.map((r) => ({ ...(derive ? derive(r) : r), label: shortDay(r.day) }));
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = bucket === 'WEEK' ? weekStart(r.day) : `${r.day.slice(0, 7)}-01`;
    const acc = map.get(key) ?? { day: key };
    addInto(acc, r as unknown as Record<string, unknown>);
    map.set(key, acc);
  }
  return [...map.entries()].map(([key, acc]) => {
    const row = (derive ? derive(acc as unknown as T) : (acc as unknown as T)) as T;
    const label = bucket === 'WEEK' ? `Wk ${shortDay(key)}` : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    return { ...row, day: key, label };
  });
}

/** Keeps the largest `keep` rows by value and adds the rest up as one "Others" row. */
export function topWithOthers<R extends { id: string; name: string; value: number }>(rows: R[], keep: number): Array<{ id: string; name: string; value: number }> {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, keep).map((r) => ({ id: r.id, name: r.name, value: r.value }));
  const rest = sorted.slice(keep).reduce((s, r) => s + r.value, 0);
  return rest > 0 ? [...head, { id: '__others', name: 'Others', value: rest }] : head;
}

/* ----------------------------- Chart pieces ------------------------------ */

type TipProps = TooltipContentProps<TooltipValueType, string | number>;
const axisProps = { tick: { fontSize: 11, fill: STAGE_COLORS.axis }, tickLine: false, axisLine: { stroke: STAGE_COLORS.grid } } as const;
const clickIndex = (state: unknown): number | null => {
  const i = (state as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex;
  const n = i == null ? NaN : Number(i);
  return Number.isFinite(n) ? n : null;
};

export function TipBox({ title, rows }: { title: string; rows: Array<{ label: string; value: string; color?: string }> }) {
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

export function EmptyChart({ text = 'Nothing in these days' }: { text?: string }) {
  return <p className="flex h-full min-h-32 items-center justify-center text-xs text-muted-foreground">{text}</p>;
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  type?: 'bar' | 'line';
  /** Bars with the same stack id sit on top of each other. */
  stack?: string;
}

/**
 * Bars and/or lines over time on one value axis. `points` come from bucketRows; a series key may be a dotted path
 * (e.g. "intake.at13ts"). Click a period to narrow the view when `onPick` is given.
 */
export function TrendChart<P extends { day: string; label: string }>({
  title,
  info,
  points,
  series,
  format = fmtCompact,
  tipFormat,
  onPick,
  height = 260,
  percent,
}: {
  title: string;
  info?: string;
  points: P[];
  series: TrendSeries[];
  format?: (v: number) => string;
  tipFormat?: (v: number) => string;
  onPick?: (day: string) => void;
  height?: number;
  percent?: boolean;
}) {
  const get = (p: P, key: string): number | null => {
    const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), p);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const data = points.map((p) => {
    const row: Record<string, unknown> = { day: p.day, label: p.label };
    series.forEach((s, i) => (row[`s${i}`] = get(p, s.key)));
    return row;
  });
  const empty = !data.some((r) => series.some((_, i) => (r[`s${i}`] as number | null) != null && r[`s${i}`] !== 0));
  const tf = tipFormat ?? format;
  return (
    <ChartCard title={title} info={info} legend={series.map((s) => ({ label: s.label, color: s.color }))}>
      <div style={{ height }} className={onPick ? 'cursor-pointer' : undefined}>
        {empty ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="28%"
              onClick={
                onPick
                  ? (state: unknown) => {
                      const i = clickIndex(state);
                      if (i != null && data[i]) onPick(String(data[i].day));
                    }
                  : undefined
              }
            >
              <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
              <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v: number) => (percent ? `${fmtNum(v, 0)}%` : format(v))} domain={[(min: number) => Math.min(0, min), 'auto']} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) =>
                  p.active && p.payload?.length ? (
                    <TipBox
                      title={String(p.label ?? '')}
                      rows={series.map((s, i) => {
                        const v = p.payload?.[0]?.payload?.[`s${i}`] as number | null | undefined;
                        return { label: s.label, value: v == null ? '—' : percent ? fmtPct(v) : tf(v), color: s.color };
                      })}
                    />
                  ) : null
                }
              />
              {series.map((s, i) =>
                s.type === 'line' ? (
                  <Line key={s.key} type="linear" dataKey={`s${i}`} name={s.label} stroke={s.color} strokeWidth={2} dot={data.length <= 31 ? { r: 3 } : false} activeDot={{ r: 5 }} connectNulls />
                ) : (
                  <Bar key={s.key} dataKey={`s${i}`} name={s.label} fill={s.color} stackId={s.stack} radius={s.stack ? 0 : [4, 4, 0, 0]} maxBarSize={28} />
                )
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/** A donut of shares with a dot legend and right-aligned values. At most five named slices; the rest is "Others". */
export function DonutChart({
  title,
  info,
  rows,
  format = fmtCompact,
  centerLabel,
  colors,
}: {
  title: string;
  info?: string;
  rows: Array<{ id: string; name: string; value: number }>;
  format?: (v: number) => string;
  centerLabel?: string;
  /** Fixed colours per id (e.g. accepted green, rejected red); otherwise the categorical order. */
  colors?: Record<string, string>;
}) {
  const data = topWithOthers(rows.filter((r) => r.value > 0), 5);
  const total = data.reduce((s, r) => s + r.value, 0);
  const colorOf = (r: { id: string }, i: number) => colors?.[r.id] ?? (r.id === '__others' ? OTHERS_COLOR : SERIES_COLORS[i] ?? OTHERS_COLOR);
  return (
    <ChartCard title={title} info={info}>
      {total <= 0 ? (
        <div className="h-48">
          <EmptyChart />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="relative h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                  {data.map((r, i) => (
                    <Cell key={r.id} fill={colorOf(r, i)} />
                  ))}
                </Pie>
                <Tooltip
                  content={(p: TipProps) => {
                    const d = p.payload?.[0]?.payload as { name: string; value: number } | undefined;
                    return p.active && d ? <TipBox title={d.name} rows={[{ label: 'Value', value: format(d.value) }, { label: 'Share', value: fmtPct(share(d.value, total)) }]} /> : null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-semibold tabular-nums text-foreground">{format(total)}</span>
              {centerLabel ? <span className="text-xs text-muted-foreground">{centerLabel}</span> : null}
            </div>
          </div>
          <ul className="w-full min-w-0 space-y-1.5 text-xs">
            {data.map((r, i) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-secondary-foreground">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(r, i) }} aria-hidden="true" />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {format(r.value)} <span className="text-muted-foreground">· {fmtPct(share(r.value, total), 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

/** Accepted and rejected per name as 100% stacked horizontal bars, so rejection rates compare at a glance. */
export function AcceptRejectBars({
  title,
  info,
  rows,
}: {
  title: string;
  info?: string;
  rows: Array<{ id: string; name: string; accepted: number; rejected: number }>;
}) {
  const data = rows
    .filter((r) => r.accepted + r.rejected > 0)
    .slice(0, 12)
    .map((r) => {
      const t = r.accepted + r.rejected;
      return { ...r, acc: (r.accepted / t) * 100, rej: (r.rejected / t) * 100, total: t };
    });
  return (
    <ChartCard title={title} info={info} legend={[{ label: 'Accepted', color: ACCEPT_COLOR }, { label: 'Rejected', color: REJECT_COLOR }]}>
      <div style={{ height: Math.max(140, data.length * 34 + 40) }}>
        {data.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
              <XAxis type="number" domain={[0, 100]} {...axisProps} tickFormatter={(v: number) => `${v}%`} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={140} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TipBox
                      title={d.name}
                      rows={[
                        { label: 'Accepted', value: `${fmtNum(d.accepted)} · ${fmtPct(d.acc)}`, color: ACCEPT_COLOR },
                        { label: 'Rejected', value: `${fmtNum(d.rejected)} · ${fmtPct(d.rej)}`, color: REJECT_COLOR },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar dataKey="acc" stackId="a" fill={ACCEPT_COLOR} maxBarSize={16} />
              <Bar dataKey="rej" stackId="a" fill={REJECT_COLOR} maxBarSize={16} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/* --------------------------------- KPIs ---------------------------------- */

/**
 * One headline number with the previous period beside it. `better` says which way is good, so the change gets the
 * right colour; the arrow and sign carry the meaning without colour too.
 */
export function KpiTile({
  label,
  value,
  previous,
  format,
  info,
  better = 'up',
  sub,
  kind = 'Total',
}: {
  /** What the number is: a total for the period, per day, an average, a rate, a level now … shown on the tile. */
  kind?: 'Total' | 'Per day' | 'Average' | 'Typical (median)' | 'Slowest 10%' | 'Rate' | 'Count' | 'Now' | 'End of period';
  label: string;
  value: number | null;
  previous?: number | null;
  format: (v: number | null) => string;
  info?: string;
  better?: 'up' | 'down' | 'none';
  sub?: string;
}) {
  const change = value != null && previous != null ? pctChange(value, previous) : null;
  const dir = change == null || Math.abs(change) < 0.05 ? 0 : change > 0 ? 1 : -1;
  const good = better === 'none' || dir === 0 ? null : (dir > 0) === (better === 'up');
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <p className="flex flex-wrap items-center gap-1 text-xs font-medium text-secondary-foreground">
        {label}
        {info ? <InfoTip text={info} className="-my-2" /> : null}
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{kind}</span>
      </p>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-foreground">{format(value)}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {previous !== undefined ? (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold tabular-nums',
                good === true ? 'text-emerald-700' : good === false ? 'text-destructive' : 'text-secondary-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {change == null ? 'new' : `${change > 0 ? '+' : ''}${fmtNum(change, 1)}%`}
            </span>
            <span className="tabular-nums">before {format(previous ?? null)}</span>
          </>
        ) : null}
        {sub ? <span>{sub}</span> : null}
      </p>
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function ChartGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{children}</div>;
}

/* --------------------------------- Table --------------------------------- */

export interface VisualColumn<R> {
  key: string;
  label: string;
  value: (r: R) => number | string | null;
  format?: (v: number) => string;
  align?: 'left' | 'right';
}

/** A plain table under the charts, sortable by any column, so every value on a chart can be read exactly. */
export function VisualTable<R>({
  title,
  rows,
  columns,
  rowKey,
  initialSort,
  maxRows,
}: {
  title: string;
  rows: R[];
  columns: Array<VisualColumn<R>>;
  rowKey: (r: R) => string;
  initialSort?: string;
  /** Draw at most this many rows, after sorting all of them. */
  maxRows?: number;
}) {
  const [sort, setSort] = React.useState<{ key: string; desc: boolean }>({ key: initialSort ?? columns[1]?.key ?? columns[0].key, desc: true });
  const col = columns.find((c) => c.key === sort.key) ?? columns[0];
  const sortedAll = [...rows].sort((a, b) => {
    const x = col.value(a);
    const y = col.value(b);
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return sort.desc ? -cmp : cmp;
  });
  const sorted = maxRows != null ? sortedAll.slice(0, maxRows) : sortedAll;
  return (
    <section className="min-w-0 rounded-2xl border border-border/60 bg-card shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <h4 className="px-4 pt-4 text-sm font-semibold text-foreground">{title}</h4>
      <div className="mt-2 max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[36rem] text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-secondary-foreground">
              {columns.map((c) => (
                <th key={c.key} className={cn('px-3 py-2 font-medium', c.align === 'right' ? 'text-right' : 'text-left')}>
                  <button type="button" className="inline-flex min-h-8 items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                    {c.label}
                    {sort.key === c.key ? <span aria-hidden="true">{sort.desc ? '↓' : '↑'}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing in these days
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={rowKey(r)} className="border-b border-border/60 last:border-0">
                  {columns.map((c) => {
                    const v = c.value(r);
                    return (
                      <td key={c.key} className={cn('px-3 py-2 tabular-nums text-foreground', c.align === 'right' ? 'text-right' : 'text-left')}>
                        {v == null ? '—' : typeof v === 'number' ? (c.format ? c.format(v) : fmtNum(v)) : v}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------ Pick list -------------------------------- */

/** Check boxes for a list of names (Mobile Testers, routes, suppliers). None ticked = all. */
export function PickList({ label, items, picked, onChange }: { label: string; items: Array<{ id: string; name: string; group?: string }>; picked: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = React.useState(false);
  const groups = [...new Set(items.map((i) => i.group ?? ''))];
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-9 text-sm font-semibold text-foreground">
          {label}: {picked.length ? `${picked.length} picked` : 'All'}
        </button>
        {picked.length ? (
          <button type="button" onClick={() => onChange([])} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary/10">
            Show all
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 max-h-64 space-y-3 overflow-auto">
          {groups.map((g) => {
            const inGroup = items.filter((i) => (i.group ?? '') === g);
            const allOn = inGroup.every((i) => picked.includes(i.id));
            return (
              <div key={g || 'all'}>
                {g ? (
                  <label className="flex min-h-8 items-center gap-2 text-xs font-semibold text-secondary-foreground">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={() => onChange(allOn ? picked.filter((id) => !inGroup.some((i) => i.id === id)) : [...new Set([...picked, ...inGroup.map((i) => i.id)])])}
                    />
                    {g} (whole ZMCC)
                  </label>
                ) : null}
                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                  {inGroup.map((i) => (
                    <label key={i.id} className="flex min-h-8 items-center gap-2 text-xs text-foreground">
                      <input type="checkbox" checked={picked.includes(i.id)} onChange={() => toggle(i.id)} />
                      <span className="truncate">{i.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
