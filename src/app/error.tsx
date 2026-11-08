'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusScreen } from '@/components/ui/status-screen';

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error('Global Application Error Caught by Boundary:', error);
  }, [error]);

  return (
    <StatusScreen
      tone="danger"
      icon={<AlertTriangle />}
      title="Something went wrong"
      description={
        <>
          <p>This view failed to load. Your session and saved data are unaffected.</p>
          {error.digest ? <p className="mt-2 font-mono text-xs">Ref: {error.digest}</p> : null}
        </>
      }
    >
      <Button onClick={() => retry()}>
        <RotateCcw />
        Try again
      </Button>
      <Button variant="outline" asChild>
        <Link href="/">Go to my workspace</Link>
      </Button>
    </StatusScreen>
  );
}
