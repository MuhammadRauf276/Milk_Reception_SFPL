'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Item = {
  id: string;
  priority: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationCenter() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentPath = pathname || (typeof window !== 'undefined' ? window.location.pathname : '');
  const isStation = Boolean(
    currentPath &&
      (currentPath.startsWith('/department') ||
        currentPath.startsWith('/super-admin') ||
        currentPath.startsWith('/mpd') ||
        currentPath.startsWith('/zmcc') ||
        currentPath.startsWith('/mot') ||
        currentPath.startsWith('/phe') ||
        currentPath.startsWith('/contractor') ||
        currentPath.startsWith('/finance') ||
        currentPath.startsWith('/notifications') ||
        currentPath.startsWith('/tv-board'))
  );

  const load = useCallback(() => {
    if (!isStation) return;
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((data) => {
        setItems(data?.notifications || []);
        setUnread(data?.unreadCount || 0);
      })
      .catch(() => undefined);
  }, [isStation]);

  useEffect(() => {
    if (!mounted || !isStation) return;

    load();
    const timer = window.setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [mounted, isStation, load]);

  const read = async (item: Item) => {
    if (!item.readAt) {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
    }
    if (
      item.deepLink &&
      item.deepLink.startsWith('/') &&
      !item.deepLink.startsWith('//') &&
      !item.deepLink.includes('://')
    ) {
      window.location.assign(item.deepLink);
    } else {
      load();
    }
  };

  if (!mounted || !isStation) {
    return null;
  }

  return (
    <div className="fixed right-3 top-3 z-[90]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-full border bg-white px-3 py-2 text-xs font-bold shadow-sm hover:bg-slate-50 transition cursor-pointer"
      >
        Alerts{unread ? ` (${unread})` : ''}
      </button>
      {open && (
        <div className="mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border bg-white p-3 shadow-xl">
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <strong className="text-xs font-bold text-slate-900">Notifications</strong>
            <button
              type="button"
              className="text-xs font-semibold text-blue-700 underline hover:text-blue-900 cursor-pointer"
              onClick={async () => {
                await fetch('/api/notifications', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ markAllRead: true }),
                });
                load();
              }}
            >
              Mark all read
            </button>
          </div>
          {items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => read(item)}
                className={`mt-2 w-full rounded-lg border p-2.5 text-left text-xs transition cursor-pointer ${
                  item.readAt ? 'bg-white border-slate-200' : 'bg-blue-50/70 border-blue-200'
                }`}
              >
                <strong className="block text-slate-900 font-bold">{item.title}</strong>
                <p className="text-slate-600 mt-0.5">{item.body}</p>
                <span className="mt-1 block text-slate-400">
                  {item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : ''}
                </span>
              </button>
            ))
          ) : (
            <div className="py-4 text-center text-xs text-slate-500">No active notifications</div>
          )}
        </div>
      )}
    </div>
  );
}
