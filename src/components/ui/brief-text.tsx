'use client';

import * as React from 'react';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';

/** Up to this many words show as they are; anything longer goes behind an (i) icon. */
export const BRIEF_WORDS = 3;

export function isBrief(text: string | null | undefined, words = BRIEF_WORDS): boolean {
  const t = (text ?? '').trim();
  return t === '' || t.split(/\s+/).length <= words;
}

/**
 * Short text shows as it is. Longer text shows `label` and an (i) icon; tapping the icon shows the whole text.
 * Keeps cards to a few words while nothing is hidden.
 */
export function BriefText({
  text,
  label,
  className,
}: {
  text: string | null | undefined;
  /** What to show instead of the long text, three words or fewer. */
  label: string;
  className?: string;
}) {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (isBrief(t)) return <span className={className}>{t}</span>;
  return (
    <span className={cn('inline-flex items-center', className)}>
      <span>{label}</span>
      <InfoTip text={t} label={label} className="-my-3" />
    </span>
  );
}
