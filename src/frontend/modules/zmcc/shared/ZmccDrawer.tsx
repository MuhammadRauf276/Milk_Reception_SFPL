'use client';

import React from 'react';
import { X } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';

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
    <DrawerContent>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-2 sm:px-5">
        <div className="flex min-w-0 items-start gap-2">
          {icon}
          <div className="min-w-0">
            <DrawerTitle className="text-base">{title}</DrawerTitle>
            {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">{children}</div>
    </DrawerContent>
  </Drawer>
);

export const zmccInputClass =
  'w-full min-h-[44px] px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-primary outline-hidden';
export const zmccLabelClass = 'block text-xs font-semibold text-slate-700 mb-1';
export const zmccPrimaryBtn =
  'min-h-[44px] px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-hover disabled:opacity-50 cursor-pointer';
export const zmccGhostBtn =
  'min-h-[44px] px-4 py-2 border rounded-xl text-sm text-slate-600 font-semibold hover:bg-slate-50 cursor-pointer';

export const ZmccErrorBanner: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">
      {message}
    </div>
  ) : null;

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
    'min-h-[44px] px-4 bg-white border border-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  return (
    <div className="flex items-center justify-between gap-2 p-3 border-t border-border bg-slate-50 text-xs font-semibold text-slate-700">
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
