'use client';

import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface Props {
  isOnline: boolean;
  unsyncedCount: number;
  lastSyncTime: string | null;
  syncFeedback: string | null;
  syncing: boolean;
  onSync: () => void;
}

export function SyncBar({ isOnline, unsyncedCount, lastSyncTime, syncFeedback, syncing, onSync }: Props) {
  return (
          <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-card rounded-xl border border-border shadow-2xs">
            <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center space-x-1.5 shrink-0 ${
                  isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                  </>
                )}
              </span>

              <span className="text-xs text-slate-600 font-semibold truncate">
                {unsyncedCount > 0 ? (
                  <span className="text-primary font-semibold">{unsyncedCount} pending sync</span>
                ) : (
                  'All synced'
                )}
              </span>

              {lastSyncTime && (
                <span className="hidden md:inline text-[11px] text-slate-400 tabular-nums">
                  Synced {lastSyncTime}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              {syncFeedback && (
                <span className="hidden sm:inline text-xs font-semibold text-emerald-700">{syncFeedback}</span>
              )}
              <button
                type="button"
                onClick={onSync}
                disabled={syncing || !isOnline}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs flex items-center space-x-1.5 focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <span>{syncing ? 'Syncing…' : 'Sync Now'}</span>
              </button>
            </div>
          </div>
  );
}
