'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Recovery screen for one section of the app. The header and menu of the parent
 * stay on screen where they exist, so the operator is never stranded.
 */
export function SectionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('Section error', error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-2xs">
        <h1 className="text-base font-semibold text-foreground">This page did not load</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your saved records are safe. Unsent work stays on this device.</p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Ref: {error.digest}</p> : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => retry()}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/">Go to my workspace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
