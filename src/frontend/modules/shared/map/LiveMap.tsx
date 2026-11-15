'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { LiveMapProps } from './LiveMapCanvas';
import { useRoadRoutes } from './useRoadRoutes';

export type { LiveMapProps } from './LiveMapCanvas';
export * from './mapTypes';

/** MapLibre needs the browser (WebGL, window); never render it on the server. */
const LiveMapCanvas = dynamic<LiveMapProps>(() => import('./LiveMapCanvas').then((m) => m.LiveMapCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-80 w-full items-center justify-center rounded-xl border border-border bg-subtle text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading map…
    </div>
  ),
});

/** The map every screen uses. Planned journey lines are drawn along real roads when a road path is available. */
export function LiveMap(props: LiveMapProps) {
  const routes = useRoadRoutes(props.routes);
  return <LiveMapCanvas {...props} routes={routes} />;
}
