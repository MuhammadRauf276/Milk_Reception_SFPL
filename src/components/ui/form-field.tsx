'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ErrorPopup } from './error-popup';

interface FormFieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}

/** Label, control, then the hint or the problem, in that order at every width. */
export function FormField({ label, htmlFor, required, hint, error, className, children }: FormFieldProps) {
  const messageId = htmlFor ? `${htmlFor}-message` : undefined;
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
      {error ? (
        <>
          <ErrorPopup message={`${typeof label === 'string' ? `${label}: ` : ''}${error}`} />
          <p id={messageId} className="sr-only">
            {error}
          </p>
        </>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Validators<V> = Partial<{ [K in keyof V]: (value: V[K], all: V) => string | null | undefined }>;

/**
 * Validation that does not nag: a field is only checked after the person leaves
 * it, then re-checked as they fix it. Submitting checks everything.
 */
export function useSmartValidation<V extends Record<string, unknown>>(values: V, validators: Validators<V>) {
  const [touched, setTouched] = React.useState<Partial<Record<keyof V, boolean>>>({});
  const [submitted, setSubmitted] = React.useState(false);

  const check = (key: keyof V): string | null => validators[key]?.(values[key], values) ?? null;

  const errorFor = (key: keyof V): string | null => (submitted || touched[key] ? check(key) : null);

  const blurProps = (key: keyof V) => ({
    onBlur: () => setTouched((t) => (t[key] ? t : { ...t, [key]: true })),
    'aria-invalid': errorFor(key) ? true : undefined,
  });

  /** Call on submit. Returns true when every field is valid. */
  const validateAll = () => {
    setSubmitted(true);
    return (Object.keys(validators) as (keyof V)[]).every((k) => !check(k));
  };

  const reset = () => {
    setTouched({});
    setSubmitted(false);
  };

  return { errorFor, blurProps, validateAll, reset };
}
