'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ActiveFilter {
  key: string;
  label: string;
  onClear: () => void;
}

interface DataFiltersProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Dropdowns and toggles. They wrap onto new lines as space runs out. */
  children?: React.ReactNode;
  /** Filters in use, shown as removable chips with a Clear all. */
  active?: ActiveFilter[];
  className?: string;
}

/** Search and filters above a list. Fits any width. */
export function DataFilters({ search, onSearchChange, searchPlaceholder = 'Search', children, active = [], className }: DataFiltersProps) {
  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {onSearchChange ? (
          <div className="relative min-w-[min(100%,14rem)] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="min-h-11 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm focus:border-primary focus:outline-hidden"
            />
          </div>
        ) : null}
        {children}
      </div>
      {active.length ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {active.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={f.onClear}
              aria-label={`Remove filter ${f.label}`}
              className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-lg border bg-subtle px-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted"
            >
              <span className="min-w-0 break-words">{f.label}</span>
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          ))}
          {active.length > 1 ? (
            <button
              type="button"
              onClick={() => active.forEach((f) => f.onClear())}
              className="min-h-9 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface FilterToggleProps<V extends string> {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
}

/** A small set of choices shown side by side, like status. */
export function FilterToggle<V extends string>({ label, options, value, onChange, className }: FilterToggleProps<V>) {
  return (
    <div role="group" aria-label={label} className={cn('flex min-w-0 flex-wrap gap-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors',
            value === o.value ? 'border-primary bg-accent text-accent-foreground' : 'border-input bg-card text-secondary-foreground hover:bg-muted'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
