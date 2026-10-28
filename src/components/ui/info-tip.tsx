'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Short hint behind an (i) icon. Use it instead of a visible sentence:
 * the screen shows at most ~3 words, anything longer goes in here.
 */
export function InfoTip({ text, className, label = 'More info' }: { text: React.ReactNode; className?: string; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-xs leading-relaxed text-slate-700">{text}</PopoverContent>
    </Popover>
  );
}
