import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorPopup } from './error-popup';

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

const DEFAULT_ERROR_DESCRIPTION = 'Your saved records are safe. Check the connection and try again.';

interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * A list or panel that failed to load. The problem itself is shown as a popup (with Retry);
 * what stays on the page is only a quiet placeholder, so nothing red sits there after the popup is gone.
 */
export function ErrorState({
  title = 'This section did not load',
  description = DEFAULT_ERROR_DESCRIPTION,
  onRetry,
  retryLabel = 'Try again',
  className,
}: ErrorStateProps) {
  // The caller's own words when given; otherwise the title says what did not load.
  const message = typeof description === 'string' && description.trim() && description !== DEFAULT_ERROR_DESCRIPTION ? description : title;
  return (
    <>
      <ErrorPopup message={message} onRetry={onRetry} />
      <div className={cn('flex min-w-0 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-4 py-6 text-center', className)}>
        <p className="text-sm text-muted-foreground">Not loaded</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    </>
  );
}
