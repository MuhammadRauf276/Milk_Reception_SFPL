'use client';

import React, { useEffect, useState } from 'react';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function PwaShell() {
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    setMounted(true);
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const sync = (event: Event) =>
      setSyncing(Boolean((event as CustomEvent<{ syncing?: boolean }>).detail?.syncing));
    const expired = () => setAuthExpired(true);

    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('milk-sync-state', sync);
    window.addEventListener('milk-auth-expired', expired);

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const isLoginPage = typeof window !== 'undefined' && (window.location.pathname === '/login' || window.location.pathname === '/workspace-unavailable');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(async (registration) => {
          registration.addEventListener('updatefound', () => {
            if (registration.installing) {
              registration.installing.addEventListener('statechange', () => {
                if (registration.waiting) setUpdateAvailable(true);
              });
            }
          });
          if (registration.waiting) setUpdateAvailable(true);

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
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('milk-sync-state', sync);
      window.removeEventListener('milk-auth-expired', expired);
      window.removeEventListener('milk-user-logged-out', handleLoggedOut);
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div id="pwa-shell-root">
      {syncing && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-[99] bg-blue-100 px-3 py-2 text-center text-xs font-bold text-blue-950"
        >
          Synchronizing saved offline work…
        </div>
      )}
      {!online && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-[100] bg-amber-100 px-3 py-2 text-center text-xs font-bold text-amber-950"
        >
          Offline: server actions, approvals, administration, and financial actions are unavailable.
        </div>
      )}
      {authExpired && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-[101] bg-rose-100 px-3 py-2 text-center text-xs font-bold text-rose-950"
        >
          Your session has expired offline. Please reconnect and log in again before saving data.
        </div>
      )}
      {updateAvailable && (
        <div className="fixed inset-x-0 bottom-0 z-[102] flex items-center justify-between bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-lg">
          <span>An application update is ready.</span>
          <button
            type="button"
            className="underline hover:text-blue-200 cursor-pointer"
            onClick={() => window.location.reload()}
          >
            Reload now
          </button>
        </div>
      )}
    </div>
  );
}
