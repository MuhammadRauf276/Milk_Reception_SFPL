'use client';

import React, { useMemo } from 'react';
import { toast } from '@/frontend/lib/appToast';
import { Toaster } from '@/components/ui/sonner';

export type ToastType = 'SUCCESS' | 'WARNING' | 'ERROR' | 'INFO';

interface ToastContextValue {
  showToast: (type: ToastType, message: string, title?: string, durationMs?: number) => void;
  showSuccess: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6000;

/**
 * Thin adapter over sonner so existing `useToast()` call sites keep working.
 * With a title, the title becomes the toast heading and the message its description.
 */
function showToast(type: ToastType, message: string, title?: string, durationMs?: number) {
  const heading = title ?? message;
  const options = {
    description: title ? message : undefined,
    duration:
      durationMs === 0
        ? Infinity
        : durationMs ?? (type === 'ERROR' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
  };

  switch (type) {
    case 'SUCCESS':
      toast.success(heading, options);
      break;
    case 'WARNING':
      toast.warning(heading, options);
      break;
    case 'ERROR':
      toast.error(heading, options);
      break;
    default:
      toast.info(heading, options);
  }
}

const toastApi: ToastContextValue = {
  showToast,
  showSuccess: (message, title) => showToast('SUCCESS', message, title),
  showWarning: (message, title) => showToast('WARNING', message, title),
  showError: (message, title) => showToast('ERROR', message, title),
  showInfo: (message, title) => showToast('INFO', message, title),
  dismissToast: (id) => toast.dismiss(id),
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
};

export function useToast(): ToastContextValue {
  return useMemo(() => toastApi, []);
}
