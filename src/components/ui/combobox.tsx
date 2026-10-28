'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra text that is searched but not shown (code, owner, area...). */
  keywords?: string;
  /** Option is disabled / cannot be selected */
  disabled?: boolean;
  /** Optional reason explaining why option is disabled */
  disabledReason?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** Searchable select: type to filter, arrow keys + Enter to pick, Esc to close. */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Type to search',
  emptyText = 'No match found',
  id,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  const pick = (o: ComboboxOption) => {
    if (o.disabled) return;
    onValueChange(o.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active] && !filtered[active].disabled) pick(filtered[active]);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQuery('');
          setActive(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-white px-3.5 text-left text-sm font-semibold text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
            className
          )}
        >
          <span className={cn('truncate', !selected && 'font-normal text-slate-500')}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-11 w-full bg-transparent text-sm outline-hidden"
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-slate-500">{emptyText}</li>
          ) : (
            filtered.map((o, i) => {
              const isDisabled = Boolean(o.disabled);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={isDisabled}
                  onMouseEnter={() => {
                    if (!isDisabled) setActive(i);
                  }}
                  onClick={() => {
                    if (!isDisabled) pick(o);
                  }}
                  className={cn(
                    'flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm transition-colors',
                    isDisabled
                      ? 'cursor-not-allowed opacity-60 bg-muted/20 text-muted-foreground select-none'
                      : 'cursor-pointer hover:bg-muted text-foreground',
                    i === active && !isDisabled && 'bg-muted'
                  )}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className={cn('truncate', isDisabled && 'text-slate-500 font-normal')}>
                      {o.label}
                    </span>
                    {isDisabled && o.disabledReason && (
                      <span className="text-[10px] text-amber-700 font-medium truncate">
                        {o.disabledReason}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isDisabled && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                        Busy
                      </span>
                    )}
                    {o.value === value && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
