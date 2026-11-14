'use client';

import * as React from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * When to use which loader:
 * - SkeletonList / SkeletonTable / SkeletonStats: a list or panel is loading for the first time.
 * - SpinnerLoader: a small area is busy and its final shape is unknown.
 * - ButtonLoader: the button that was pressed is working.
 * - ProgressBarLoader: an upload or export, with a percentage when known.
 * - PulsingLoader: something is live right now, like a GPS feed. Never for plain loading.
 * - FullScreenLoader: rare. Only when the operator must not touch anything until it finishes.
 * - PullToRefreshLoader and InfiniteScrollerLoader: see usePullToRefresh and this file.
 */

export interface SpinnerLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'primary' | 'muted' | 'white';
}

const SPINNER_SIZES = { xs: 'h-3.5 w-3.5', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6', xl: 'h-8 w-8' };
const SPINNER_COLORS = { primary: 'text-primary', muted: 'text-muted-foreground', white: 'text-white' };

export function SpinnerLoader({ size = 'md', variant = 'primary', className, ...props }: SpinnerLoaderProps) {
  return (
    <div role="status" aria-live="polite" className={cn('inline-flex items-center justify-center', className)} {...props}>
      <Loader2 className={cn('animate-spin', SPINNER_SIZES[size], SPINNER_COLORS[variant])} aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export interface SkeletonLoaderProps {
  lines?: number;
  className?: string;
  avatar?: boolean;
}

/** One card-shaped placeholder. */
export function SkeletonLoader({ lines = 3, className, avatar = false }: SkeletonLoaderProps) {
  return (
    <div className={cn('w-full min-w-0 space-y-3 rounded-2xl border bg-card p-4', className)} aria-hidden="true">
      {avatar ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ) : null}
      {Array.from({ length: lines }).map((_, idx) => (
        <Skeleton key={idx} className={cn('h-3.5', idx === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** A loading queue or card list. */
export function SkeletonList({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('min-w-0 space-y-3', className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonLoader key={i} />
      ))}
    </div>
  );
}

/** A loading row of KPI tiles. */
export function SkeletonStats({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3', className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-2xl" />
      ))}
    </div>
  );
}

/** A loading table. */
export function SkeletonTable({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('min-w-0 space-y-2 rounded-2xl border bg-card p-4', className)}>
      <span className="sr-only">Loading</span>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

export interface ProgressBarLoaderProps {
  /** 0 to 100. Leave out when the length of the work is unknown. */
  progress?: number;
  className?: string;
  label?: string;
}

export function ProgressBarLoader({ progress, className, label }: ProgressBarLoaderProps) {
  const known = typeof progress === 'number';
  const pct = known ? Math.max(0, Math.min(100, progress)) : undefined;
  const isComplete = known && pct === 100;
  return (
    <div className={cn('w-full min-w-0 space-y-1', className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0">{label}</span>
          {known ? (
            <span className={cn('shrink-0 tabular-nums font-mono', isComplete ? 'font-semibold text-emerald-700' : '')}>
              {Math.round(pct!)}%
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label || 'Progress'}
        aria-valuenow={known ? Math.round(pct!) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {known ? (
          <div
            className={cn(
              'h-full origin-left rounded-full transition-all duration-300 ease-out',
              isComplete ? 'bg-emerald-600' : 'bg-primary'
            )}
            style={{ transform: `scaleX(${pct! / 100})` }}
          />
        ) : (
          <div className="h-full w-2/5 animate-progress-slide rounded-full bg-primary" />
        )}
      </div>
    </div>
  );
}

export interface PulsingLoaderProps {
  label?: string;
  variant?: 'emerald' | 'amber' | 'blue' | 'rose';
  className?: string;
}

const PULSE_COLORS = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', blue: 'bg-blue-500', rose: 'bg-rose-500' };

/** Marks something that is live right now. Do not use for ordinary loading. */
export function PulsingLoader({ label, variant = 'emerald', className }: PulsingLoaderProps) {
  return (
    <div className={cn('inline-flex items-center gap-2 text-xs font-medium', className)}>
      <span className="relative flex h-2 w-2 shrink-0">
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', PULSE_COLORS[variant])} />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', PULSE_COLORS[variant])} />
      </span>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </div>
  );
}

export interface ButtonLoaderProps {
  loading: boolean;
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
}

/** Put inside a Button and disable the button while `loading` is true. */
export function ButtonLoader({ loading, children, loadingText, className }: ButtonLoaderProps) {
  return (
    <span className={cn('inline-flex items-center justify-center gap-2', className)}>
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : null}
      <span>{loading && loadingText ? loadingText : children}</span>
    </span>
  );
}

export interface FullScreenLoaderProps {
  show: boolean;
  title?: string;
  subtitle?: string;
}

export function FullScreenLoader({ show, title = 'Saving', subtitle = 'Keep this screen open' }: FullScreenLoaderProps) {
  if (!show) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-modal flex items-center justify-center bg-background/80 p-4">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border bg-card p-6 text-center shadow-lg">
        <SpinnerLoader size="lg" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export interface PullToRefreshLoaderProps {
  refreshing: boolean;
  pullDistance?: number;
  threshold?: number;
  className?: string;
}

/** The indicator shown by usePullToRefresh. */
export function PullToRefreshLoader({ refreshing, pullDistance = 0, threshold = 64, className }: PullToRefreshLoaderProps) {
  if (!refreshing && pullDistance <= 0) return null;
  const ready = pullDistance >= threshold;
  return (
    <div className={cn('flex w-full items-center justify-center py-2', className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-2xs">
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowDown className={cn('h-3.5 w-3.5 transition-transform duration-150', ready && 'rotate-180')} aria-hidden="true" />
        )}
        <span>{refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh'}</span>
      </div>
    </div>
  );
}

export interface InfiniteScrollerLoaderProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore?: () => void;
  /** Shown at the end of the list. */
  endLabel?: string;
  className?: string;
}

/** Place after the last row. Calls onLoadMore as it nears the screen, with a button as a fallback. */
export function InfiniteScrollerLoader({ hasMore, loading, onLoadMore, endLabel = 'End of list', className }: InfiniteScrollerLoaderProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const latest = React.useRef({ hasMore, loading, onLoadMore });
  React.useEffect(() => {
    latest.current = { hasMore, loading, onLoadMore };
  });

  React.useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const { hasMore: more, loading: busy, onLoadMore: load } = latest.current;
        if (entries.some((e) => e.isIntersecting) && more && !busy) load?.();
      },
      { rootMargin: '240px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn('flex min-h-11 items-center justify-center gap-2 py-3 text-xs text-muted-foreground', className)}>
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Loading more</span>
        </>
      ) : hasMore ? (
        <button type="button" onClick={onLoadMore} className="min-h-11 rounded-lg px-3 font-medium text-foreground transition-colors hover:bg-muted">
          Load more
        </button>
      ) : (
        <span>{endLabel}</span>
      )}
    </div>
  );
}
