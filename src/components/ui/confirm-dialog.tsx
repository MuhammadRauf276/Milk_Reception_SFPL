'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './button';
import { Modal } from './modal';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions use the red button and the warning icon. */
  destructive?: boolean;
  /** For the most serious actions: the person must type this word before confirming. */
  requireText?: string;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Asks before something hard to undo. Replaces the browser's confirm box.
 * Resolves true only when the person confirms. Needs <ConfirmHost /> in the root layout.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { ...options, resolve };
    emit();
  });
}

export function ConfirmHost() {
  const pending = React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null
  );
  const [typed, setTyped] = React.useState('');

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    current = null;
    setTyped('');
    emit();
  };

  if (!pending) return null;
  const { title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, requireText } = pending;
  const blocked = !!requireText && typed.trim() !== requireText;

  return (
    <Modal title={title} size="sm" onClose={() => close(false)}>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {destructive ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" /> : null}
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        {requireText ? (
          <label className="block space-y-1 text-sm text-foreground">
            <span>
              Type <strong className="font-mono">{requireText}</strong> to continue
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
            />
          </label>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => close(false)}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={blocked} onClick={() => close(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
