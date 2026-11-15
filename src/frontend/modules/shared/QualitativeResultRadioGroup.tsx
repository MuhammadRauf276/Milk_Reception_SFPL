'use client';

import React from 'react';
import { ErrorPopup } from '@/components/ui/error-popup';

export interface ResultOption {
  value: string;
  label: string;
  isPassing?: boolean | null;
}

export interface QualitativeResultRadioGroupProps {
  name: string;
  value: string | null;
  options: ResultOption[];
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

export const QualitativeResultRadioGroup: React.FC<QualitativeResultRadioGroupProps> = ({
  name,
  value,
  options,
  disabled = false,
  compact = false,
  onChange,
  error,
  className = '',
  ariaLabel,
  ariaLabelledBy,
}) => {
  if (!options || options.length === 0) {
    return null;
  }

  const errorId = error ? `radio-error-${name}` : undefined;
  const accessibleGroupLabel = ariaLabel || (ariaLabelledBy ? undefined : 'Qualitative test result');

  return (
    <div className={`space-y-1 ${className}`}>
      <div
        role="radiogroup"
        {...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : { 'aria-label': accessibleGroupLabel })}
        {...(errorId ? { 'aria-describedby': errorId } : {})}
        className="flex flex-wrap items-center gap-2"
      >
        {options.map((opt, idx) => {
          const isChecked = value === opt.value;
          const sanitizedVal = opt.value.replace(/[^a-zA-Z0-9_-]/g, '_');
          const inputId = `${name}-opt-${sanitizedVal}-${idx}`;

          return (
            <label
              key={opt.value}
              htmlFor={inputId}
              className={`inline-flex min-h-11 min-w-11 justify-center items-center cursor-pointer transition select-none font-semibold tabular-nums ${
                compact ? 'gap-1 px-2 py-0.5 rounded-md text-xs' : 'gap-2 px-3 py-2 rounded-lg text-xs'
              } border ${
                disabled
                  ? 'opacity-50 cursor-not-allowed bg-muted border-border-strong text-muted-foreground'
                  : isChecked
                  ? opt.isPassing === false
                    ? 'bg-rose-100 border-rose-500 text-rose-900 ring-1 ring-rose-500'
                    : 'bg-primary/10 border-primary text-primary ring-1 ring-primary shadow-xs'
                  : 'bg-card border-border-strong text-foreground hover:bg-subtle hover:border-border-strong'
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                value={opt.value}
                checked={isChecked}
                disabled={disabled}
                onChange={() => onChange(opt.value)}
                aria-describedby={errorId}
                className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-primary border-border-strong focus:ring-2 focus:ring-primary cursor-pointer`}
              />
              <span className="leading-tight">{opt.label || opt.value}</span>
            </label>
          );
        })}
      </div>

      <ErrorPopup message={error} />
    </div>
  );
};
