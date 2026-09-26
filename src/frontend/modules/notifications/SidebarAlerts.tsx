'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  ExternalLink,
  Inbox,
  Settings,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { User } from '@core/types';

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

interface SidebarAlertsProps {
  currentUser?: User | null;
  onNavigate?: (href: string) => void;
  defaultExpanded?: boolean;
}

export const SidebarAlerts: React.FC<SidebarAlertsProps> = ({
  currentUser,
  onNavigate,
  defaultExpanded = false,
}) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data?.notifications || []);
        setUnreadCount(Number(data?.unreadCount || 0));
      } else if (res.status === 401) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (_err) {
      // Ignore network errors during polling
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = window.setInterval(fetchNotifications, 60000);

    const handleLoggedOut = () => {
      setNotifications([]);
      setUnreadCount(0);
      setIsOpen(false);
      clearInterval(interval);
    };

    window.addEventListener('milk-user-logged-out', handleLoggedOut);

    return () => {
      clearInterval(interval);
      window.removeEventListener('milk-user-logged-out', handleLoggedOut);
    };
  }, [fetchNotifications]);

  const handleMarkAllRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
        setUnreadCount(0);
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
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (_err) {
        // Ignore
      }
    }

    if (
      item.deepLink &&
      item.deepLink.startsWith('/') &&
      !item.deepLink.startsWith('//') &&
      !item.deepLink.includes('://')
    ) {
      if (onNavigate) {
        onNavigate(item.deepLink);
      } else {
        router.push(item.deepLink);
      }
    }
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const href = '/notifications/settings';
    if (onNavigate) {
      onNavigate(href);
    } else {
      router.push(href);
    }
  };

  const displayedNotifications =
    filter === 'unread'
      ? notifications.filter((item) => !item.readAt)
      : notifications;

  return (
    <div className="space-y-1.5 pt-1 border-t border-slate-200">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
          Alerts & Notices
        </span>
      </div>

      {/* Main Accordion Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full min-h-[40px] flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-bold transition-all border text-left cursor-pointer ${
          isOpen
            ? 'bg-blue-50 border-blue-200 text-blue-900 shadow-xs'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
        }`}
        aria-expanded={isOpen}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <div className="relative shrink-0">
            <Bell
              className={`w-4 h-4 ${isOpen ? 'text-blue-600' : 'text-slate-600'}`}
            />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-600 ring-2 ring-white animate-pulse" />
            )}
          </div>
          <span className="truncate">Alerts</span>
        </div>

        <div className="flex items-center space-x-2 shrink-0 ml-2">
          {unreadCount > 0 ? (
            <span className="px-1.5 py-0 text-[10px] font-black h-4 min-w-[18px] flex items-center justify-center animate-pulse rounded bg-rose-600 text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 font-semibold px-1">
              {notifications.length}
            </span>
          )}
          <span className="text-slate-400">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-blue-600" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </span>
        </div>
      </button>

      {/* Expanded Alerts Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border border-slate-200 bg-slate-50/50 p-2 space-y-2 overflow-hidden"
          >
            {/* Action Bar inside Expanded View */}
            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-slate-200/80 text-xs">
              {/* Filter Tabs */}
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer ${
                    filter === 'all'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  All ({notifications.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('unread')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer ${
                    filter === 'unread'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  Unread ({unreadCount})
                </button>
              </div>

              {/* Mark All Read Button */}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={loading}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Mark all notifications as read"
                >
                  <CheckCheck className="w-3 h-3" />
                  <span>Mark all read</span>
                </button>
              )}
            </div>

            {/* Notification Items List */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
              {displayedNotifications.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  <Inbox className="w-6 h-6 mx-auto mb-1 text-slate-300" />
                  <p className="font-semibold text-slate-500">
                    {filter === 'unread' ? 'No unread alerts' : 'No alerts recorded'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">You are fully caught up.</p>
                </div>
              ) : (
                displayedNotifications.map((item) => {
                  const isUnread = !item.readAt;
                  const isHighPriority =
                    item.priority === 'HIGH' || item.priority === 'URGENT';

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemClick(item)}
                      className={`w-full text-left p-2.5 rounded-lg border text-xs transition cursor-pointer flex flex-col space-y-1 ${
                        isUnread
                          ? 'bg-white border-blue-200 shadow-xs hover:border-blue-300'
                          : 'bg-white/80 border-slate-200 hover:bg-white text-slate-600'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isUnread && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
                          )}
                          <strong
                            className={`block truncate ${
                              isUnread ? 'text-slate-900 font-extrabold' : 'text-slate-700 font-bold'
                            }`}
                          >
                            {item.title}
                          </strong>
                        </div>
                        {isHighPriority && (
                          <span className="text-[8px] font-black uppercase px-1 py-0.5 shrink-0 leading-tight rounded bg-rose-600 text-white">
                            {item.priority}
                          </span>
                        )}
                      </div>

                      <p className="text-slate-600 text-[11px] leading-snug line-clamp-2">
                        {item.body}
                      </p>

                      <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono pt-0.5">
                        <span>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </span>
                        {item.deepLink && (
                          <span className="text-blue-600 font-bold flex items-center gap-0.5">
                            <span>Open</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer with Notification Settings link */}
            <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between text-[10px]">
              <button
                type="button"
                onClick={handleSettingsClick}
                className="text-slate-600 hover:text-blue-600 font-bold flex items-center gap-1 transition cursor-pointer"
              >
                <Settings className="w-3 h-3" />
                <span>Notification Settings</span>
              </button>
              <button
                type="button"
                onClick={fetchNotifications}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                title="Refresh alerts"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
