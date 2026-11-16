'use client';

import React, { useState } from 'react';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { Combobox } from '@/components/ui/combobox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/frontend/lib/appToast';
import { cn } from '@/lib/utils';
import type { LossFilterOptions, LossPreset } from '@/backend/modules/management-reporting/lossLevelContracts';
import { DEFAULT_LOSS_FILTERS, MAX_LOSS_DAYS, rangeProblem, type LossFilters } from '../lossFilters';

const PRESETS: Array<{ value: LossPreset; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'LAST_7', label: 'Last 7' },
  { value: 'LAST_30', label: 'Last 30' },
  { value: 'MTD', label: 'This month' },
];

interface PickItem {
  id: string;
  label: string;
  keywords?: string;
}

/** Tick one or several. "All" means no filter. Searchable once the list is long. */
const MultiPick: React.FC<{
  label: string;
  items: PickItem[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}> = ({ label, items, value, onChange, disabled }) => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(q)) : items;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const summary = value.length === 0 ? 'All' : value.length === 1 ? (items.find((i) => i.id === value[0])?.label ?? '1 picked') : `${value.length} picked`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 text-left text-sm text-foreground disabled:opacity-60"
        >
          <span className="min-w-0 truncate">
            <span className="text-xs text-muted-foreground">{label}: </span>
            {summary}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)] p-2">
        {items.length > 8 ? (
          <label className="mb-1 flex min-h-11 items-center gap-2 rounded-lg border border-border px-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label={`Search ${label}`}
              className="min-w-0 flex-1 bg-transparent text-sm focus:outline-hidden"
            />
          </label>
        ) : null}
        <div className="max-h-[50dvh] overflow-y-auto">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{value.length === 0 ? <Check className="h-4 w-4" aria-hidden="true" /> : null}</span>
            All
          </button>
          {shown.map((i) => (
            <label key={i.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
              <input type="checkbox" checked={value.includes(i.id)} onChange={() => toggle(i.id)} className="h-4 w-4 shrink-0 accent-primary" />
              <span className="min-w-0 break-words">{i.label}</span>
            </label>
          ))}
          {shown.length === 0 ? <p className="px-2 py-3 text-xs text-muted-foreground">No match</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface LossFilterBarProps {
  filters: LossFilters;
  onChange: (next: LossFilters) => void;
  options: LossFilterOptions | undefined;
  /** Contractor picker is only for the Contractor Transit level. */
  showContractor?: boolean;
  /** A ZMCC manager is locked to their own ZMCC, so the picker is hidden. */
  zmccLocked?: boolean;
  /** Echo of the range actually used, such as "Last 30 days". */
  rangeLabel?: string;
}

export const LossFilterBar: React.FC<LossFilterBarProps> = ({
  filters,
  onChange,
  options,
  showContractor = true,
  zmccLocked = false,
  rangeLabel,
}) => {
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const custom = !!(filters.from && filters.to);

  const zmccs = options?.zmccs ?? [];
  const contractors = options?.contractors ?? [];
  const testers = options?.mobileTesters ?? [];
  const testerOptions = [
    { value: '', label: 'Mobile Tester: All' },
    ...testers.map((t) => ({ value: t.id, label: t.name, keywords: `${t.code} ${t.zmccName}` })),
  ];

  const applyRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    if (!nextFrom || !nextTo) return;
    const problem = rangeProblem(nextFrom, nextTo);
    if (problem) {
      toast.error('Date range', { description: problem });
      return;
    }
    onChange({ ...filters, from: nextFrom, to: nextTo });
  };

  const pickPreset = (preset: LossPreset) => {
    setFrom('');
    setTo('');
    onChange({ ...filters, preset, from: '', to: '' });
  };

  const clearAll = () => {
    setFrom('');
    setTo('');
    onChange(DEFAULT_LOSS_FILTERS);
  };

  const chips: Array<{ key: string; text: string; remove: () => void }> = [];
  if (!zmccLocked) {
    filters.zmccIds.forEach((id) =>
      chips.push({
        key: `z${id}`,
        text: zmccs.find((z) => z.id === id)?.name ?? `ZMCC ${id}`,
        remove: () => onChange({ ...filters, zmccIds: filters.zmccIds.filter((x) => x !== id) }),
      })
    );
  }
  if (showContractor) {
    filters.contractorIds.forEach((id) =>
      chips.push({
        key: `c${id}`,
        text: contractors.find((c) => c.id === id)?.name ?? `Contractor ${id}`,
        remove: () => onChange({ ...filters, contractorIds: filters.contractorIds.filter((x) => x !== id) }),
      })
    );
  }
  if (filters.motProfileId) {
    chips.push({
      key: 'm',
      text: testers.find((t) => t.id === filters.motProfileId)?.name ?? 'Mobile Tester',
      remove: () => onChange({ ...filters, motProfileId: '' }),
    });
  }
  if (custom) chips.push({ key: 'range', text: `${filters.from} to ${filters.to}`, remove: () => pickPreset(DEFAULT_LOSS_FILTERS.preset) });
  const canClear = chips.length > 0 || filters.preset !== DEFAULT_LOSS_FILTERS.preset;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-3 shadow-2xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div role="group" aria-label="Date range" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted p-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => pickPreset(p.value)}
              className={cn(
                'min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors',
                !custom && filters.preset === p.value ? 'bg-card text-foreground shadow-2xs' : 'text-secondary-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {rangeLabel ? <span className="text-xs text-muted-foreground">{rangeLabel}</span> : null}
        <InfoTip text={`Dates are Pakistan days. A custom range can be up to ${MAX_LOSS_DAYS} days. The link keeps your choice.`} label="Filter help" />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => applyRange(e.target.value, to)}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-hidden"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => applyRange(from, e.target.value)}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground focus:outline-hidden"
          />
        </label>
        {!zmccLocked ? (
          <MultiPick
            label="ZMCC"
            items={zmccs.map((z) => ({ id: z.id, label: z.name, keywords: z.code }))}
            value={filters.zmccIds}
            onChange={(zmccIds) => onChange({ ...filters, zmccIds })}
          />
        ) : null}
        {showContractor ? (
          <MultiPick
            label="Contractor"
            items={contractors.map((c) => ({ id: c.id, label: c.name, keywords: c.code }))}
            value={filters.contractorIds}
            onChange={(contractorIds) => onChange({ ...filters, contractorIds })}
          />
        ) : null}
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <Combobox
              options={testerOptions}
              value={filters.motProfileId}
              onValueChange={(motProfileId) => onChange({ ...filters, motProfileId })}
              placeholder="Mobile Tester: All"
              searchPlaceholder="Search"
              className="min-h-11"
            />
          </div>
          <InfoTip text="Narrows MOT and Area Loss / Gain only. Transit, Whole and Contractor levels do not change." />
        </div>
      </div>

      {canClear ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border border-border bg-muted pl-3 pr-1 text-xs text-foreground">
              <span className="min-w-0 truncate">{c.text}</span>
              <button type="button" onClick={c.remove} aria-label={`Remove ${c.text}`} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full hover:bg-card">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
          {canClear ? (
            <button type="button" onClick={clearAll} className="min-h-11 rounded-lg px-3 text-xs font-semibold text-action hover:bg-action-soft">
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
