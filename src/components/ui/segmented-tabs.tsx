'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SegmentedTab<T extends string> {
  value: T;
  label: string;
  /** Icon component (e.g. a lucide icon) or a pre-rendered element. */
  icon?: React.ComponentType<{ className?: string }> | React.ReactElement;
  /** Optional count badge (queue sizes etc.). */
  count?: number;
  /** Optional short status pill shown instead of a count. */
  badge?: string;
  /** DOM ids linking the tab to its tabpanel (aria-controls / aria-labelledby). */
  id?: string;
  panelId?: string;
}

interface SegmentedTabsProps<T extends string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}

/**
 * The single tab style used across workspaces: a quiet segmented control with an
 * animated active indicator. Arrow keys move between tabs (roving tabindex).
 */
export function SegmentedTabs<T extends string>({ tabs, value, onValueChange, label, className }: SegmentedTabsProps<T>) {
  const id = React.useId();
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onValueChange(tabs[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'scrollbar-none inline-flex lg:hidden max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border bg-muted/60 p-0.5',
        className
      )}
    >
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        const icon = tab.icon;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={tab.id}
            aria-controls={tab.panelId}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'relative inline-flex min-h-11 min-w-11 justify-center shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {active ? (
              <motion.span
                layoutId={`segmented-tab-${id}`}
                className="absolute inset-0 rounded-md border bg-card shadow-2xs"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            ) : null}
            <span className="relative z-raised inline-flex items-center gap-2">
              {icon ? (
                <span className={cn('inline-flex [&_svg]:h-4 [&_svg]:w-4', active ? 'text-primary' : 'text-muted-foreground')}>
                  {React.isValidElement(icon) ? icon : React.createElement(icon as React.ComponentType<{ className?: string }>)}
                </span>
              ) : null}
              <span className="whitespace-nowrap">{tab.label}</span>
              {typeof tab.count === 'number' ? (
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 text-center text-[11px] font-medium tabular-nums leading-5',
                    active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
              {tab.badge ? (
                <span className="rounded-full bg-emerald-50 px-1.5 text-[11px] font-medium leading-5 text-emerald-700">
                  {tab.badge}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
