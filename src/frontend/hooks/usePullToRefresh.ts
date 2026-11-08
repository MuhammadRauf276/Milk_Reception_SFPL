'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const THRESHOLD = 64;
const MAX_PULL = 96;

/**
 * Pull-down refresh for phone queues. Only starts when the page is at the very
 * top and the touch began outside a dialog, so scrolling and forms are unaffected.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const distance = useRef(0);
  const busy = useRef(false);
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  });

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      await latest.current();
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (window.scrollY > 0 || busy.current || target?.closest('[role="dialog"],[data-vaul-drawer],input,textarea,select,.maplibregl-map')) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const next = Math.min(MAX_PULL, Math.max(0, (e.touches[0].clientY - startY.current) * 0.5));
      distance.current = next;
      setPullDistance(next);
    };
    const onEnd = () => {
      if (startY.current !== null && distance.current >= THRESHOLD) void run();
      startY.current = null;
      distance.current = 0;
      setPullDistance(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [run]);

  return { pullDistance, refreshing, threshold: THRESHOLD };
}
