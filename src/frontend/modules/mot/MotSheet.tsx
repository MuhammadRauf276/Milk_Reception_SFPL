'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';

/** Shared look for sheet form controls (44px minimum touch height). */
export const sheetInputClass =
  'w-full min-h-[44px] text-sm font-semibold border border-border rounded-xl px-3 py-2 bg-subtle text-foreground';
export const sheetLabelClass = 'block text-xs font-semibold text-foreground mb-1';
export const sheetPrimaryButtonClass =
  'w-full min-h-[56px] rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50';

interface MotSheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom-sheet replacement for secondary modals: one visible title, one close button. Mount conditionally. */
export function MotSheet({ title, subtitle, onClose, children }: MotSheetProps) {
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
            <div className="min-w-0">
              <DrawerTitle>{title}</DrawerTitle>
              {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border border-border text-slate-500 hover:bg-muted"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
