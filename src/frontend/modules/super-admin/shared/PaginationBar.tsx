'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalRecords: number;
  noun?: string;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}

/** Previous / Next pager with 44px touch targets. Shows only a count when there is one page. */
export function PaginationBar({ page, totalPages, totalRecords, noun = 'records', disabled, onPageChange }: PaginationBarProps) {
  if (totalPages <= 1) {
    return (
      <div className="border-t border-border px-4 py-2 text-[11px] font-semibold text-slate-500">
        {totalRecords.toLocaleString()} {noun}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-white px-3 py-2 text-xs font-semibold text-slate-700">
      <div>
        Page <span className="text-primary">{page}</span> of <span className="text-primary">{totalPages}</span>
        <span className="hidden sm:inline">
          {' '}
          ({totalRecords.toLocaleString()} {noun})
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button type="button" variant="outline" className="h-11 px-4" disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
