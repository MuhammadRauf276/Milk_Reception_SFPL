'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, ShieldAlert, WifiOff, Loader2 } from 'lucide-react';
import { useIsClient, useOnlineStatus } from '@/frontend/hooks/useOnlineStatus';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function PwaShell() {
  const mounted = useIsClient();
  const online = useOnlineStatus();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    const sync = (event: Event) =>
      setSyncing(Boolean((event as CustomEvent<{ syncing?: boolean }>).detail?.syncing));
    const expired = () => setAuthExpired(true);

    window.addEventListener('milk-sync-state', sync);
    window.addEventListener('milk-auth-expired', expired);

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const isLoginPage = typeof window !== 'undefined' && (window.location.pathname === '/login' || window.location.pathname === '/workspace-unavailable');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(async (registration) => {
          // Only an update when a previous worker already controls the page;
          // the very first install is not an "update".
          const hadController = Boolean(navigator.serviceWorker.controller);
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (installing.state === 'installed' && hadController) setUpdateAvailable(true);
              });
            }
          });
          if (registration.waiting && hadController) setUpdateAvailable(true);

          if (key && 'PushManager' in window && Notification.permission === 'granted' && !isLoginPage) {
            try {
              const subscription =
                (await registration.pushManager.getSubscription()) ||
                (await registration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: fromBase64Url(key),
                }));
              const json = subscription?.toJSON();
              if (json?.endpoint && json?.keys?.p256dh && json?.keys?.auth) {
                const res = await fetch('/api/notifications/subscriptions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    endpoint: json.endpoint,
                    p256dh: json.keys.p256dh,
                    auth: json.keys.auth,
                    deviceLabel: navigator.userAgent.slice(0, 100),
                  }),
                });
                if (res.status === 401) {
                  // Unauthorized - unsubscribe device from push notifications
                  await subscription.unsubscribe().catch(() => null);
                }
              }
            } catch (_err) {
              // Ignore push registration errors
            }
          }
        })
        .catch(() => undefined);
    }

    const handleLoggedOut = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready.catch(() => null);
          const sub = await reg?.pushManager?.getSubscription().catch(() => null);
          if (sub) {
            await sub.unsubscribe().catch(() => null);
          }
        }
      } catch (_err) {
        // Ignore
      }
    };

    window.addEventListener('milk-user-logged-out', handleLoggedOut);

    return () => {
      window.removeEventListener('milk-sync-state', sync);
      window.removeEventListener('milk-auth-expired', expired);
      window.removeEventListener('milk-user-logged-out', handleLoggedOut);
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const banners: Array<{ id: string; tone: string; icon: React.ReactNode; message: string; action?: React.ReactNode }> = [];
  if (authExpired) {
    banners.push({
      id: 'auth',
      tone: 'border-red-200 bg-red-50 text-red-900',
      icon: <ShieldAlert className="h-4 w-4 text-red-600" />,
      message: 'Your session expired while offline. Reconnect and sign in again before saving data.',
    });
  }
  if (!online) {
    banners.push({
      id: 'offline',
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: <WifiOff className="h-4 w-4 text-amber-600" />,
      message: 'You are offline. Approvals, administration and financial actions are unavailable.',
    });
  }
  if (syncing) {
    banners.push({
      id: 'sync',
      tone: 'border-blue-200 bg-blue-50 text-blue-900',
      icon: <Loader2 className="h-4 w-4 animate-spin text-blue-600" />,
      message: 'Synchronizing saved offline work…',
    });
  }
  if (updateAvailable) {
    banners.push({
      id: 'update',
      tone: 'border-slate-800 bg-slate-900 text-white',
      icon: <Download className="h-4 w-4 text-slate-300" />,
      message: 'A new version of the app is ready.',
      action: (
        <button
          type="button"
          className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/20"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      ),
    });
  }

  return (
    <div
      id="pwa-shell-root"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-banner flex flex-col items-center gap-2 p-3 sm:p-4"
    >
      <AnimatePresence initial={false}>
        {banners.map((banner) => (
          <motion.div
            key={banner.id}
            role="status"
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className={`pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg ${banner.tone}`}
          >
            {banner.icon}
            <span className="flex-1">{banner.message}</span>
            {banner.action}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
