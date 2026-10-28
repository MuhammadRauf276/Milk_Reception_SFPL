'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { LiveMapProps } from './LiveMapCanvas';

export type { LiveMapProps } from './LiveMapCanvas';
export * from './mapTypes';

/** MapLibre needs the browser (WebGL, window); never render it on the server. */
export const LiveMap = dynamic<LiveMapProps>(() => import('./LiveMapCanvas').then((m) => m.LiveMapCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] w-full items-center justify-center rounded-xl border border-border bg-subtle text-xs text-slate-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading map…
    </div>
  ),
});
