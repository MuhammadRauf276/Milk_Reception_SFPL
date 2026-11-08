import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** The next step, when there is one. */
  action?: React.ReactNode;
  className?: string;
}

/** Shown when a list has nothing in it. Says so plainly and offers the next step. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-4 py-8 text-center', className)}>
      <div className="mb-3 text-muted-foreground [&_svg]:h-6 [&_svg]:w-6">
        {icon || <Inbox aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description ? <div className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** A list or panel that failed to load. Keeps the rest of the screen usable. */
export function ErrorState({
  title = 'This section did not load',
  description = 'Your saved records are safe. Check the connection and try again.',
  onRetry,
  retryLabel = 'Try again',
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex min-w-0 flex-col items-center justify-center rounded-2xl border bg-card px-4 py-8 text-center', className)}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
