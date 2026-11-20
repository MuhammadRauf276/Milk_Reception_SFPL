'use client';

import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from 'recharts';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorPopup } from '@/components/ui/error-popup';
import { InfoTip } from '@/components/ui/info-tip';
import {
  LATE_STEPS,
  LATE_STEP_LABELS,
  TRANSIT_BUCKET_LABELS,
  medianOf,
  transitBucket,
  type TankerRow,
  type TankersVisuals,
  TANKERS_TABLE_ROWS,
} from '@/backend/modules/management-reporting/visuals/tankersContracts';
import type { VisualsTabProps } from '../VisualsWorkspace';
import {
  ChartCard,
  ChartGrid,
  DonutChart,
  EmptyChart,
  KpiRow,
  KpiTile,
  RankedBarsChart,
  SERIES_COLORS,
  STAGE_COLORS,
  TipBox,
  TrendChart,
  VisualTable,
  bucketRows,
  fmtMinutes,
  fmtNum,
  fmtPct,
  share,
  useVisuals,
} from '../visualsKit';

type TipProps = TooltipContentProps<TooltipValueType, string | number>;
const axisProps = { tick: { fontSize: 11, fill: STAGE_COLORS.axis }, tickLine: false, axisLine: { stroke: STAGE_COLORS.grid } } as const;

type ChipKey = 'next' | 'crosses' | 'shared' | 'late' | 'notYet' | 'onTime';
const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: 'next', label: 'Reached plant next day' },
  { key: 'crosses', label: 'Crosses business day' },
  { key: 'shared', label: 'Shared tank fill' },
  { key: 'late', label: 'Late entry' },
  { key: 'notYet', label: 'Not at plant yet' },
  { key: 'onTime', label: 'On time' },
];
const onTime = (r: TankerRow) => !r.nextDay && !r.crosses && !r.shared && !r.late && !r.notYet;
const MATCH: Record<ChipKey, (r: TankerRow) => boolean> = {
  next: (r) => r.nextDay,
  crosses: (r) => r.crosses,
  shared: (r) => r.shared,
  late: (r) => r.late,
  notYet: (r) => r.notYet,
  onTime,
};

/** Pakistan time as "2026-10-16 08:33", which also sorts as text. */
const pkStamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Karachi' }).slice(0, 16) : null);
const signed = (v: number) => `${v > 0 ? '+' : ''}${fmtNum(v, 1)}`;

function applyFilters(rows: TankerRow[], picked: Set<ChipKey>, text: string): TankerRow[] {
  const t = text.trim().toLowerCase();
  return rows.filter((r) => {
    if (picked.size && ![...picked].some((k) => MATCH[k](r))) return false;
    return !t || r.vehicle.toLowerCase().includes(t) || r.visitNumber.toLowerCase().includes(t);
  });
}

const DAY_MS = 86_400_000;
/** Every day between the first and last, so quiet days show as zero. */
function fillDays<T extends { day: string }>(rows: T[], empty: (day: string) => T, from: string, to: string): T[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const keys = [from, to, ...map.keys()].filter(Boolean).sort();
  if (!keys.length) return [];
  const out: T[] = [];
  for (let t = Date.parse(`${keys[0]}T00:00:00Z`), end = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`); t <= end; t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(map.get(d) ?? empty(d));
  }
  return out;
}

interface DayPoint {
  day: string;
  same: number;
  next: number;
  notYet: number;
}

function dailyPoints(rows: TankerRow[], by: 'dispatch' | 'plant', from: string, to: string): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (const r of rows) {
    const day = by === 'dispatch' ? r.dispatchDay : r.plantDay;
    if (!day) continue;
    const p = map.get(day) ?? { day, same: 0, next: 0, notYet: 0 };
    if (r.notYet) p.notYet += 1;
    else if (r.nextDay) p.next += 1;
    else p.same += 1;
    map.set(day, p);
  }
  return fillDays([...map.values()], (day) => ({ day, same: 0, next: 0, notYet: 0 }), from, to);
}

function summary(rows: TankerRow[]) {
  const nextDay = rows.filter((r) => r.nextDay).length;
  return {
    count: rows.length,
    nextDay,
    shared: rows.filter((r) => r.shared).length,
    late: rows.filter((r) => r.late).length,
    median: medianOf(rows.map((r) => r.transit).filter((v): v is number => v != null)),
  };
}

function ColumnChart({ title, info, rows, color }: { title: string; info?: string; rows: Array<{ label: string; value: number }>; color: string }) {
  const empty = !rows.some((r) => r.value > 0);
  return (
    <ChartCard title={title} info={info}>
      <div style={{ height: 240 }}>
        {empty ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={STAGE_COLORS.grid} />
              <XAxis dataKey="label" {...axisProps} interval={0} />
              <YAxis {...axisProps} axisLine={false} width={36} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as { label: string; value: number } | undefined;
                  return p.active && d ? <TipBox title={d.label} rows={[{ label: 'Tankers', value: fmtNum(d.value), color }]} /> : null;
                }}
              />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

function flagText(r: TankerRow): string {
  const f: string[] = [];
  if (r.notYet) f.push('Not at plant');
  if (r.nextDay) f.push(r.daysLater > 1 ? `+${r.daysLater} days` : 'Next day');
  if (r.crosses) f.push('Crosses day');
  if (r.shared) f.push('Shared fill');
  if (r.late) f.push('Late entry');
  return f.length ? f.join(' · ') : 'On time';
}

/** Tankers tab: dispatch against plant arrival, shared tank fills and late entry, one row per tanker. */
export function TankersTab({ filters, unit, bucket }: VisualsTabProps) {
  const query = useVisuals<TankersVisuals>('TANKERS', filters, []);
  const [picked, setPicked] = React.useState<Set<ChipKey>>(new Set());
  const [by, setBy] = React.useState<'dispatch' | 'plant'>('dispatch');
  const [text, setText] = React.useState('');
  const meta = query.data?.meta;
  const cur = query.data?.current;
  const prev = query.data?.previous;

  const rows = React.useMemo(() => applyFilters(cur?.rows ?? [], picked, text), [cur, picked, text]);
  const before = React.useMemo(() => (prev ? applyFilters(prev.rows, picked, text) : null), [prev, picked, text]);
  const sum = React.useMemo(() => summary(rows), [rows]);
  const sumBefore = React.useMemo(() => (before ? summary(before) : null), [before]);

  const points = React.useMemo(() => {
    const raw = dailyPoints(rows, by, meta?.from ?? '', meta?.to ?? '');
    return bucketRows(raw, bucket);
  }, [rows, by, meta, bucket]);

  const arrival = React.useMemo(
    () => [
      { id: 'same', name: 'Same day', value: rows.filter((r) => !r.notYet && !r.nextDay).length },
      { id: 'next', name: 'Next day or later', value: rows.filter((r) => r.nextDay).length },
      { id: 'notYet', name: 'Not at plant yet', value: rows.filter((r) => r.notYet).length },
    ],
    [rows]
  );

  const transit = React.useMemo(() => {
    const counts = TRANSIT_BUCKET_LABELS.map(() => 0);
    for (const r of rows) if (r.transit != null) counts[transitBucket(r.transit)] += 1;
    return TRANSIT_BUCKET_LABELS.map((label, i) => ({ label, value: counts[i] }));
  }, [rows]);

  const lateSteps = React.useMemo(
    () =>
      LATE_STEPS.map((s) => {
        const m = rows.filter((r) => r.lateStep === s).map((r) => r.lateMinutes ?? 0);
        return { id: s, name: LATE_STEP_LABELS[s], value: m.length, tip: [{ label: 'Median delay', value: fmtMinutes(medianOf(m)) }] };
      }).filter((r) => r.value > 0),
    [rows]
  );

  const perZmcc = React.useMemo(() => {
    const map = new Map<string, { name: string; n: number; next: number; late: number }>();
    for (const r of rows) {
      const z = map.get(r.zmccId) ?? { name: r.zmcc, n: 0, next: 0, late: 0 };
      z.n += 1;
      if (r.nextDay) z.next += 1;
      if (r.late) z.late += 1;
      map.set(r.zmccId, z);
    }
    return [...map.entries()].map(([id, z]) => ({ id, ...z }));
  }, [rows]);

  const toggle = (k: ChipKey) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const l13 = unit === 'at13';
  const slipOf = (r: TankerRow) => (l13 ? r.slip13 : r.slipLiters);
  const plantOf = (r: TankerRow) => (l13 ? r.plant13 : r.plantLiters);
  const unitText = l13 ? 'L @13 TS' : 'L';

  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The tanker figures could not be loaded.' : null} onRetry={() => void query.refetch()} />

      <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show tankers">
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            aria-pressed={picked.size === 0}
            className={cn('min-h-8 rounded-full border px-3 text-xs font-medium', picked.size === 0 ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-secondary-foreground hover:bg-muted')}
          >
            All
          </button>
          {CHIPS.map((c) => {
            const on = picked.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                aria-pressed={on}
                className={cn('min-h-8 rounded-full border px-3 text-xs font-medium', on ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-secondary-foreground hover:bg-muted')}
              >
                {c.label}
              </button>
            );
          })}
          <InfoTip
            text="Pick one or more: a tanker shows when it matches any pick. Next day: gate entry (else first weight) is on a later calendar date than the dispatch. Crosses business day: arrival and dispatch fall on different 08:00 to 08:00 days. Shared fill: two or more tankers from one tank fill. Late entry: a step was entered an hour or more after it happened. On time: none of these."
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Count by" className="inline-flex items-center rounded-xl border border-border p-0.5">
            <span className="px-2 text-xs text-secondary-foreground">Count by</span>
            {(['dispatch', 'plant'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setBy(k)}
                aria-pressed={by === k}
                className={cn('min-h-9 rounded-lg px-3 text-xs font-semibold', by === k ? 'bg-primary/10 text-primary' : 'text-secondary-foreground hover:bg-muted')}
              >
                {k === 'dispatch' ? 'Dispatch day' : 'Plant arrival day'}
              </button>
            ))}
          </div>
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Vehicle or visit number"
              aria-label="Search vehicle or visit number"
              className="min-h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
        </div>
      </div>

      {!cur ? (
        <p className="text-sm text-muted-foreground">{query.isError ? '' : 'Loading…'}</p>
      ) : (
        <>
          <KpiRow>
            <KpiTile label="Tankers dispatched" kind="Count" value={sum.count} previous={sumBefore?.count} format={(v) => fmtNum(v)} better="none" info="ZMCC dispatches in these days, drafts and cancelled left out." />
            <KpiTile
              label="Reached plant next day"
              kind="Count"
              value={sum.nextDay}
              previous={sumBefore?.nextDay}
              format={(v) => fmtNum(v)}
              better="down"
              info="Gate entry (else first weight) on a later calendar date than the dispatch."
              sub={fmtPct(share(sum.nextDay, sum.count), 0)}
            />
            <KpiTile label="Tankers from a shared fill" kind="Count" value={sum.shared} previous={sumBefore?.shared} format={(v) => fmtNum(v)} better="down" info="Tankers whose tank fill went into two or more tankers." />
            <KpiTile label="Late entries" kind="Count" value={sum.late} previous={sumBefore?.late} format={(v) => fmtNum(v)} better="down" info="A step was entered an hour or more after it happened." />
            <KpiTile label="Transit time" kind="Typical (median)" value={sum.median} previous={sumBefore?.median} format={fmtMinutes} better="down" info="Dispatch to gate entry, tankers that have arrived." />
          </KpiRow>

          {cur.cut ? <p className="text-xs text-muted-foreground">{`Only the newest ${fmtNum(cur.rows.length)} of ${fmtNum(cur.total)} dispatches are counted; pick fewer days or ZMCCs`}</p> : null}

          <ChartGrid>
            <TrendChart
              title={by === 'dispatch' ? 'Tankers by dispatch day' : 'Tankers by plant arrival day'}
              info="Same day: reached the plant on the dispatch date. Next day: a later date. Not yet: no gate entry. Tankers not yet at the plant have no arrival day."
              points={points}
              series={[
                { key: 'same', label: 'Same day', color: SERIES_COLORS[2], stack: 'd' },
                { key: 'next', label: 'Next day or later', color: SERIES_COLORS[3], stack: 'd' },
                { key: 'notYet', label: 'Not yet', color: SERIES_COLORS[1], stack: 'd' },
              ]}
              format={(v) => fmtNum(v)}
            />
            <DonutChart
              title="Arrival"
              info="Share of the tankers shown."
              rows={arrival}
              format={(v) => fmtNum(v)}
              centerLabel="tankers"
              colors={{ same: SERIES_COLORS[2], next: SERIES_COLORS[3], notYet: SERIES_COLORS[1] }}
            />
            <ColumnChart title="Transit time" info="Hours from dispatch to gate entry, tankers that have arrived." rows={transit} color={SERIES_COLORS[0]} />
            <RankedBarsChart
              title="Late entry by step"
              info="Tankers whose worst late step is this one (entered an hour or more late). The tooltip shows the median delay."
              rows={lateSteps}
              color={SERIES_COLORS[3]}
              format={(v) => fmtNum(v)}
            />
            <RankedBarsChart
              title="Next-day arrivals by ZMCC"
              info="Share of each ZMCC's tankers that reached the plant on a later date."
              percent
              color={SERIES_COLORS[3]}
              format={(v) => fmtPct(v)}
              rows={perZmcc
                .map((z) => ({ id: z.id, name: z.name, value: share(z.next, z.n) ?? 0, tip: [{ label: 'Next day', value: `${fmtNum(z.next)} of ${fmtNum(z.n)}` }] }))
                .sort((a, b) => b.value - a.value)}
            />
            <RankedBarsChart
              title="Late entries by ZMCC"
              info="Share of each ZMCC's tankers with a late entry."
              percent
              color={SERIES_COLORS[1]}
              format={(v) => fmtPct(v)}
              rows={perZmcc
                .map((z) => ({ id: z.id, name: z.name, value: share(z.late, z.n) ?? 0, tip: [{ label: 'Late', value: `${fmtNum(z.late)} of ${fmtNum(z.n)}` }] }))
                .sort((a, b) => b.value - a.value)}
            />
          </ChartGrid>

          <VisualTable
            title={rows.length > TANKERS_TABLE_ROWS ? `Tankers (first ${fmtNum(TANKERS_TABLE_ROWS)} of ${fmtNum(rows.length)} as sorted)` : `Tankers (${fmtNum(rows.length)})`}
            rows={rows}
            maxRows={TANKERS_TABLE_ROWS}
            rowKey={(r) => r.visitId}
            initialSort="dispatch"
            columns={[
              { key: 'zmcc', label: 'ZMCC', value: (r) => r.zmcc },
              { key: 'vehicle', label: 'Vehicle', value: (r) => r.vehicle },
              { key: 'visit', label: 'Visit', value: (r) => r.visitNumber },
              { key: 'dispatch', label: 'Dispatched', value: (r) => pkStamp(r.dispatchAt) },
              { key: 'gate', label: 'Gate entry', value: (r) => pkStamp(r.gateIn) },
              { key: 'receipt', label: 'Receipt', value: (r) => pkStamp(r.receiptAt) },
              { key: 'transit', label: 'Transit', value: (r) => r.transit, format: fmtMinutes, align: 'right' },
              { key: 'dday', label: 'Dispatch day', value: (r) => r.dispatchDay },
              { key: 'pday', label: 'Plant day', value: (r) => r.plantDay },
              { key: 'fill', label: 'Fill', value: (r) => (r.fillId ? `${r.fillId} · ${r.fillPos} of ${r.fillCount}` : null) },
              { key: 'slip', label: `Slip ${unitText}`, value: slipOf, format: (v) => fmtNum(v, 0), align: 'right' },
              { key: 'plant', label: `Plant ${unitText}`, value: plantOf, format: (v) => fmtNum(v, 0), align: 'right' },
              {
                key: 'diff',
                label: `Loss/gain ${unitText}`,
                value: (r) => {
                  const s = slipOf(r);
                  const p = plantOf(r);
                  return s != null && p != null ? p - s : null;
                },
                format: signed,
                align: 'right',
              },
              { key: 'flags', label: 'Flags', value: flagText },
              { key: 'late', label: 'Worst late step', value: (r) => (r.lateStep && r.lateMinutes != null ? `${LATE_STEP_LABELS[r.lateStep]} · ${fmtMinutes(r.lateMinutes)}` : null) },
            ]}
          />
        </>
      )}
    </div>
  );
}
