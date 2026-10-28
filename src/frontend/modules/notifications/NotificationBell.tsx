'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck, Settings, ArrowUpRight, Inbox } from 'lucide-react';
import { User } from '@core/types';
import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface NotificationItem {
  id: string;
  eventKey: string;
  priority: string;
  title: string;
  body: string;
  deepLink: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  readAt: string | null;
  createdAt: string;
}

const EMPTY_FEED: NotificationItem[] = [];

interface NotificationBellProps {
  currentUser: User | null;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ currentUser }) => {
  // Open state and feed are tied to the user they belong to, so switching users never shows stale data.
  const [openForUserId, setOpenForUserId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const userId = currentUser?.id ?? null;
  const feedKey = useMemo(() => ['notifications', 'feed', userId] as const, [userId]);
  type Feed = { notifications: NotificationItem[]; unreadCount: number };
  const [loading, setLoading] = useState(false);
  // Bumped when a poll brings in more unread items than before; replays the bell swing.
  const [ringKey, setRingKey] = useState(0);
  const unreadRef = useRef<number | null>(null);

  const feedQuery = useQuery<Feed>({
    queryKey: feedKey,
    enabled: Boolean(userId),
    retry: false,
    // Paused automatically while the tab is hidden (refetchIntervalInBackground defaults to false).
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      try {
        const data = await fetchJson<{ notifications?: NotificationItem[]; unreadCount?: number }>('/api/notifications', { signal });
        return { notifications: data?.notifications || [], unreadCount: Number(data?.unreadCount || 0) };
      } catch (err) {
        if (signal.aborted) throw err;
        // Ignore network/auth errors during polling; keep an empty feed.
        return { notifications: [], unreadCount: 0 };
      }
    },
  });
  const notifications = feedQuery.data?.notifications ?? EMPTY_FEED;
  const unreadCount = feedQuery.data?.unreadCount ?? 0;
  const feedOwnerId = feedQuery.data ? userId : null;

  const applyUnreadCount = useCallback(
    (next: number) => {
      unreadRef.current = next;
      queryClient.setQueryData<Feed>(feedKey, (prev) => (prev ? { ...prev, unreadCount: next } : prev));
    },
    [queryClient, feedKey]
  );

  // Replay the bell swing when a poll brings in more unread items than before.
  useEffect(() => {
    if (!feedQuery.data) return;
    const next = feedQuery.data.unreadCount;
    if (unreadRef.current !== null && next > unreadRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRingKey((key) => key + 1);
    }
    unreadRef.current = next;
  }, [feedQuery.data]);

  useEffect(() => {
    if (!userId) {
      unreadRef.current = null;
      return;
    }
    const handleLoggedOut = () => {
      queryClient.setQueryData<Feed>(feedKey, { notifications: [], unreadCount: 0 });
      unreadRef.current = null;
      setOpenForUserId(null);
    };
    window.addEventListener('milk-user-logged-out', handleLoggedOut);
    return () => window.removeEventListener('milk-user-logged-out', handleLoggedOut);
  }, [userId, queryClient, feedKey]);

  const setNotifications = (updater: (prev: NotificationItem[]) => NotificationItem[]) =>
    queryClient.setQueryData<Feed>(feedKey, (prev) => (prev ? { ...prev, notifications: updater(prev.notifications) } : prev));

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }))
        );
        applyUnreadCount(0);
      }
    } catch (_err) {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.readAt) {
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }),
        });
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        applyUnreadCount(Math.max(0, (unreadRef.current ?? 0) - 1));
      } catch (_err) {
        // Ignore
      }
    }

    setOpenForUserId(null);

    if (
      item.deepLink &&
      item.deepLink.startsWith('/') &&
      !item.deepLink.startsWith('//') &&
      !item.deepLink.includes('://')
    ) {
      window.location.assign(item.deepLink);
    }
  };

  if (!currentUser) {
    return null;
  }

  const isOpen = openForUserId === currentUser.id;
  const setIsOpen = (open: boolean) => setOpenForUserId(open ? currentUser.id : null);
  const ownsFeed = feedOwnerId === currentUser.id;
  const visibleNotifications = ownsFeed ? notifications : [];
  const visibleUnreadCount = ownsFeed ? unreadCount : 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground"
        aria-label={visibleUnreadCount > 0 ? `Notifications, ${visibleUnreadCount} unread` : 'Notifications'}
      >
        <motion.span
          key={ringKey}
          className="inline-flex origin-[50%_15%]"
          animate={ringKey > 0 ? { rotate: [0, -14, 11, -7, 4, 0] } : undefined}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
        >
          <Bell className="h-[18px] w-[18px]" />
        </motion.span>
        <AnimatePresence initial={false}>
          {visibleUnreadCount > 0 && (
            <motion.span
              key="unread-badge"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-card"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            >
              {visibleUnreadCount > 99 ? '99+' : visibleUnreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>

      <PopoverContent align="end" className="flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {visibleUnreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {visibleUnreadCount} new
              </span>
            )}
          </div>
          {visibleUnreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={loading}
              className="min-h-11 min-w-11 inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="scrollbar-thin max-h-[360px] overflow-y-auto">
          {visibleNotifications.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-foreground">All caught up</p>
            </div>
          ) : (
            <ul className="divide-y">
              {visibleNotifications.map((item) => {
                const isUnread = !item.readAt;
                const isHighPriority = item.priority === 'HIGH' || item.priority === 'URGENT';

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(item)}
                      className={cn('min-h-11 min-w-11', 
                        'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-hidden',
                        isUnread && 'bg-primary/3'
                      )}
                    >
                      <span
                        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', isUnread ? 'bg-primary' : 'bg-transparent')}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={cn('truncate text-sm', isUnread ? 'font-medium text-foreground' : 'text-slate-600')}>
                            {item.title}
                          </span>
                          {isHighPriority && (
                            <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700">
                              {item.priority}
                            </span>
                          )}
                        </span>
                        <span className="line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
                        <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="tabular-nums">
                            {item.createdAt
                              ? new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : ''}
                          </span>
                          {item.deepLink && (
                            <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                              Open
                              <ArrowUpRight className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-subtle px-4 py-2.5 text-xs">
          <Link
            href="/notifications/settings"
            onClick={() => setIsOpen(false)}
            className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>
          <span className="text-muted-foreground">Refreshes every minute</span>
        </div>
      </PopoverContent>
    </Popover>
  );
};
