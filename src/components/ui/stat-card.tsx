import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

/** Icons stay muted. Only a real warning or problem gets colour. */
const ICON_TONES: Record<Tone, string> = {
  default: 'text-muted-foreground',
  info: 'text-muted-foreground',
  success: 'text-muted-foreground',
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
  tone?: Tone;
  className?: string;
}

/**
 * KPI tile. Figures wrap instead of being cut off, because a shortened weight
 * or volume is a wrong number. Size follows the tile, not the screen.
 */
export function StatCard({ label, value, hint, icon: Icon, tone = 'default', className }: StatCardProps) {
  return (
    <div className={cn('@container flex h-full min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-2xs', className)}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_TONES[tone])} /> : null}
      </div>
      <p className={cn('mt-auto pt-2 text-xl font-semibold tabular-nums break-words @[11rem]:text-2xl', VALUE_TONES[tone])}>{value}</p>
      {hint ? <div className="mt-1 min-w-0 text-xs text-muted-foreground break-words">{hint}</div> : null}
    </div>
  );
}
