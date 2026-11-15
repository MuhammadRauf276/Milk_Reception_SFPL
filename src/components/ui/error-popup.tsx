'use client';

import * as React from 'react';
import { toast } from '@/frontend/lib/appToast';

/** How long a load or save error stays on screen. It can also be closed by hand. */
const ERROR_POPUP_MS = 8000;

/** Popups with the same text share one id, so three panels failing for the same reason show one popup, not three. */
export function errorPopupId(message: string): string {
  return `error:${message.trim().toLowerCase().slice(0, 120)}`;
}

export interface ErrorPopupProps {
  /** The problem in plain words. Nothing is shown while this is empty. */
  message: string | null | undefined | false;
  /** Adds a Retry button to the popup. */
  onRetry?: () => void;
  /** Called when the popup closes. Clear the page's error here so the same problem is shown again if it returns. */
  onClear?: () => void;
}

/**
 * Shows a problem as a popup instead of a box that stays on the page. It appears once when the message arrives,
 * is not repeated while the same problem lasts (a list that reloads every few seconds stays quiet),
 * and is closed as soon as the problem is gone.
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
    toast.error(text, {
      id,
      duration: ERROR_POPUP_MS,
      action: canRetry ? { label: 'Retry', onClick: () => retry.current?.() } : undefined,
      onDismiss: () => clear.current?.(),
      onAutoClose: () => clear.current?.(),
    });
    return () => {
      toast.dismiss(id);
    };
  }, [text, canRetry]);

  return null;
}
