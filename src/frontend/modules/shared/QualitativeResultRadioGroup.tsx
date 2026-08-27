'use client';

import React from 'react';

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
    <div className={`space-y-1.5 ${className}`}>
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold font-mono cursor-pointer transition select-none ${
                disabled
                  ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-300 text-slate-500'
                  : isChecked
                  ? 'bg-blue-50 border-blue-600 text-[#1E3A8A] ring-1 ring-blue-600 shadow-sm'
                  : 'bg-white border-[#C4B9A3] text-[#111311] hover:bg-slate-50 hover:border-slate-400'
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
                className="w-3.5 h-3.5 text-[#1E3A8A] border-slate-300 focus:ring-2 focus:ring-[#1E3A8A] cursor-pointer"
              />
              <span className="leading-tight">{opt.label || opt.value}</span>
            </label>
          );
        })}
      </div>

      {error && (
        <p className="text-[11px] font-bold text-rose-600 mt-0.5" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
};
