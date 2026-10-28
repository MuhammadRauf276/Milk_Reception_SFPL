'use client';

import React from 'react';
import Link from 'next/link';

const btn =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-xs font-semibold text-primary hover:bg-subtle';

/** Short empty message plus one clear action (refresh or a link to the next page). */
export function EmptyAction({
  message,
  onRefresh,
  href,
  actionLabel,
  className = '',
}: {
  message: string;
  onRefresh?: () => void;
  href?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground ${className}`}
    >
      <span>{message}</span>
      {href ? (
        <Link href={href} className={btn}>
          {actionLabel ?? 'Open'}
        </Link>
      ) : onRefresh ? (
        <button type="button" onClick={onRefresh} className={btn}>
          {actionLabel ?? 'Refresh'}
        </button>
      ) : null}
    </div>
  );
}
