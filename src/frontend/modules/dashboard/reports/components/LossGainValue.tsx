import React from 'react';
import type { LossGainKind, LossGainTone } from '../dynamicReportTypes';
import { formatLossGainText, lossGainToneOf } from '../dynamicReportTypes';

/** Red for a loss, green for a gain, grey for even. */
export const LOSS_GAIN_TONE_CLASS: Record<LossGainTone, string> = {
  loss: 'text-rose-600 dark:text-rose-400',
  gain: 'text-emerald-600 dark:text-emerald-400',
  even: 'text-muted-foreground',
};

interface LossGainValueProps {
  value: number | null | undefined;
  /** "L" or "%". */
  unit: string;
  /** net: the sign tells loss from gain. loss_only and gain_only: the value is already the size. */
  kind?: LossGainKind;
  className?: string;
}

/** "Loss 120 L" in red, "Gain 35 L" in green, "Even" in grey. A missing value is a dash. */
export function LossGainValue({ value, unit, kind = 'net', className = '' }: LossGainValueProps) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-muted-foreground font-mono">—</span>;
  }
  const tone = lossGainToneOf(value, kind);
  return (
    <span className={`tabular-nums font-mono font-semibold ${LOSS_GAIN_TONE_CLASS[tone]} ${className}`}>
      {formatLossGainText(value, unit, kind)}
    </span>
  );
}
