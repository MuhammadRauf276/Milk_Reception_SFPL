'use client';

import * as React from 'react';
import { CheckCircle2, Hourglass, X } from 'lucide-react';
import { HorizontalScrollRow } from '@/components/ui/horizontal-scroll-row';
import { cn } from '@/lib/utils';

export type StepRailState = 'done' | 'current' | 'waiting' | 'rejected' | 'upcoming';

export interface StepRailApproval {
  /** Approver's role as shown on screen, e.g. "Zonal Manager". */
  roleLabel: string;
  name?: string | null;
}

export interface StepRailItem {
  key: string;
  label: React.ReactNode;
  state: StepRailState;
  /** Icon shown inside an upcoming dot. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Small lines under the label: figures first, then times. */
  lines?: Array<React.ReactNode | null | undefined | false>;
  approval?: StepRailApproval | null;
}

const DOT: Record<StepRailState, string> = {
  done: 'bg-emerald-700 border-emerald-700 text-white',
  current: 'bg-primary border-primary text-white ring-4 ring-primary/15',
  waiting: 'bg-amber-50 border-amber-500 text-amber-700 ring-4 ring-amber-500/15',
  rejected: 'bg-rose-600 border-rose-600 text-white',
  upcoming: 'bg-card border-border-strong text-muted-foreground',
};

const LABEL: Record<StepRailState, string> = {
  done: 'text-emerald-800 font-semibold',
  current: 'text-primary font-semibold',
  waiting: 'text-amber-800 font-semibold',
  rejected: 'text-rose-700 font-semibold',
  upcoming: 'text-muted-foreground',
};

const reached = (s: StepRailState | undefined) => !!s && s !== 'upcoming';

/**
 * A horizontal stepper. Each step draws the left and right halves of the line around its own dot, so the line
 * always meets every dot whatever the step widths; the travelled part is green. Scrolls inside its card on phones.
 */
export function StepRail({
  steps,
  size = 'md',
  stepClassName,
  ariaLabel,
}: {
  steps: StepRailItem[];
  size?: 'md' | 'sm';
  /** Width of each step, e.g. "min-w-28". */
  stepClassName?: string;
  ariaLabel: string;
}) {
  const dot = size === 'md' ? 'h-8 w-8' : 'h-6 w-6';
  const icon = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  return (
    <HorizontalScrollRow role="region" aria-label={ariaLabel}>
      <ol className="flex w-full min-w-max items-start py-1 md:min-w-0">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const leftOn = reached(step.state);
          const rightOn = reached(steps[i + 1]?.state);
          return (
            <li key={step.key} className={cn('flex flex-1 flex-col items-center text-center', stepClassName ?? 'min-w-24')}>
              <div className="flex w-full items-center" aria-hidden="true">
                <span className={cn('h-0.5 flex-1', i === 0 ? 'invisible' : leftOn ? 'bg-emerald-600' : 'bg-border-strong')} />
                <span
                  className={cn(
                    'flex shrink-0 items-center justify-center rounded-full border-2 transition-[color,background-color,border-color,box-shadow]',
                    dot,
                    DOT[step.state]
                  )}
                >
                  {step.state === 'done' ? (
                    <CheckCircle2 className={icon} />
                  ) : step.state === 'rejected' ? (
                    <X className={icon} />
                  ) : step.state === 'waiting' ? (
                    <Hourglass className={icon} />
                  ) : step.state === 'current' ? (
                    <span className={cn('rounded-full bg-card', size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2')} />
                  ) : Icon ? (
                    <Icon className={icon} />
                  ) : null}
                </span>
                <span className={cn('h-0.5 flex-1', i === steps.length - 1 ? 'invisible' : rightOn ? 'bg-emerald-600' : 'bg-border-strong')} />
              </div>
              <span className={cn('mt-1.5 px-1 text-xs leading-snug', LABEL[step.state])}>{step.label}</span>
              {step.lines?.filter(Boolean).map((line, j) => (
                <span key={j} className="px-1 text-xs leading-snug tabular-nums text-muted-foreground">
                  {line}
                </span>
              ))}
              {step.approval ? (
                <span className="mx-1 mt-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs leading-snug text-amber-900">
                  <span className="block font-semibold">Approval</span>
                  <span className="block">{step.approval.roleLabel}</span>
                  {step.approval.name ? <span className="block font-medium">{step.approval.name}</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </HorizontalScrollRow>
  );
}
