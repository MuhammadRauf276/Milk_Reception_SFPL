'use client';

/**
 * Filters for the Visuals page, kept to one calm row: the period, how to group, which unit, and total or per day.
 * Dates, day basis and ZMCCs sit behind "Filters"; whatever is narrowing the view shows as a chip that can be removed.
 */
import React from 'react';
import { Calendar, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import type { LossFilterOptions, LossPreset } from '@/backend/modules/management-reporting/lossLevelContracts';
import { DEFAULT_LOSS_FILTERS, MAX_LOSS_DAYS, dayCount, rangeProblem, type LossFilters } from '../mpd/lossFilters';
import type { ChartBucket, ChartUnit } from '../mpd/components/StageCharts';
import type { Measure } from './visualsKit';

const PRESETS: Array<{ value: LossPreset; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'LAST_7', label: 'Last 7 days' },
  { value: 'LAST_30', label: 'Last 30 days' },
  { value: 'MTD', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'QTD', label: 'This quarter' },
  { value: 'YTD', label: 'This year' },
];

function Segmented<V extends string>({ label, value, onChange, options }: { label: string; value: V; onChange: (v: V) => void; options: Array<{ value: V; label: string }> }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-0.5 rounded-xl border border-border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors',
            value === o.value ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 pl-2.5 text-xs font-semibold text-primary">
      {children}
      <button type="button" onClick={onRemove} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg hover:bg-primary/15" aria-label="Remove">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

export function VisualsFilterBar(props: {
  filters: LossFilters;
  onChange: (next: LossFilters) => void;
  options?: LossFilterOptions;
  unit: ChartUnit;
  onUnit: (u: ChartUnit) => void;
  bucket: ChartBucket;
  onBucket: (b: ChartBucket) => void;
  measure: Measure;
  onMeasure: (m: Measure) => void;
}) {
  const { filters, onChange, options, unit, onUnit, bucket, onBucket, measure, onMeasure } = props;
  const [open, setOpen] = React.useState(false);
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
  const nameOf = (id: string) => zmccs.find((z) => z.id === id)?.name ?? `ZMCC ${id}`;
  const toggleZmcc = (id: string) =>
    onChange({ ...filters, zmccIds: filters.zmccIds.includes(id) ? filters.zmccIds.filter((x) => x !== id) : [...filters.zmccIds, id] });
  const activeCount = (custom ? 1 : 0) + filters.zmccIds.length + (filters.basis === 'business' ? 1 : 0);
  const periodValue = custom ? 'CUSTOM' : filters.preset;

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex items-center">
          <span className="sr-only">Period</span>
          <Calendar className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <select
            value={periodValue}
            onChange={(e) => {
              if (e.target.value === 'CUSTOM') setOpen(true);
              else onChange({ ...filters, preset: e.target.value as LossPreset, from: '', to: '' });
            }}
            className="min-h-10 appearance-none rounded-xl border border-border bg-card pl-8 pr-8 text-sm font-semibold text-foreground"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="CUSTOM">{custom ? `${filters.from} to ${filters.to}` : 'Pick dates…'}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </label>

        <Segmented
          label="Group by"
          value={bucket}
          onChange={onBucket}
          options={[
            { value: 'DAY', label: 'Day' },
            { value: 'WEEK', label: 'Week' },
            { value: 'MONTH', label: 'Month' },
          ]}
        />
        <Segmented
          label="Unit"
          value={unit}
          onChange={onUnit}
          options={[
            { value: 'at13', label: '@13 TS' },
            { value: 'liters', label: 'Litres' },
          ]}
        />
        <Segmented
          label="Total or per day"
          value={measure}
          onChange={onMeasure}
          options={[
            { value: 'total', label: 'Total' },
            { value: 'perDay', label: 'Per day (LPD)' },
          ]}
        />
        <InfoTip
          text={`Total = the whole period. Per day (LPD) = each total divided by the days it covers, so weeks and months compare fairly. Pakistan dates, at most ${MAX_LOSS_DAYS} days. Click a bar in a chart to look at only that period or ZMCC.`}
          className="-my-2"
        />

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold',
            open || activeCount ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card text-secondary-foreground hover:bg-muted'
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters{activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>

      {activeCount ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {custom ? (
            <Chip onRemove={() => onChange({ ...filters, from: '', to: '', preset: DEFAULT_LOSS_FILTERS.preset })}>
              {filters.from} to {filters.to} · {dayCount(filters.from, filters.to)} days
            </Chip>
          ) : null}
          {filters.zmccIds.map((id) => (
            <Chip key={id} onRemove={() => toggleZmcc(id)}>
              {nameOf(id)}
            </Chip>
          ))}
          {filters.basis === 'business' ? <Chip onRemove={() => onChange({ ...filters, basis: 'calendar' })}>Business day (08:00 to 08:00)</Chip> : null}
          <button
            type="button"
            onClick={() => onChange({ ...filters, from: '', to: '', zmccIds: [], basis: 'calendar' })}
            className="min-h-8 rounded-lg px-2 text-xs font-semibold text-secondary-foreground hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-foreground">Dates</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="From"
                value={from}
                max={to || undefined}
                onChange={(e) => applyRange(e.target.value, to)}
                className="min-h-10 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                aria-label="To"
                value={to}
                min={from || undefined}
                onChange={(e) => applyRange(from, e.target.value)}
                className="min-h-10 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
              />
            </div>
            {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="flex items-center gap-1 text-xs font-semibold text-foreground">
              Day
              <InfoTip text="Calendar day: midnight to midnight. Business day: 08:00 to 08:00, as the plant counts." className="-my-2" />
            </legend>
            <Segmented
              label="Day basis"
              value={filters.basis}
              onChange={(b) => onChange({ ...filters, basis: b })}
              options={[
                { value: 'calendar', label: 'Calendar' },
                { value: 'business', label: 'Business' },
              ]}
            />
          </fieldset>
          {zmccs.length > 1 ? (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-foreground">ZMCC (none ticked = all)</legend>
              <div className="flex flex-wrap gap-1.5">
                {zmccs.map((z) => {
                  const on = filters.zmccIds.includes(z.id);
                  return (
                    <label
                      key={z.id}
                      className={cn(
                        'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold',
                        on ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card text-secondary-foreground'
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleZmcc(z.id)} className="h-3.5 w-3.5" />
                      {z.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
