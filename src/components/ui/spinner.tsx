import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} aria-hidden="true" />;
}

/**
 * Full-area loading state. Shows the shape of a typical workspace instead of a
 * lone spinner, so the page does not jump when the content arrives.
 */
export function PageLoader({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Fade in after a short delay so fast loads never flash a skeleton.
      className={cn(
        'flex min-h-[60dvh] w-full min-w-0 flex-col gap-4 p-4 animate-in fade-in-0 fill-mode-backwards delay-150 duration-300 sm:p-6',
        className
      )}
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-40 max-w-full" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}
