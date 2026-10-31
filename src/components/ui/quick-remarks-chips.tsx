'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QuickRemarksChipsProps {
  presets: readonly string[] | string[];
  value: string;
  onChange: (value: string) => void;
  mode?: 'append' | 'replace';
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * QuickRemarksChips: Preset operational chips for 1-tap entry without raising virtual keyboard.
 * - Supports instant touch selection on mobile.
 * - Minimum 44px touch targets.
 * - Toggleable selection or append behavior.
 */
export function QuickRemarksChips({
  presets,
  value,
  onChange,
  mode = 'append',
  label = 'Quick presets:',
  className,
  disabled = false,
}: QuickRemarksChipsProps) {
  if (!presets || presets.length === 0) return null;

  const isSelected = (preset: string) => {
    if (!value) return false;
    if (mode === 'replace') {
      return value.trim().toLowerCase() === preset.trim().toLowerCase();
    }
    return value.toLowerCase().includes(preset.toLowerCase());
  };

  const handleChipClick = (preset: string) => {
    if (disabled) return;

    if (mode === 'replace') {
      if (isSelected(preset)) {
        onChange('');
      } else {
        onChange(preset);
      }
      return;
    }

    // Append mode
    const current = (value || '').trim();
    if (!current) {
      onChange(preset);
      return;
    }

    if (isSelected(preset)) {
      // Toggle off / remove from remarks
      const parts = current
        .split(/[,;\n]+/)
        .map((p) => p.trim())
        .filter((p) => p.toLowerCase() !== preset.toLowerCase());
      onChange(parts.join(', '));
    } else {
      // Append
      onChange(`${current}, ${preset}`);
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <span className="block text-[11px] font-semibold text-muted-foreground select-none">
          {label}
        </span>
      )}
      <div
        role="group"
        aria-label={label}
        className="scrollbar-none flex flex-wrap items-center gap-1.5 overflow-x-auto py-0.5"
      >
        {presets.map((preset) => {
          const selected = isSelected(preset);
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => handleChipClick(preset)}
              aria-pressed={selected}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all select-none',
                'active:scale-95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary bg-primary/10 text-primary font-semibold shadow-2xs'
                  : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground active:bg-muted/50',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
              <span>{preset}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
