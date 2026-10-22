'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';

interface FormDrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  busy?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

/** Bottom-sheet shell for create/edit forms: title, error banner, scrollable body. */
export function FormDrawer({ open, onClose, title, busy, error, children }: FormDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      dismissible={!busy}
    >
      <DrawerContent>
        <div className="border-b border-border px-5 py-3">
          <DrawerTitle>{title}</DrawerTitle>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-xs">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-800">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function DrawerActions({
  busy,
  onCancel,
  submitLabel,
  busyLabel,
  danger,
}: {
  busy?: boolean;
  onCancel: () => void;
  submitLabel: string;
  busyLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant={danger ? 'destructive' : 'default'} className="h-11 px-5" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </Button>
    </div>
  );
}

export const fieldInputClass =
  'h-11 w-full rounded-xl border border-border-strong bg-white px-3 text-sm focus:outline-hidden focus:border-primary disabled:opacity-60';
export const fieldLabelClass = 'mb-1 block font-semibold text-slate-700';
