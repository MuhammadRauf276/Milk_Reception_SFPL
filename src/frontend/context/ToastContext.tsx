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
          let bgClass = 'bg-white text-[#111311] border-[#EAE4D5] shadow-lg';
          let icon = <Info className="w-5 h-5 text-[#1E3A8A] shrink-0" />;

          if (toast.type === 'SUCCESS') {
            bgClass = 'bg-emerald-50 text-emerald-950 border-emerald-300 shadow-emerald-950/10 shadow-lg';
            icon = <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />;
          } else if (toast.type === 'WARNING') {
            bgClass = 'bg-amber-50 text-amber-950 border-amber-300 shadow-amber-950/10 shadow-lg';
            icon = <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />;
          } else if (toast.type === 'ERROR') {
            bgClass = 'bg-rose-50 text-rose-950 border-rose-300 shadow-rose-950/10 shadow-lg';
            icon = <XCircle className="w-5 h-5 text-rose-600 shrink-0" />;
          } else if (toast.type === 'INFO') {
            bgClass = 'bg-blue-50 text-blue-950 border-blue-300 shadow-blue-950/10 shadow-lg';
            icon = <Info className="w-5 h-5 text-[#1E3A8A] shrink-0" />;
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
                className="text-slate-500 hover:text-[#111311] hover:bg-black/5 transition p-1 rounded-lg"
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
