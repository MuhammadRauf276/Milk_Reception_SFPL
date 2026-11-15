'use client';

import * as React from 'react';
import { toast } from '@/frontend/lib/appToast';

/** How long a problem stays on screen. It can also be closed by hand. */
const ERROR_POPUP_MS = 8000;
/** After a button press, how long to wait for the page to react before deciding the problem is still there. */
const RECHECK_MS = 350;

/** Popups with the same text share one id, so three panels failing for the same reason show one popup, not three. */
export function errorPopupId(message: string): string {
  return `error:${message.trim().toLowerCase().slice(0, 120)}`;
}

export interface ErrorPopupProps {
  /** The problem in plain words. Nothing is shown while this is empty. */
  message: string | null | undefined | false;
  /** Adds a Retry button to the popup. */
  onRetry?: () => void;
  /** Called when the popup closes. Clear the page's error here when the page keeps it in its own state. */
  onClear?: () => void;
}

/**
 * Shows a problem as a popup instead of text or a box that stays on the page.
 *
 * - It appears once when the message arrives and is not repeated while the same problem lasts,
 *   so a list that reloads every few seconds stays quiet.
 * - It closes as soon as the problem is gone.
 * - If the popup has closed but the problem is still there and the person presses a button again
 *   (Save with the same missing value, for example), it is shown again, so a press never looks ignored.
 */
export function ErrorPopup({ message, onRetry, onClear }: ErrorPopupProps) {
  const text = typeof message === 'string' ? message.trim() : '';
  const retry = React.useRef(onRetry);
  const clear = React.useRef(onClear);
  React.useEffect(() => {
    retry.current = onRetry;
    clear.current = onClear;
  });
  const canRetry = Boolean(onRetry);

  React.useEffect(() => {
    if (!text) return;
    const id = errorPopupId(text);
    let showing = false;
    let timer: number | undefined;

    const show = () => {
      showing = true;
      toast.error(text, {
        id,
        duration: ERROR_POPUP_MS,
        action: canRetry ? { label: 'Retry', onClick: () => retry.current?.() } : undefined,
        onDismiss: () => {
          showing = false;
          clear.current?.();
        },
        onAutoClose: () => {
          showing = false;
          clear.current?.();
        },
      });
    };

    const onPress = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      // Presses inside a popup (its own Close or Retry) are not a new attempt.
      if (!target || target.closest('[data-sonner-toaster]')) return;
      if (event.type === 'click' && !target.closest('button, [role="button"], input[type="submit"]')) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!showing) show();
      }, RECHECK_MS);
    };

    show();
    document.addEventListener('click', onPress, true);
    document.addEventListener('submit', onPress, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', onPress, true);
      document.removeEventListener('submit', onPress, true);
      toast.dismiss(id);
    };
  }, [text, canRetry]);

  return null;
}
