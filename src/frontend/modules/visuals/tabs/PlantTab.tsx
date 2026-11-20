'use client';

import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from 'recharts';
import { cn } from '@/lib/utils';
import { ErrorPopup } from '@/components/ui/error-popup';
import {
  HISTOGRAM_LABELS,
  PLANT_STAGE_KEYS,
  PLANT_STAGE_LABELS,
  rejectionRate,
  slowestStage,
  weightedMedian,
  type PlantDayRow,
  type PlantSourceRow,
  type PlantStageKey,
  type PlantType,
  type PlantView,
  type PlantVisuals,
} from '@/backend/modules/management-reporting/visuals/plantContracts';
import type { VisualsTabProps } from '../VisualsWorkspace';
import {
  ACCEPT_COLOR,
  AcceptRejectBars,
  ChartCard,
  ChartGrid,
  DonutChart,
  EmptyChart,
  KpiRow,
  KpiTile,
  REJECT_COLOR,
  SERIES_COLORS,
  STAGE_COLORS,
  TipBox,
  TrendChart,
  VisualTable,
  bucketRows,
  fmtMinutes,
  fmtMinutesAxis,
  fmtNum,
  fmtPct,
  useVisuals,
} from '../visualsKit';

type TipProps = TooltipContentProps<TooltipValueType, string | number>;
const axisProps = { tick: { fontSize: 11, fill: STAGE_COLORS.axis }, tickLine: false, axisLine: { stroke: STAGE_COLORS.grid } } as const;
/** One colour per stage, in the order a vehicle goes through them. */
const STAGE_PALETTE = [...SERIES_COLORS, '#0ea5b7', '#d6409f', '#64748b'];
const HIGHLIGHT = SERIES_COLORS[3];
const TYPE_LABEL: Record<PlantType, string> = { ALL: 'All', ZMCC: 'ZMCC', CONTRACTOR: 'Contractor' };

/** Pakistan time as "2026-10-16 08:33", which also sorts as text. */
const pkStamp = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Karachi' }).slice(0, 16);
const typeName = (t: string) => (t === 'ZMCC' ? 'ZMCC' : t === 'CONTRACTOR' ? 'Contractor' : '—');
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Daily row with the median worked out from its weighted sums, so weeks and months stay fair. */
type DayPoint = PlantDayRow & { median: number | null; p90: number | null; rate: number | null };
const deriveDay = (r: DayPoint): DayPoint => ({
  ...r,
  median: weightedMedian(r.medW, r.n),
  p90: weightedMedian(r.p90W, r.n),
  rate: rejectionRate(r.accepted, r.rejected),
});

/** A column chart for a short list of counts (hour of day, time in plant). */
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
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={14} />
              <YAxis {...axisProps} axisLine={false} width={36} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as { label: string; value: number } | undefined;
                  return p.active && d ? <TipBox title={d.label} rows={[{ label: 'Vehicles', value: fmtNum(d.value), color }]} /> : null;
                }}
              />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/** Median minutes per stage; the slowest stage is highlighted, the 90th percentile is in the tooltip. */
function StageBars({ view }: { view: PlantView }) {
  const meds = Object.fromEntries(PLANT_STAGE_KEYS.map((k) => [k, view.stages[k].median])) as Record<PlantStageKey, number | null>;
  const slow = slowestStage(meds);
  const data = PLANT_STAGE_KEYS.map((k) => ({ key: k, name: PLANT_STAGE_LABELS[k], value: view.stages[k].median ?? 0, ...view.stages[k] }));
  const empty = !data.some((d) => d.n > 0);
  return (
    <ChartCard
      title="Time per stage"
      info="Median minutes from one plant step to the next. Only vehicles with both times count. The slowest stage is orange; the 90th percentile is in the tooltip."
    >
      <div style={{ height: 340 }}>
        {empty ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
              <XAxis type="number" {...axisProps} tickFormatter={(v: number) => fmtMinutesAxis(v)} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={150} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return p.active && d ? (
                    <TipBox
                      title={d.name}
                      rows={[
                        { label: 'Median', value: fmtMinutes(d.median) },
                        { label: '90th percentile', value: fmtMinutes(d.p90) },
                        { label: 'Average', value: fmtMinutes(d.avg) },
                        { label: 'Vehicles', value: fmtNum(d.n) },
                      ]}
                    />
                  ) : null;
                }}
              />
              <Bar dataKey="value" maxBarSize={20} radius={[0, 4, 4, 0]}>
                {data.map((d) => (
                  <Cell key={d.key} fill={d.key === slow ? HIGHLIGHT : SERIES_COLORS[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/** Median minutes per stage for the busiest sources, stacked. */
function SourceStageBars({ sources }: { sources: PlantSourceRow[] }) {
  const data = sources
    .filter((s) => PLANT_STAGE_KEYS.some((k) => s.stages[k] != null))
    .slice(0, 12)
    .map((s) => ({ name: s.name, ...Object.fromEntries(PLANT_STAGE_KEYS.map((k) => [k, s.stages[k] ?? 0])) }) as Record<string, number | string>);
  return (
    <ChartCard
      title="Stage time by source"
      info="Median minutes of each stage, added up per source. The 12 sources with most vehicles. The sum of medians is not the median total."
      legend={PLANT_STAGE_KEYS.map((k, i) => ({ label: PLANT_STAGE_LABELS[k], color: STAGE_PALETTE[i] }))}
    >
      <div style={{ height: Math.max(160, data.length * 34 + 40) }}>
        {data.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid horizontal={false} stroke={STAGE_COLORS.grid} />
              <XAxis type="number" {...axisProps} tickFormatter={(v: number) => fmtMinutesAxis(v)} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={140} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={(p: TipProps) => {
                  const d = p.payload?.[0]?.payload as Record<string, number | string> | undefined;
                  return p.active && d ? (
                    <TipBox
                      title={String(d.name)}
                      rows={PLANT_STAGE_KEYS.map((k, i) => ({ label: PLANT_STAGE_LABELS[k], value: fmtMinutes(Number(d[k])), color: STAGE_PALETTE[i] })).filter((r) => r.value !== '0 m')}
                    />
                  ) : null;
                }}
              />
              {PLANT_STAGE_KEYS.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="s" fill={STAGE_PALETTE[i]} maxBarSize={18} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

/** Plant tab: time inside the plant, time per stage, slowest vehicles, accepted and rejected. */
export function PlantTab({ filters, setFilters, options, bucket, ids }: VisualsTabProps) {
  const query = useVisuals<PlantVisuals>('PLANT', filters, ids);
  const [type, setType] = React.useState<PlantType>('ALL');
  const cur = query.data?.current;
  const prev = query.data?.previous;
  const view = cur?.views[type];
  const before = prev?.views[type];

  const contractors = options?.contractors ?? [];
  const toggleContractor = (id: string) =>
    setFilters({ ...filters, contractorIds: filters.contractorIds.includes(id) ? filters.contractorIds.filter((x) => x !== id) : [...filters.contractorIds, id] });

  const points = React.useMemo(
    () => (view ? bucketRows(view.days.map((d) => ({ ...d, median: null, p90: null, rate: null }) as DayPoint), bucket, deriveDay) : []),
    [view, bucket]
  );
  const sources = React.useMemo(() => (cur?.sources ?? []).filter((s) => type === 'ALL' || s.type === type), [cur, type]);
  const slowest = React.useMemo(() => (cur?.slowest ?? []).filter((r) => type === 'ALL' || r.type === type).slice(0, 15), [cur, type]);
  const longInside = React.useMemo(() => (cur?.longInside ?? []).filter((r) => type === 'ALL' || r.type === type), [cur, type]);

  const weekNote = bucket === 'DAY' ? '' : ' Weeks and months are the average of the daily medians, weighted by vehicles.';

  return (
    <div className="space-y-4">
      <ErrorPopup message={query.isError ? 'The plant figures could not be loaded.' : null} onRetry={() => void query.refetch()} />

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card p-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
        <div role="group" aria-label="Source type" className="inline-flex rounded-xl border border-border p-0.5">
          {(['ALL', 'ZMCC', 'CONTRACTOR'] as PlantType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={cn('min-h-9 rounded-lg px-3 text-xs font-semibold', type === t ? 'bg-primary/10 text-primary' : 'text-secondary-foreground hover:bg-muted')}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {contractors.length ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Contractors">
            {contractors.map((c) => {
              const on = filters.contractorIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleContractor(c.id)}
                  aria-pressed={on}
                  className={cn('min-h-8 rounded-full border px-3 text-xs font-medium', on ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-secondary-foreground hover:bg-muted')}
                >
                  {c.name}
                </button>
              );
            })}
            {filters.contractorIds.length ? (
              <button type="button" onClick={() => setFilters({ ...filters, contractorIds: [] })} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary/10">
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!view ? (
        <p className="text-sm text-muted-foreground">{query.isError ? '' : 'Loading…'}</p>
      ) : (
        <>
          <KpiRow>
            <KpiTile label="Vehicles in" kind="Count" value={view.vehicles} previous={before?.vehicles} format={(v) => fmtNum(v)} better="none" info="Vehicles that entered the gate in these days, cancelled visits left out." />
            <KpiTile label="Median in plant" kind="Typical (median)" value={view.total.median} previous={before?.total.median} format={fmtMinutes} better="down" info="Gate entry to gate exit, vehicles with both times." sub={`${fmtNum(view.total.n)} vehicles`} />
            <KpiTile label="Slowest 10%" kind="Slowest 10%" value={view.total.p90} previous={before?.total.p90} format={fmtMinutes} better="down" info="90th percentile: nine in ten vehicles leave sooner than this." />
            <KpiTile
              label="Rejection rate" kind="Rate"
              value={rejectionRate(view.accepted, view.rejected)}
              previous={before ? rejectionRate(before.accepted, before.rejected) : undefined}
              format={(v) => fmtPct(v)}
              better="down"
              info="Rejected share of accepted and rejected portions at the plant. Pending portions are left out."
              sub={`${fmtNum(view.rejected)} of ${fmtNum(view.accepted + view.rejected)}`}
            />
            <KpiTile label="Still inside" kind="Now" value={view.insideNow} previous={before?.insideNow} format={(v) => fmtNum(v)} better="none" info="Entered, no gate exit yet." />
          </KpiRow>

          <ChartGrid>
            <StageBars view={view} />
            <SourceStageBars sources={sources} />
            <TrendChart
              title="Time in plant by day"
              info={`Median and 90th percentile of gate entry to gate exit.${weekNote}`}
              points={points}
              series={[
                { key: 'median', label: 'Median', color: SERIES_COLORS[0], type: 'line' },
                { key: 'p90', label: '90th percentile', color: SERIES_COLORS[3], type: 'line' },
              ]}
              format={fmtMinutesAxis}
              tipFormat={fmtMinutes}
            />
            <ColumnChart
              title="Time in plant"
              info="Vehicles by hours between gate entry and gate exit."
              rows={HISTOGRAM_LABELS.map((label, i) => ({ label, value: view.histogram[i] ?? 0 }))}
              color={SERIES_COLORS[0]}
            />
            <ColumnChart
              title="Gate entries by hour"
              info="Pakistan time, all days together."
              rows={view.hours.map((value, h) => ({ label: `${String(h).padStart(2, '0')}h`, value }))}
              color={SERIES_COLORS[2]}
            />
            <AcceptRejectBars
              title="Accepted and rejected by source"
              info="Share of plant decisions per source, highest rejection first. Pending left out."
              rows={[...sources].sort((a, b) => (rejectionRate(b.accepted, b.rejected) ?? -1) - (rejectionRate(a.accepted, a.rejected) ?? -1)).map((s) => ({ id: s.id, name: s.name, accepted: s.accepted, rejected: s.rejected }))}
            />
            <TrendChart
              title="Accepted and rejected by day"
              info="Portions decided at the plant, by the day of the vehicle."
              points={points}
              series={[
                { key: 'accepted', label: 'Accepted', color: ACCEPT_COLOR, stack: 'd' },
                { key: 'rejected', label: 'Rejected', color: REJECT_COLOR, stack: 'd' },
              ]}
            />
            <DonutChart
              title="Rejection reasons"
              info="Reasons typed at the plant, cleaned and grouped. The five largest are shown; all are in the table."
              rows={view.reasons.map((r) => ({ id: r.reason === 'Others' ? '__others' : r.reason, name: cap(r.reason), value: r.count }))}
              format={(v) => fmtNum(v)}
              centerLabel="rejected"
            />
            <VisualTable
              title="Reasons"
              rows={view.reasons}
              rowKey={(r) => r.reason}
              initialSort="count"
              columns={[
                { key: 'reason', label: 'Reason', value: (r) => cap(r.reason) },
                { key: 'count', label: 'Portions', value: (r) => r.count, align: 'right' },
              ]}
            />
          </ChartGrid>

          <VisualTable
            title="Slowest vehicles"
            rows={slowest}
            rowKey={(r) => r.visitId}
            initialSort="total"
            columns={[
              { key: 'vehicle', label: 'Vehicle', value: (r) => r.vehicle },
              { key: 'source', label: 'Source', value: (r) => r.source },
              { key: 'type', label: 'Type', value: (r) => typeName(r.type) },
              { key: 'entry', label: 'In', value: (r) => pkStamp(r.entry) },
              { key: 'exit', label: 'Out', value: (r) => pkStamp(r.exit) },
              { key: 'total', label: 'Total', value: (r) => r.totalMin, format: fmtMinutes, align: 'right' },
              { key: 'stage', label: 'Longest stage', value: (r) => (r.longestStage ? `${PLANT_STAGE_LABELS[r.longestStage]} · ${fmtMinutes(r.longestMin)}` : null) },
            ]}
          />

          {longInside.length ? (
            <VisualTable
              title="Inside over 12 h"
              rows={longInside}
              rowKey={(r) => r.visitId}
              initialSort="hours"
              columns={[
                { key: 'vehicle', label: 'Vehicle', value: (r) => r.vehicle },
                { key: 'source', label: 'Source', value: (r) => r.source },
                { key: 'type', label: 'Type', value: (r) => typeName(r.type) },
                { key: 'entry', label: 'In', value: (r) => pkStamp(r.entry) },
                { key: 'hours', label: 'Hours inside', value: (r) => r.hours, format: (v) => fmtNum(v, 1), align: 'right' },
              ]}
            />
          ) : null}

          <VisualTable
            title="By source"
            rows={sources}
            rowKey={(r) => r.id}
            initialSort="vehicles"
            columns={[
              { key: 'name', label: 'Source', value: (r) => r.name },
              { key: 'type', label: 'Type', value: (r) => typeName(r.type) },
              { key: 'vehicles', label: 'Vehicles', value: (r) => r.vehicles, align: 'right' },
              { key: 'median', label: 'Median', value: (r) => r.total.median, format: fmtMinutes, align: 'right' },
              { key: 'p90', label: 'P90', value: (r) => r.total.p90, format: fmtMinutes, align: 'right' },
              { key: 'avg', label: 'Average', value: (r) => r.total.avg, format: fmtMinutes, align: 'right' },
              { key: 'accepted', label: 'Accepted', value: (r) => r.accepted, align: 'right' },
              { key: 'rejected', label: 'Rejected', value: (r) => r.rejected, align: 'right' },
              { key: 'rate', label: 'Rejected %', value: (r) => rejectionRate(r.accepted, r.rejected), format: (v) => fmtPct(v), align: 'right' },
            ]}
          />
        </>
      )}
    </div>
  );
}
