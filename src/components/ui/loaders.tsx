import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * 1. SpinnerLoader - Clean SVG spinning indicator
 */
export interface SpinnerLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'primary' | 'muted' | 'white';
}

export function SpinnerLoader({
  size = 'md',
  variant = 'primary',
  className,
  ...props
}: SpinnerLoaderProps) {
  const sizeMap = {
    xs: 'h-3.5 w-3.5',
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
    xl: 'h-8 w-8',
  };

  const variantMap = {
    primary: 'text-primary',
    muted: 'text-muted-foreground',
    white: 'text-white',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center justify-center', className)}
      {...props}
    >
      <Loader2 className={cn('animate-spin', sizeMap[size], variantMap[variant])} />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * 2. SkeletonLoader - Shimmer card / block skeleton
 */
export interface SkeletonLoaderProps {
  lines?: number;
  className?: string;
  avatar?: boolean;
}

export function SkeletonLoader({ lines = 3, className, avatar = false }: SkeletonLoaderProps) {
  return (
    <div className={cn('space-y-3 w-full p-4 rounded-xl border border-border/40 bg-card/50', className)}>
      {avatar && (
        <div className="flex items-center space-x-3 mb-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      )}
      {Array.from({ length: lines }).map((_, idx) => (
        <Skeleton
          key={idx}
          className={cn(
            'h-3.5 rounded',
            idx === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'
          )}
        />
      ))}
    </div>
  );
}

/**
 * 3. ProgressBarLoader - Determinate or indeterminate horizontal progression
 */
export interface ProgressBarLoaderProps {
  progress?: number; // 0 to 100 (if omitted, indeterminate)
  className?: string;
  label?: string;
}

export function ProgressBarLoader({ progress, className, label }: ProgressBarLoaderProps) {
  const isIndeterminate = typeof progress !== 'number';

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      {label && (
        <div className="flex justify-between items-center text-xs text-muted-foreground font-mono">
          <span>{label}</span>
          {!isIndeterminate && <span>{Math.round(progress)}%</span>}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
        {isIndeterminate ? (
          <div className="h-full w-2/5 rounded-full bg-primary animate-pulse" />
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 4. PulsingLoader - Tactile pulse status indicator
 */
export interface PulsingLoaderProps {
  label?: string;
  variant?: 'emerald' | 'amber' | 'blue' | 'rose';
  className?: string;
}

export function PulsingLoader({ label, variant = 'blue', className }: PulsingLoaderProps) {
  const colorMap = {
    emerald: 'bg-emerald-500 shadow-emerald-500/20',
    amber: 'bg-amber-500 shadow-amber-500/20',
    blue: 'bg-blue-500 shadow-blue-500/20',
    rose: 'bg-rose-500 shadow-rose-500/20',
  };

  return (
    <div className={cn('inline-flex items-center gap-2 text-xs font-medium', className)}>
      <span className="relative flex h-2.5 w-2.5">
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            colorMap[variant]
          )}
        />
        <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', colorMap[variant])} />
      </span>
      {label && <span className="text-muted-foreground font-mono">{label}</span>}
    </div>
  );
}

/**
 * 5. ButtonLoader - Inline button state wrapper
 */
export interface ButtonLoaderProps {
  loading: boolean;
  children: React.ReactNode;
  loadingText?: string;
  className?: string;
}

export function ButtonLoader({
  loading,
  children,
  loadingText,
  className,
}: ButtonLoaderProps) {
  return (
    <span className={cn('inline-flex items-center justify-center gap-2', className)}>
      {loading && <SpinnerLoader size="sm" variant="muted" />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </span>
  );
}

/**
 * 6. FullScreenLoader - Modal backdrop overlay loader
 */
export interface FullScreenLoaderProps {
  show: boolean;
  title?: string;
  subtitle?: string;
}

export function FullScreenLoader({
  show,
  title = 'Processing...',
  subtitle = 'Please wait while operational records are synchronized.',
}: FullScreenLoaderProps) {
  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center max-w-sm rounded-2xl border border-border/60 bg-card shadow-lg">
        <SpinnerLoader size="lg" />
        <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground leading-relaxed">{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * 7. PullToRefreshLoader - Mobile pull trigger indicator
 */
export interface PullToRefreshLoaderProps {
  refreshing: boolean;
  pullDistance?: number;
  threshold?: number;
  className?: string;
}

export function PullToRefreshLoader({
  refreshing,
  pullDistance = 0,
  threshold = 60,
  className,
}: PullToRefreshLoaderProps) {
  const percentage = Math.min(100, (pullDistance / threshold) * 100);

  if (!refreshing && pullDistance <= 0) return null;

  return (
    <div
      className={cn(
        'w-full flex items-center justify-center py-2 transition-all duration-150',
        className
      )}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border/60 shadow-xs text-xs font-medium text-muted-foreground">
        <RefreshCw
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-200',
            refreshing ? 'animate-spin text-primary' : ''
          )}
          style={{
            transform: !refreshing ? `rotate(${percentage * 3.6}deg)` : undefined,
          }}
        />
        <span>{refreshing ? 'Refreshing queue…' : percentage >= 100 ? 'Release to refresh' : 'Pull down to refresh'}</span>
      </div>
    </div>
  );
}

/**
 * 8. InfiniteScrollerLoader - Bottom pagination sentinel indicator
 */
export interface InfiniteScrollerLoaderProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore?: () => void;
  className?: string;
}

export function InfiniteScrollerLoader({
  hasMore,
  loading,
  className,
}: InfiniteScrollerLoaderProps) {
  if (!hasMore && !loading) {
    return (
      <div className={cn('py-4 text-center text-xs text-muted-foreground font-mono', className)}>
        All records loaded
      </div>
    );
  }

  return (
    <div className={cn('py-4 flex items-center justify-center gap-2 text-xs text-muted-foreground', className)}>
      {loading ? (
        <>
          <SpinnerLoader size="sm" />
          <span>Loading more entries…</span>
        </>
      ) : (
        <span>Scroll to load more</span>
      )}
    </div>
  );
}
