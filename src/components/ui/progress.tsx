'use client';

import * as React from 'react';
import { CheckCircle2, AlertCircle, Loader2, FileImage } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current progress percentage from 0 to 100. Leave undefined for indeterminate progress. */
  value?: number | null;
  /** Maximum progress value, defaults to 100. */
  max?: number;
  /** Optional accessible label displayed above or announced to screen readers. */
  label?: string;
  /** Whether to show the numerical percentage indicator (e.g. "85%"). */
  showValueLabel?: boolean;
  /** Visual variant of the progress indicator. */
  variant?: 'default' | 'success' | 'action' | 'warning' | 'destructive';
  /** Track height size. */
  size?: 'sm' | 'md' | 'lg';
  /** Active status of the operation. */
  status?: 'idle' | 'uploading' | 'processing' | 'success' | 'complete' | 'error';
  /** Custom descriptive status text shown alongside progress. */
  statusText?: string;
}

const SIZE_VARIANTS = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

const FILL_VARIANTS = {
  default: 'bg-primary',
  success: 'bg-emerald-600',
  action: 'bg-action',
  warning: 'bg-amber-500',
  destructive: 'bg-destructive',
};

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      value,
      max = 100,
      label,
      showValueLabel = false,
      variant = 'default',
      size = 'md',
      status = 'idle',
      statusText,
      ...props
    },
    ref
  ) => {
    const isDeterminate = typeof value === 'number' && !Number.isNaN(value);
    const clampedValue = isDeterminate
      ? Math.max(0, Math.min(max, value))
      : 0;
    const percentage = isDeterminate
      ? Math.round((clampedValue / max) * 100)
      : undefined;

    // Automatically transition to success green when complete
    const isSuccess =
      status === 'success' || status === 'complete' || (isDeterminate && percentage === 100);
    const effectiveVariant =
      variant === 'default' && isSuccess
        ? 'success'
        : status === 'error'
        ? 'destructive'
        : variant;

    return (
      <div
        ref={ref}
        className={cn('w-full min-w-0 space-y-1.5', className)}
        {...props}
      >
        {(label || showValueLabel || statusText) && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
              {status === 'uploading' && (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              )}
              {isSuccess && (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              )}
              {status === 'error' && (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
              )}
              <span className="truncate">{statusText || label}</span>
            </div>
            {showValueLabel && isDeterminate && (
              <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">
                {percentage}%
              </span>
            )}
          </div>
        )}

        <div
          role="progressbar"
          aria-label={label || 'Progress'}
          aria-valuenow={isDeterminate ? percentage : undefined}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-busy={status === 'uploading' || status === 'processing'}
          className={cn(
            'relative w-full overflow-hidden rounded-full bg-muted shadow-inner',
            SIZE_VARIANTS[size]
          )}
        >
          {isDeterminate ? (
            <div
              className={cn(
                'h-full origin-left rounded-full transition-all duration-300 ease-out',
                FILL_VARIANTS[effectiveVariant]
              )}
              style={{ width: `${percentage}%` }}
            />
          ) : (
            <div
              className={cn(
                'h-full w-2/5 animate-progress-slide rounded-full',
                FILL_VARIANTS[effectiveVariant]
              )}
            />
          )}
        </div>
      </div>
    );
  }
);
Progress.displayName = 'Progress';

export interface FileUploadProgressProps {
  /** Name of the file being uploaded. */
  fileName?: string;
  /** Size in bytes or formatted string like "2.4 MB". */
  fileSize?: number | string;
  /** Current upload progress percentage (0 to 100). */
  progress: number;
  /** Stage of the upload operation. */
  status?: 'uploading' | 'processing' | 'complete' | 'error';
  /** Error message when status is 'error'. */
  errorMessage?: string;
  /** Callback to cancel an in-flight upload. */
  onCancel?: () => void;
  /** Callback to retry a failed upload. */
  onRetry?: () => void;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Professional upload progress card component.
 * Displays file information, animated progress bar, live percentages,
 * and a complete success verification state.
 */
export function FileUploadProgress({
  fileName,
  fileSize,
  progress,
  status = 'uploading',
  errorMessage,
  onCancel,
  onRetry,
  className,
}: FileUploadProgressProps) {
  const isComplete = status === 'complete' || progress >= 100;
  const isError = status === 'error';
  const isProcessing = status === 'processing';
  const sizeString = typeof fileSize === 'number' ? formatBytes(fileSize) : fileSize;

  return (
    <div
      role="region"
      aria-label="File upload progress"
      className={cn(
        'relative rounded-xl border p-4 transition-all duration-200',
        isComplete
          ? 'border-emerald-300 bg-emerald-50/60'
          : isError
          ? 'border-rose-300 bg-rose-50/60'
          : 'border-border-strong bg-card shadow-xs',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              isComplete
                ? 'bg-emerald-100 text-emerald-700'
                : isError
                ? 'bg-rose-100 text-rose-700'
                : 'bg-primary/10 text-primary'
            )}
          >
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : isError ? (
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
            ) : (
              <FileImage className="h-5 w-5" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-semibold text-foreground">
              {fileName || 'File upload'}
            </p>
            <p className="text-xs text-muted-foreground">
              {sizeString ? `${sizeString} · ` : ''}
              {isComplete
                ? 'Upload complete'
                : isError
                ? errorMessage || 'Upload failed'
                : isProcessing
                ? 'Processing photo…'
                : 'Uploading…'}
            </p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              100%
            </span>
          ) : isError ? (
            onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="text-xs font-semibold text-rose-700 hover:underline"
              >
                Retry
              </button>
            ) : (
              <span className="text-xs font-semibold text-rose-700">Failed</span>
            )
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                {Math.round(progress)}%
              </span>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Cancel upload"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <Progress
          value={progress}
          variant={isComplete ? 'success' : isError ? 'destructive' : 'default'}
          size="md"
          status={status}
        />
      </div>
    </div>
  );
}

export interface BatchUploadProgressProps {
  total: number;
  completed: number;
  currentLabel?: string;
  isUploading: boolean;
  /** Shown when some pictures did not upload: sends the waiting ones again. */
  onRetry?: () => void;
  className?: string;
}

/**
 * Queue progress card for batch uploads (e.g. multiple photos in a dispatch workflow).
 */
export function BatchUploadProgress({
  total,
  completed,
  currentLabel,
  isUploading,
  onRetry,
  className,
}: BatchUploadProgressProps) {
  if (total <= 0) return null;
  const isDone = completed >= total && !isUploading;
  const failed = !isUploading && completed < total;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div
      role="region"
      aria-label="Batch upload status"
      className={cn(
        'rounded-xl border p-4 transition-all duration-200',
        isDone
          ? 'border-emerald-300 bg-emerald-50/60'
          : 'border-border-strong bg-card shadow-xs',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          {isDone ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          ) : isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          ) : null}
          <span>
            {isDone
              ? 'All pictures uploaded successfully'
              : isUploading
              ? currentLabel || `Uploading picture ${Math.min(completed + 1, total)} of ${total}…`
              : `${total - completed} picture(s) did not upload`}
          </span>
        </div>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {completed}/{total} ({pct}%)
        </span>
      </div>

      <div className="mt-2.5">
        <Progress
          value={pct}
          variant={isDone ? 'success' : 'default'}
          size="md"
          status={isDone ? 'success' : isUploading ? 'uploading' : 'idle'}
        />
      </div>
      {failed && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border-strong bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
