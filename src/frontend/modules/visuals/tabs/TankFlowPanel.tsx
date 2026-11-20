'use client';

/**
 * Tank flow for one ZMCC (or all): what went into the tanks (Mobile Testers, HC, other receipts, Super Admin
 * additions), what came out (dispatches, Super Admin removals), the level, the plant receipt and the dispatch
 * overstatement. Each part can be ticked on or off; the period summary adds up from opening to closing level.
 */
import React from 'react';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import type { StageDay } from '@/backend/modules/management-reporting/stageChainContracts';
import type { TankDay } from '@/backend/modules/management-reporting/visuals/zmccContracts';
import { flowDays, flowSummary, type FlowDay } from '@/backend/modules/management-reporting/visuals/tankFlow';
import { STAGE_COLORS, type ChartBucket, type ChartUnit } from '../../mpd/components/StageCharts';
import { TrendChart, bucketRows, fmtNum, type TrendSeries } from '../visualsKit';

type PartKey = keyof Omit<FlowDay, 'day'> | 'level';

interface Part {
  key: PartKey;
  label: string;
  color: string;
  /** in: bar above zero; out: bar below zero; line: a line. */
  kind: 'in' | 'out' | 'line';
  info: string;
  /** Only in one unit: the tank level has no @13 TS, the overstatement exists only in @13 TS. */
  only?: ChartUnit;
}

const OVER_INFO = 'Slip @13 TS minus the same litres at the tank milk quality. Plus = the slip claims more than the milk had. Not milk.';

const PARTS: Part[] = [
  { key: 'mc', label: 'MC intake', color: STAGE_COLORS.mc, kind: 'in', info: 'Milk from Mobile Testers received into the tanks.' },
  { key: 'hc', label: 'HC intake', color: STAGE_COLORS.hc, kind: 'in', info: 'Milk from HC suppliers received into the tanks.' },
  { key: 'other', label: 'Other receipts', color: STAGE_COLORS.otherPart, kind: 'in', info: 'Tank receipts not from a Mobile Tester or HC arrival.' },
  { key: 'adminIn', label: 'Admin added', color: STAGE_COLORS.shops, kind: 'in', info: 'Stock a Super Admin added to the tanks (adjustment in).' },
  { key: 'adminOut', label: 'Admin removed', color: '#a78bfa', kind: 'out', info: 'Stock a Super Admin took out of the tanks (adjustment out).' },
  { key: 'dispatch', label: 'Dispatched', color: STAGE_COLORS.dispatch, kind: 'out', info: 'What the dispatch slips say left the tanks.' },
  { key: 'over', label: 'Dispatch overstated', color: STAGE_COLORS.overstated, kind: 'line', info: OVER_INFO, only: 'at13' },
  { key: 'plant', label: 'Plant received', color: STAGE_COLORS.plant, kind: 'line', info: 'What the plant measured for the tankers it received.' },
  { key: 'level', label: 'Tank level', color: '#0f766e', kind: 'line', info: 'Litres in the tanks at the end of each period, from the tank ledger.', only: 'liters' },
];

const DEFAULT_ON: PartKey[] = ['mc', 'hc', 'other', 'adminIn', 'adminOut', 'dispatch', 'level'];

function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}
const bucketKey = (day: string, bucket: ChartBucket) => (bucket === 'DAY' ? day : bucket === 'WEEK' ? weekStart(day) : `${day.slice(0, 7)}-01`);
const L = (v: number | null) => (v == null ? '—' : `${fmtNum(v)} L`);

interface Line {
  label: string;
  value: number | null;
  sign?: '+' | '−' | '=';
  info?: string;
  strong?: boolean;
}

function Row({ l }: { l: Line }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', l.strong ? 'border-t border-border pt-1 font-semibold text-foreground' : 'text-secondary-foreground')}>
      <dt className="flex items-center gap-1">
        <span className="w-3 text-center tabular-nums">{l.sign ?? ''}</span>
        {l.label}
        {l.info ? <InfoTip text={l.info} className="-my-2" /> : null}
      </dt>
      <dd className="tabular-nums">{L(l.value)}</dd>
    </div>
  );
}

export function TankFlowPanel({
  days,
  tank,
  unit,
  bucket,
  onPick,
}: {
  days: StageDay[];
  tank: TankDay[] | null;
  unit: ChartUnit;
  bucket: ChartBucket;
  onPick?: (day: string) => void;
}) {
  const [on, setOn] = React.useState<PartKey[]>(DEFAULT_ON);
  const parts = PARTS.filter((p) => !p.only || p.only === unit);
  const active = parts.filter((p) => on.includes(p.key));
  const fd = React.useMemo(() => flowDays(days, unit), [days, unit]);
  const totals = React.useMemo(() => flowSummary(fd, unit === 'liters' ? tank : null), [fd, tank, unit]);

  const points = React.useMemo(() => {
    const level = new Map<string, number>();
    for (const d of tank ?? []) level.set(bucketKey(d.day, bucket), d.closing);
    return bucketRows(fd, bucket).map((p) => ({ ...p, adminOut: -p.adminOut, dispatch: -p.dispatch, level: level.get(p.day) ?? null }));
  }, [fd, tank, bucket]);

  const series: TrendSeries[] = active.map((p) => ({
    key: p.key,
    label: p.kind === 'out' ? `${p.label} (out)` : p.label,
    color: p.color,
    type: p.kind === 'line' ? 'line' : 'bar',
    stack: p.kind === 'in' ? 'in' : p.kind === 'out' ? 'out' : undefined,
  }));
  const unitText = unit === 'at13' ? 'L @13 TS' : 'L as measured';

  const lines: Line[] = [
    ...(unit === 'liters' ? [{ label: 'Tank level at start', value: totals.opening, info: 'From the tank ledger.' }] : []),
    { label: 'MC intake', value: totals.mc, sign: '+' },
    { label: 'HC intake', value: totals.hc, sign: '+' },
    ...(totals.other ? [{ label: 'Other receipts', value: totals.other, sign: '+' as const }] : []),
    { label: 'Admin added', value: totals.adminIn, sign: '+' },
    { label: 'Admin removed', value: totals.adminOut, sign: '−' },
    { label: 'Dispatched', value: totals.dispatch, sign: '−' },
    ...(unit === 'liters'
      ? [
          { label: 'Tank level at end', value: totals.closing, sign: '=' as const, strong: true, info: 'From the tank ledger.' },
          ...(totals.gap != null && Math.abs(totals.gap) >= 1
            ? [{ label: 'Not explained by the flows', value: totals.gap, info: 'Corrections and rounding: the ledger level moved this much more than the flows above.' }]
            : []),
        ]
      : []),
  ];

  return (
    <section className="min-w-0 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <h4 className="flex items-center gap-1 text-sm font-semibold text-foreground">
        Tank flow
        <InfoTip
          text={`Everything that went into and out of the tanks, in ${unitText}. Tick a part to show or hide it. Bars above zero went in, below zero went out. The tank level is in litres only; switch Show to Litres to see it.`}
          className="-my-2"
        />
      </h4>

      <div role="group" aria-label="Parts to show" className="flex flex-wrap gap-1.5">
        {parts.map((p) => {
          const checked = on.includes(p.key);
          return (
            <label
              key={p.key}
              className={cn(
                'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold',
                checked ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-border bg-card text-secondary-foreground'
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => setOn((cur) => (checked ? cur.filter((k) => k !== p.key) : [...cur, p.key]))}
                className="h-3.5 w-3.5"
              />
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} aria-hidden="true" />
              {p.label}
            </label>
          );
        })}
      </div>

      <TrendChart
        title={`In, out and level (${unitText})`}
        info="Bars above zero went into the tanks, below zero came out. Lines: tank level, plant received and dispatch overstated, when ticked."
        points={points}
        series={series}
        tipFormat={(v) => `${fmtNum(Math.abs(v))} L`}
        onPick={onPick}
        height={300}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <dl className="space-y-1 rounded-xl border border-border bg-subtle p-3 text-xs">
          <p className="mb-1 font-semibold text-foreground">Period totals ({unitText})</p>
          {lines.map((l) => (
            <Row key={l.label} l={l} />
          ))}
        </dl>
        <dl className="space-y-1 rounded-xl border border-border bg-subtle p-3 text-xs">
          <p className="mb-1 font-semibold text-foreground">Dispatch against intake ({unitText})</p>
          <Row l={{ label: 'Intake (MC + HC + other)', value: totals.mc + totals.hc + totals.other }} />
          <Row l={{ label: 'Dispatched', value: totals.dispatch }} />
          <Row
            l={{
              label: totals.fromStock >= 0 ? 'Dispatched from tank stock' : 'Kept in the tanks',
              value: Math.abs(totals.fromStock),
              strong: true,
              info: 'Dispatched minus intake. Above zero: more left than came in, covered by milk already in the tank or Admin additions. Below zero: the tanks kept the rest.',
            }}
          />
          {unit === 'at13' ? <Row l={{ label: 'Dispatch overstated', value: totals.over, info: OVER_INFO }} /> : null}
          <Row l={{ label: 'Plant received', value: totals.plant }} />
        </dl>
      </div>
    </section>
  );
}
