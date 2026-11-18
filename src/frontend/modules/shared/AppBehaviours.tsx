'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { PullToRefreshLoader } from '@/components/ui/loaders';
import { usePullToRefresh } from '@/frontend/hooks/usePullToRefresh';
import { DRAFT_SAVED_EVENT } from '@/frontend/lib/localFormDraft';

/** Pull down at the top of any screen on a phone to reload its lists. Reads only, so it never changes a record. */
function GlobalPullToRefresh() {
  const queryClient = useQueryClient();
  const { pullDistance, refreshing, threshold } = usePullToRefresh(() => queryClient.refetchQueries({ type: 'active' }));
  if (!refreshing && pullDistance <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-toast">
      <PullToRefreshLoader refreshing={refreshing} pullDistance={pullDistance} threshold={threshold} />
    </div>
  );
}

/** Tells the operator that what they typed is safe on this device. */
function DraftSavedNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSaved = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), 1800);
    };
    window.addEventListener(DRAFT_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener(DRAFT_SAVED_EVENT, onSaved);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-toast inline-flex items-center gap-1 rounded-lg border bg-card px-2 py-1 text-xs text-muted-foreground shadow-2xs transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      Saved on this device
    </div>
  );
}

/** Anything open right now that is allowed to lock the page (a dialog, a menu or a dropdown list). */
const OPEN_LAYER =
  '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="menu"][data-state="open"],[role="listbox"][data-state="open"],[data-radix-popper-content-wrapper]';

/**
 * Safety net: a pop-up that closes while the page changes can leave the page locked (no scrolling, no taps) after
 * it is gone, so the screen looks frozen. When the page is locked but nothing that may lock it is open for a
 * moment, the lock is released.
 */
function StuckScrollLockGuard() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const locked = () =>
      document.body.hasAttribute('data-scroll-locked') || document.body.style.pointerEvents === 'none';
    const release = () => {
      timer = null;
      if (!locked() || document.querySelector(OPEN_LAYER)) return;
      document.body.removeAttribute('data-scroll-locked');
      if (document.body.style.pointerEvents === 'none') document.body.style.pointerEvents = '';
    };
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = locked() ? setTimeout(release, 900) : null;
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked', 'style'], childList: true });
    check();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}

export function AppBehaviours() {
  return (
    <>
      <StuckScrollLockGuard />
      <GlobalPullToRefresh />
      <DraftSavedNotice />
    </>
  );
}
