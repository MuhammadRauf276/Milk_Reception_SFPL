'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { ErrorPopup } from '@/components/ui/error-popup';

interface ZmccDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

/** Bottom-sheet shell for ZMCC create / edit / correction forms and detail panels (single visible title). */
export const ZmccDrawer: React.FC<ZmccDrawerProps> = ({ open, onClose, title, subtitle, icon, children }) => (
  <Drawer
    open={open}
    onOpenChange={(o) => {
      if (!o) onClose();
    }}
  >
    <DrawerContent showClose={false}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-2 sm:px-5">
        <div className="flex min-w-0 items-start gap-2">
          {icon}
          <div className="min-w-0">
            <DrawerTitle className="text-base">{title}</DrawerTitle>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-secondary-foreground cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="scrollbar-thin overscroll-contain flex-1 min-h-0 space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">{children}</div>
    </DrawerContent>
  </Drawer>
);

export const zmccInputClass =
  'w-full min-h-[44px] px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-primary outline-hidden';
export const zmccLabelClass = 'block text-xs font-semibold text-secondary-foreground mb-1';
export const zmccPrimaryBtn =
  'min-h-[44px] px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover disabled:opacity-50 cursor-pointer';
export const zmccGhostBtn =
  'min-h-[44px] px-4 py-2 border rounded-xl text-sm text-secondary-foreground font-semibold hover:bg-subtle cursor-pointer';

/** A drawer's problem, shown as a popup. */
export const ZmccErrorBanner: React.FC<{ message: string | null }> = ({ message }) => <ErrorPopup message={message} />;

/** Simple Previous / Next pager. */
export const ZmccPager: React.FC<{
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  disabled?: boolean;
  summary?: React.ReactNode;
}> = ({ page, totalPages, onPage, disabled, summary }) => {
  if (totalPages <= 1) return null;
  const btn =
    'min-h-[44px] px-4 bg-card border border-border-strong rounded-xl text-xs font-semibold hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  return (
    <div className="flex items-center justify-between gap-2 p-3 border-t border-border bg-subtle text-xs font-semibold text-secondary-foreground">
      <div>
        Page {page} of {totalPages}
        {summary}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1 || disabled} onClick={() => onPage(Math.max(1, page - 1))}>
          Previous
        </button>
        <button
          type="button"
          className={btn}
          disabled={page >= totalPages || disabled}
          onClick={() => onPage(Math.min(totalPages, page + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
};
