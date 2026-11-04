'use client';

import React, { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff, AlertTriangle, Loader2, CheckCircle2, Database } from 'lucide-react';
import { useNetworkHealth, type NetworkHealthStatus } from '@/frontend/hooks/useNetworkHealth';

export function NetworkStatusBar() {
  const { status, isOnline, isReconnecting, checkHealth } = useNetworkHealth();
  const [showRestored, setShowRestored] = useState(false);
  const [isManualChecking, setIsManualChecking] = useState(false);
  const previousStatusRef = useRef<NetworkHealthStatus>(status);

  useEffect(() => {
    const prev = previousStatusRef.current;
    previousStatusRef.current = status;
    if (status === 'ONLINE' && prev !== 'ONLINE') {
      // Transitioned back to online from a degraded state
      setShowRestored(true);
      const timer = setTimeout(() => {
        setShowRestored(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleRetry = async () => {
    setIsManualChecking(true);
    try {
      await checkHealth();
    } finally {
      setIsManualChecking(false);
    }
  };

  // "Restored" only ever shows while actually online, even if the connection drops again during those seconds.
  const restoredVisible = showRestored && status === 'ONLINE';

  // Do not render anything if system is completely healthy and not showing restored banner
  if (isOnline && !restoredVisible) {
    return null;
  }

  return (
    <aside aria-label="Network status" className="fixed top-0 inset-x-0 z-[100] pointer-events-none flex justify-center px-2 pt-1 sm:pt-2">
      <AnimatePresence mode="wait">
        {restoredVisible ? (
          <motion.div
            key="status-restored"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md backdrop-blur-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>Connection restored</span>
          </motion.div>
        ) : status === 'OFFLINE' ? (
          <motion.div
            key="status-offline"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-xs"
          >
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 shrink-0 text-white/90" />
              <span>Offline · You are not connected to the internet</span>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isManualChecking || isReconnecting}
              className="inline-flex min-h-7 items-center gap-1 rounded-md bg-white/20 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-white/30 disabled:opacity-50"
            >
              {isManualChecking || isReconnecting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              <span>Retry</span>
            </button>
          </motion.div>
        ) : status === 'DATABASE_UNAVAILABLE' ? (
          <motion.div
            key="status-db-unavailable"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-rose-600/30 bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-xs"
          >
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-white/90" />
              <span>Database Unavailable · Server online but database unreachable</span>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isManualChecking || isReconnecting}
              className="inline-flex min-h-7 items-center gap-1 rounded-md bg-white/20 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-white/30 disabled:opacity-50"
            >
              {isManualChecking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              <span>Retry</span>
            </button>
          </motion.div>
        ) : status === 'API_UNREACHABLE' || status === 'RECONNECTING' ? (
          <motion.div
            key="status-unreachable"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-xs"
          >
            <div className="flex items-center gap-2">
              {isReconnecting ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/90" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-white/90" />
              )}
              <span>
                {isReconnecting
                  ? 'Reconnecting to server…'
                  : 'Server unreachable · Checking connection'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isManualChecking || isReconnecting}
              className="inline-flex min-h-7 items-center gap-1 rounded-md bg-white/20 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-white/30 disabled:opacity-50"
            >
              {isManualChecking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              <span>Retry</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
