'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'SUCCESS' | 'WARNING' | 'ERROR' | 'INFO';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, title?: string, durationMs?: number) => void;
  showSuccess: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, title?: string, durationMs: number = 4000) => {
      const id = typeof window !== 'undefined' && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `toast-${Date.now()}-${Math.random()}`;

      const newToast: ToastItem = { id, type, title, message };
      setToasts((prev) => [...prev.slice(-4), newToast]); // keep max 5 toasts visible

      if (durationMs > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, durationMs);
      }
    },
    [dismissToast]
  );

  const showSuccess = useCallback((message: string, title?: string) => showToast('SUCCESS', message, title), [showToast]);
  const showWarning = useCallback((message: string, title?: string) => showToast('WARNING', message, title), [showToast]);
  const showError = useCallback((message: string, title?: string) => showToast('ERROR', message, title), [showToast]);
  const showInfo = useCallback((message: string, title?: string) => showToast('INFO', message, title), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showWarning, showError, showInfo, dismissToast }}>
      {children}

      {/* Global Top-Right Toast Container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col space-y-2.5 max-w-md w-full pointer-events-none pr-2">
        {toasts.map((toast) => {
          let bgClass = 'bg-slate-900 text-white border-slate-700';
          let icon = <Info className="w-5 h-5 text-blue-400 shrink-0" />;

          if (toast.type === 'SUCCESS') {
            bgClass = 'bg-emerald-950 text-emerald-100 border-emerald-700 shadow-emerald-950/30';
            icon = <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
          } else if (toast.type === 'WARNING') {
            bgClass = 'bg-amber-950 text-amber-100 border-amber-700 shadow-amber-950/30';
            icon = <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
          } else if (toast.type === 'ERROR') {
            bgClass = 'bg-rose-950 text-rose-100 border-rose-700 shadow-rose-950/30';
            icon = <XCircle className="w-5 h-5 text-rose-400 shrink-0" />;
          } else if (toast.type === 'INFO') {
            bgClass = 'bg-blue-950 text-blue-100 border-blue-700 shadow-blue-950/30';
            icon = <Info className="w-5 h-5 text-blue-400 shrink-0" />;
          }

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-4 rounded-xl border shadow-lg flex items-start space-x-3 transition-all duration-300 animate-in fade-in slide-in-from-top-3 ${bgClass}`}
            >
              {icon}
              <div className="flex-1 text-xs">
                {toast.title && <h4 className="font-extrabold text-sm mb-0.5 tracking-tight">{toast.title}</h4>}
                <p className="font-medium leading-relaxed">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="text-white/60 hover:text-white transition p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    // Graceful fallback if context is not mounted
    return {
      showToast: () => {},
      showSuccess: (msg) => console.log('[Toast SUCCESS]', msg),
      showWarning: (msg) => console.warn('[Toast WARNING]', msg),
      showError: (msg) => console.error('[Toast ERROR]', msg),
      showInfo: (msg) => console.log('[Toast INFO]', msg),
      dismissToast: () => {},
    };
  }
  return context;
}
