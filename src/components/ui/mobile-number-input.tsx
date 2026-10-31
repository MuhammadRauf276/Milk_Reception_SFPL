'use client';

import * as React from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MobileNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (val: string) => void;
  unit?: string;
  allowClear?: boolean;
  showSteppers?: boolean;
  step?: number | string;
  min?: number | string;
  max?: number | string;
}

/**
 * MobileNumberInput: A mobile-first numeric input component.
 * - Forces inputMode="decimal" (or numeric) for triggering the OS numeric keyboard.
 * - Minimum 16px (text-base) font-size on mobile to eliminate browser auto-zoom.
 * - Minimum 44px touch target height.
 * - Quick-clear button (X) when value exists.
 * - Optional stepper buttons (+/-) with step and min/max boundaries.
 * - Optional unit indicator label (e.g. °C, Ltr, %).
 */
export const MobileNumberInput = React.forwardRef<HTMLInputElement, MobileNumberInputProps>(
  (
    {
      className,
      value,
      onChange,
      onValueChange,
      unit,
      allowClear = true,
      showSteppers = false,
      step = 'any',
      min,
      max,
      disabled,
      inputMode = 'decimal',
      placeholder = '0.00',
      ...props
    },
    ref
  ) => {
    const internalRef = React.useRef<HTMLInputElement | null>(null);

    const handleRef = (node: HTMLInputElement | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const handleClear = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      if (onValueChange) {
        onValueChange('');
      }
      if (onChange && internalRef.current) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement?.prototype || {},
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(internalRef.current, '');
        } else {
          internalRef.current.value = '';
        }
        const event = new Event('input', { bubbles: true });
        internalRef.current.dispatchEvent(event);
      }
      internalRef.current?.focus();
    };

    const handleStep = (direction: 'up' | 'down') => {
      if (disabled) return;
      const stepVal = typeof step === 'number' ? step : (parseFloat(step) || 1);
      const currentVal = parseFloat(String(value)) || 0;
      let nextVal = direction === 'up' ? currentVal + stepVal : currentVal - stepVal;

      const decimals = String(step).split('.')[1]?.length || 0;
      if (decimals > 0) {
        nextVal = parseFloat(nextVal.toFixed(decimals));
      }

      if (min !== undefined && nextVal < Number(min)) nextVal = Number(min);
      if (max !== undefined && nextVal > Number(max)) nextVal = Number(max);

      const strVal = String(nextVal);
      if (onValueChange) {
        onValueChange(strVal);
      }
      if (onChange && internalRef.current) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement?.prototype || {},
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(internalRef.current, strVal);
        } else {
          internalRef.current.value = strVal;
        }
        const event = new Event('input', { bubbles: true });
        internalRef.current.dispatchEvent(event);
      }
    };

    const hasValue = value !== '' && value !== undefined && value !== null;

    return (
      <div className={cn('relative flex items-center w-full', className)}>
        {showSteppers && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => handleStep('down')}
            disabled={disabled || (min !== undefined && Number(value) <= Number(min))}
            aria-label="Decrease value"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-l-md border border-r-0 border-input bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted-foreground/20 disabled:pointer-events-none disabled:opacity-40 transition-colors"
          >
            <Minus className="h-4 w-4" />
          </button>
        )}

        <div className="relative flex-1">
          <input
            ref={handleRef}
            type="text"
            inputMode={inputMode}
            pattern="[0-9]*[.,]?[0-9]*"
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
              onChange?.(e);
              onValueChange?.(e.target.value);
            }}
            className={cn(
              'flex min-h-11 w-full border border-input bg-card px-3 py-2 text-base font-mono sm:text-sm shadow-2xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50',
              showSteppers ? 'rounded-none border-x-0' : 'rounded-md',
              unit && (hasValue && allowClear ? 'pr-16' : 'pr-10'),
              !unit && hasValue && allowClear && 'pr-10'
            )}
            {...props}
          />

          {hasValue && allowClear && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={handleClear}
              aria-label="Clear value"
              className={cn(
                'absolute top-1/2 -translate-y-1/2 flex min-h-11 min-w-11 items-center justify-center text-muted-foreground/60 hover:text-foreground active:text-foreground transition-colors',
                unit ? 'right-7' : 'right-0'
              )}
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {unit && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground select-none">
              {unit}
            </span>
          )}
        </div>

        {showSteppers && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => handleStep('up')}
            disabled={disabled || (max !== undefined && Number(value) >= Number(max))}
            aria-label="Increase value"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-r-md border border-l-0 border-input bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted-foreground/20 disabled:pointer-events-none disabled:opacity-40 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);

MobileNumberInput.displayName = 'MobileNumberInput';
