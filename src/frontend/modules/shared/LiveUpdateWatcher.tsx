'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

const POLL_MS = 15_000;

/** Fired when tests, policies, routes, testers or vehicles change, for screens that load outside TanStack Query. */
export const LIVE_CONFIG_CHANGED_EVENT = 'milk-live-config-changed';

/**
 * Keeps open screens current without a manual refresh. Changed settings reload what the screen shows, and typed form
 * values stay. A new app version only offers a refresh, because a forced reload could interrupt someone mid-form.
 */
export function LiveUpdateWatcher() {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const signedIn = Boolean(currentUser?.id);
  const seen = useRef<{ build: string; stamp: string } | null>(null);
  const [newVersion, setNewVersion] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    const check = async () => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
      try {
        const res = await fetch('/api/live-version', { credentials: 'same-origin' });
        if (!res.ok) return;
        const next = (await res.json()) as { build: string; stamp: string };
        const previous = seen.current;
        seen.current = next;
        if (!previous) return;
        if (next.build !== previous.build) setNewVersion(true);
        if (next.stamp !== previous.stamp) {
          void queryClient.invalidateQueries({ refetchType: 'active' });
          window.dispatchEvent(new Event(LIVE_CONFIG_CHANGED_EVENT));
        }
      } catch {
        // No signal: the next check tries again.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signedIn, queryClient]);

  if (!newVersion) return null;
  return (
    <div
      role="status"
      style={{ zIndex: 2147483000 }}
      className="fixed left-1/2 top-2 flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-md"
    >
      <span>A new version of the app is ready.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-white hover:bg-primary-hover"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Refresh
      </button>
    </div>
  );
}
