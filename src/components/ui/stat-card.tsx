import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

const ICON_TONES: Record<Tone, string> = {
  default: 'text-muted-foreground',
  info: 'text-blue-600',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
};

const VALUE_TONES: Record<Tone, string> = {
  default: 'text-foreground',
  info: 'text-foreground',
  success: 'text-foreground',
  warning: 'text-foreground',
  danger: 'text-red-700',
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Colour is reserved for the icon (and danger values) so tiles stay calm. */
  tone?: Tone;
  className?: string;
}

/** KPI tile: neutral surface, muted label, prominent tabular value. */
export function StatCard({ label, value, hint, icon: Icon, tone = 'default', className }: StatCardProps) {
  return (
    <div className={cn('flex h-full flex-col rounded-xl border bg-card p-4 shadow-2xs overflow-hidden max-w-full', className)}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <p className="text-[13px] font-medium text-muted-foreground truncate">{label}</p>
        {Icon ? <Icon className={cn('h-4 w-4 shrink-0', ICON_TONES[tone])} /> : null}
      </div>
      <p className={cn('mt-auto pt-2 text-2xl font-semibold tracking-tight tabular-nums truncate', VALUE_TONES[tone])}>{value}</p>
      {hint ? <div className="mt-1 text-xs text-muted-foreground truncate">{hint}</div> : null}
    </div>
  );
}
