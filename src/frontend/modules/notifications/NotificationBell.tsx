'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, CheckCheck, Settings, ExternalLink, Inbox } from 'lucide-react';
import { User } from '@core/types';
import Link from 'next/link';

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

interface NotificationBellProps {
  currentUser: User | null;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ currentUser }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!currentUser) return;
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
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      setUnreadCount(0);
      setIsOpen(false);
      return;
    }

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
  }, [currentUser, fetchNotifications]);

  // Handle click outside to close dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

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

    setIsOpen(false);

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

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-[#EAE4D5] bg-[#FDFBF9] text-[#111311] hover:bg-[#F4F0E6] hover:border-[#C4B9A3] transition flex items-center justify-center relative focus:outline-none focus:ring-2 focus:ring-[#1E3A8A] shadow-xs cursor-pointer"
        aria-label="Open notifications"
        aria-expanded={isOpen}
        aria-haspopup="true"
        title="Notifications"
      >
        <Bell className="w-4 h-4 text-[#1E3A8A]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-xs border-2 border-white leading-none animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[480px] bg-white border border-[#C4B9A3] rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden text-[#111311] animate-in fade-in slide-in-from-top-2 duration-150"
          role="region"
          aria-label="Notifications Dropdown"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#EAE4D5] bg-[#FDFBF9]">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-black uppercase tracking-wider text-[#111311]">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-black border border-rose-200">
                  {unreadCount} unread
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={loading}
                className="text-xs font-bold text-[#1E3A8A] hover:underline flex items-center space-x-1 cursor-pointer disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List of Notifications */}
          <div className="overflow-y-auto flex-1 max-h-[340px] p-2 space-y-1.5 divide-y divide-[#EAE4D5]/60">
            {notifications.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-[#F4F0E6] text-slate-400 flex items-center justify-center">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-slate-600">No active notifications</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  You are fully up to date with plant events.
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const isUnread = !item.readAt;
                const isHighPriority = item.priority === 'HIGH' || item.priority === 'URGENT';

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left p-3 rounded-xl transition cursor-pointer flex flex-col space-y-1 relative pt-2.5 ${
                      isUnread
                        ? 'bg-blue-50/60 border border-blue-200 hover:bg-blue-50 hover:border-blue-300'
                        : 'bg-[#FDFBF9] border border-transparent hover:bg-[#F4F0E6]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-[#1E3A8A] shrink-0" />
                        )}
                        <span
                          className={`text-xs font-black truncate ${
                            isUnread ? 'text-[#111311]' : 'text-slate-700'
                          }`}
                        >
                          {item.title}
                        </span>
                      </div>

                      {isHighPriority && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200 shrink-0">
                          {item.priority}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 font-medium line-clamp-2 pl-3.5">
                      {item.body}
                    </p>

                    <div className="flex items-center justify-between pl-3.5 pt-1 text-[10px] text-slate-400 font-mono">
                      <span>
                        {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                      {item.deepLink && (
                        <span className="text-[#1E3A8A] font-bold flex items-center space-x-0.5">
                          <span>View</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-[#EAE4D5] bg-[#FDFBF9] flex items-center justify-between text-xs">
            <Link
              href="/notifications/settings"
              onClick={() => setIsOpen(false)}
              className="text-slate-600 hover:text-[#1E3A8A] font-bold flex items-center space-x-1.5 transition"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Notification Settings</span>
            </Link>
            <span className="text-[10px] text-slate-400 font-mono">Auto-sync: 60s</span>
          </div>
        </div>
      )}
    </div>
  );
};
