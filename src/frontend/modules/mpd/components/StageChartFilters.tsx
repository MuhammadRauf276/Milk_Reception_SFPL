'use client';

import React from 'react';
import { Calendar, Filter, Layers, X } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import type { LossFilterOptions, LossPreset } from '@/backend/modules/management-reporting/lossLevelContracts';
import { DEFAULT_LOSS_FILTERS, MAX_LOSS_DAYS, dayCount, rangeProblem, type LossFilters } from '../lossFilters';
import type { ChartBucket, ChartUnit } from './StageCharts';

const PRESETS: Array<{ value: LossPreset; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'LAST_7', label: 'Last 7' },
  { value: 'LAST_30', label: 'Last 30' },
  { value: 'MTD', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'QTD', label: 'This quarter' },
  { value: 'YTD', label: 'This year' },
];

const chip = (on: boolean) =>
  cn(
    'min-h-9 shrink-0 rounded-lg border px-2.5 text-xs font-semibold transition-colors',
    on ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card text-secondary-foreground hover:bg-muted'
  );

function Toggle<V extends string>({ label, options, value, onChange }: { label: string; options: Array<{ value: V; label: string }>; value: V; onChange: (v: V) => void }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-1 rounded-xl border border-border bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('min-h-9 rounded-lg px-2.5 text-xs font-semibold', value === o.value ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Filters for the charts, laid out like the report builder: date range, ZMCCs and day basis change the whole view
 * (and the page link); unit and grouping change only how the charts draw it.
 */
export function StageChartFilters(props: {
  filters: LossFilters;
  onChange: (next: LossFilters) => void;
  options?: LossFilterOptions;
  zmccLocked?: boolean;
  unit: ChartUnit;
  onUnit: (u: ChartUnit) => void;
  bucket: ChartBucket;
  onBucket: (b: ChartBucket) => void;
  rangeText?: string;
}) {
  const { filters, onChange, options, zmccLocked, unit, onUnit, bucket, onBucket, rangeText } = props;
  const custom = !!(filters.from && filters.to);
  const [from, setFrom] = React.useState(filters.from);
  const [to, setTo] = React.useState(filters.to);
  const [synced, setSynced] = React.useState(`${filters.from}|${filters.to}`);
  if (synced !== `${filters.from}|${filters.to}`) {
    setSynced(`${filters.from}|${filters.to}`);
    setFrom(filters.from);
    setTo(filters.to);
  }
  const problem = from && to ? rangeProblem(from, to) : null;
  const applyRange = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    if (f && t && !rangeProblem(f, t)) onChange({ ...filters, from: f, to: t });
  };
  const zmccs = (options?.zmccs ?? []).filter((z) => z.isActive || filters.zmccIds.includes(z.id));
  const toggleZmcc = (id: string) =>
    onChange({ ...filters, zmccIds: filters.zmccIds.includes(id) ? filters.zmccIds.filter((x) => x !== id) : [...filters.zmccIds, id] });
  const active = (custom ? 1 : 0) + (filters.zmccIds.length ? 1 : 0) + (filters.basis === 'business' ? 1 : 0);

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Chart filters
            {active > 0 ? <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{active} active</span> : null}
          </span>
          <div className="flex max-w-full flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Horizon:</span>
            {PRESETS.map((p) => (
              <button key={p.value} type="button" onClick={() => onChange({ ...filters, preset: p.value, from: '', to: '' })} className={chip(!custom && filters.preset === p.value)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">Group by:</span>
          <Toggle
            label="Group by"
            value={bucket}
            onChange={onBucket}
            options={[
              { value: 'DAY', label: 'Day' },
              { value: 'WEEK', label: 'Week' },
              { value: 'MONTH', label: 'Month' },
            ]}
          />
          <span className="text-xs font-medium text-muted-foreground">Show:</span>
          <Toggle
            label="Show"
            value={unit}
            onChange={onUnit}
            options={[
              { value: 'at13', label: '@13 TS' },
              { value: 'liters', label: 'Litres' },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => applyRange(e.target.value, to)} className="min-h-9 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => applyRange(from, e.target.value)} className="min-h-9 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
        </label>
        <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold tabular-nums text-primary">
          {custom ? `${filters.from} to ${filters.to} · ${dayCount(filters.from, filters.to)} d` : rangeText ?? PRESETS.find((p) => p.value === filters.preset)?.label}
        </span>
        {custom ? (
          <button
            type="button"
            onClick={() => onChange({ ...filters, from: '', to: '', preset: DEFAULT_LOSS_FILTERS.preset })}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            aria-label="Clear dates"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {problem ? <span className="text-xs text-rose-700">{problem}</span> : null}
        <Toggle
          label="Date basis"
          value={filters.basis}
          onChange={(b) => onChange({ ...filters, basis: b })}
          options={[
            { value: 'calendar', label: 'Calendar day' },
            { value: 'business', label: 'Business day' },
          ]}
        />
        <InfoTip text={`Pakistan dates, at most ${MAX_LOSS_DAYS} days. Business day runs 08:00 to 08:00. These filters change the whole Stages view, and the link keeps them.`} />
      </div>

      {!zmccLocked && zmccs.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 text-xs text-muted-foreground">ZMCC:</span>
          <button type="button" onClick={() => onChange({ ...filters, zmccIds: [] })} className={chip(filters.zmccIds.length === 0)}>
            All
          </button>
          {zmccs.map((z) => (
            <button key={z.id} type="button" onClick={() => toggleZmcc(z.id)} aria-pressed={filters.zmccIds.includes(z.id)} className={chip(filters.zmccIds.includes(z.id))}>
              {z.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
