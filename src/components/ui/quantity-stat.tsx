import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

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

const num = (n: number, digits = 2) => n.toLocaleString(undefined, { maximumFractionDigits: digits });

interface QuantityStatProps {
  label: string;
  /** Litres @13 TS. Main figure. Null or undefined shows a dash, never gross. */
  at13ts: number | null | undefined;
  /** Gross litres, shown small under the main figure. */
  gross?: number | null;
  /** Weighed kilograms, shown beside gross where the milk was weighed. */
  kg?: number | null;
  /** Records counted without a Fat/LR test, so they are missing from the @13 TS total. */
  missingAt13tsCount?: number | null;
  /** Replaces the main figure (for a signed loss/gain text). Colour comes from tone. */
  valueText?: React.ReactNode;
  hint?: React.ReactNode;
  /** Tag beside the main figure so people see which basis it is. Null hides it. */
  basis?: string | null;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  className?: string;
}

/**
 * Milk quantity tile. The @13 TS litre figure is the big number. Gross litres and kg are a
 * small second line. Untested records are named, and gross is never shown in place of @13 TS.
 */
export function QuantityStat({
  label,
  at13ts,
  gross,
  kg,
  missingAt13tsCount,
  valueText,
  hint,
  basis = '@13 TS',
  icon: Icon,
  tone = 'default',
  className,
}: QuantityStatProps) {
  const hasValue = valueText != null ? valueText !== '—' : at13ts != null && Number.isFinite(at13ts);
  const main = valueText ?? (hasValue ? `${num(at13ts as number)} L` : '—');
  const second: string[] = [];
  if (gross != null && Number.isFinite(gross)) second.push(`Gross ${num(gross)} L`);
  if (kg != null && Number.isFinite(kg)) second.push(`${num(kg)} kg`);
  const missing = missingAt13tsCount != null && missingAt13tsCount > 0 ? missingAt13tsCount : 0;
  return (
    <div className={cn('@container flex h-full min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-2xs', className)}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_TONES[tone])} /> : null}
      </div>
      <p className={cn('mt-auto pt-2 text-lg font-semibold tabular-nums break-words @[10rem]:text-xl @[13rem]:text-2xl', VALUE_TONES[tone])}>
        {main}
        {hasValue && basis ? <span className="ml-1.5 align-middle text-xs font-semibold text-muted-foreground">{basis}</span> : null}
      </p>
      {second.length > 0 ? <p className="mt-1 min-w-0 text-xs text-muted-foreground tabular-nums break-words">{second.join(' · ')}</p> : null}
      {missing > 0 ? <p className="mt-0.5 text-xs text-amber-700">{missing} without tests</p> : null}
      {hint ? <div className="mt-1 min-w-0 text-xs text-muted-foreground break-words">{hint}</div> : null}
    </div>
  );
}
