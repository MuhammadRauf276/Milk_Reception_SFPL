'use client';

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Loader2, ShieldAlert, Wifi, WifiOff, X } from 'lucide-react';
import { useForcedOffline, useOnlineStatus } from '@/frontend/hooks/useOnlineStatus';
import { getUnsentWorkSummary } from '@/frontend/modules/mot/offlineStore';
import {
  getSyncQueueCounts,
  listSyncQueueRecords,
  runSyncOnce,
  SYNC_QUEUE_CHANGED_EVENT,
} from './syncEngine';
import { isBackgroundKind, type QueueRecord } from './syncQueueCore';
import { DEVICE_SYNC_STATE_EVENT, getDeviceSyncState, type DeviceSyncState } from './deviceIdentity';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const REFRESH_MS = 15_000;

const KIND_LABELS: Record<string, string> = {
  MOT_COLLECTION: 'Milk collection',
  MOT_GPS_BATCH: 'GPS point',
  MOT_STOP_SKIP: 'Shop skipped',
  ZMCC_MOT_ARRIVAL: 'MC arrival',
  ZMCC_LOCAL_SUPPLIER_ARRIVAL: 'HC arrival',
};

interface SignState {
  waiting: number;
  needsAttention: number;
  sentToday: number;
  /** Old MOT queue counts (not yet moved to the new queue). */
  oldWaiting: number;
  oldNeedsAttention: number;
}

const EMPTY: SignState = { waiting: 0, needsAttention: 0, sentToday: 0, oldWaiting: 0, oldNeedsAttention: 0 };

function stateWord(r: QueueRecord): { word: string; tone: string } {
  if (r.state === 'NEEDS_ATTENTION') return { word: 'Needs office help', tone: 'text-rose-700' };
  if (r.state === 'PHOTOS_PENDING') return { word: 'Sending photos', tone: 'text-amber-700' };
  return { word: 'Waiting', tone: 'text-amber-700' };
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function subscribeDeviceState(onChange: () => void): () => void {
  window.addEventListener(DEVICE_SYNC_STATE_EVENT, onChange);
  return () => window.removeEventListener(DEVICE_SYNC_STATE_EVENT, onChange);
}

function readDeviceStateRaw(): string {
  const state = getDeviceSyncState();
  return state ? JSON.stringify(state) : '';
}

interface SyncStatusSignProps {
  className?: string;
}

/**
 * Capsule status badge:
 * - Online: Green pill with Wifi icon and "Online"
 * - Offline: Cream/amber pill with WifiOff icon and "Offline"
 * Clicking opens the sync details popover.
 */
export function SyncStatusSign({ className }: SyncStatusSignProps) {
  const [counts, setCounts] = useState<SignState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<QueueRecord[]>([]);
  const [sending, setSending] = useState(false);
  const online = useOnlineStatus();
  const [forced, setForced] = useForcedOffline();

  // Snapshot is a string so React can compare it; parsed below.
  const deviceRaw = useSyncExternalStore(subscribeDeviceState, readDeviceStateRaw, () => '');
  const device = useMemo<DeviceSyncState | null>(() => (deviceRaw ? (JSON.parse(deviceRaw) as DeviceSyncState) : null), [deviceRaw]);

  const refresh = useCallback(async () => {
    const [sync, old] = await Promise.all([getSyncQueueCounts(), getUnsentWorkSummary()]);
    setCounts({
      ...sync,
      oldWaiting: old.collections + old.gpsPoints + old.skips + old.shopRequests,
      oldNeedsAttention: old.needsAttention,
    });
  }, []);

  const refreshList = useCallback(async () => {
    const all = await listSyncQueueRecords();
    setRecords(all.filter((r) => !isBackgroundKind(r.item.kind)).sort((a, b) => a.enqueuedAt - b.enqueuedAt));
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void refresh();
    };
    run();
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, run);
    window.addEventListener('online', run);
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, run);
      window.removeEventListener('online', run);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => void refreshList();
    window.addEventListener(SYNC_QUEUE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SYNC_QUEUE_CHANGED_EVENT, onChange);
  }, [open, refreshList]);

  const help = counts.needsAttention + counts.oldNeedsAttention;
  const waiting = counts.waiting + counts.oldWaiting;

  let tone = 'border-2 border-black bg-[#eef7ee] text-emerald-950';
  let icon = <Wifi className="h-3.5 w-3.5 text-emerald-700" aria-hidden />;
  let label = 'Online';

  if (!online || forced) {
    tone = forced
      ? 'border-2 border-amber-600 bg-[#fffbeb] text-amber-950'
      : 'border-2 border-black bg-[#fffbeb] text-amber-950';
    icon = <WifiOff className="h-3.5 w-3.5 text-amber-800" aria-hidden />;
    label = waiting > 0 ? `Offline (${waiting})` : 'Offline';
  } else if (device?.state === 'BLOCKED') {
    tone = 'border-2 border-black bg-rose-50 text-rose-950';
    icon = <ShieldAlert className="h-3.5 w-3.5 text-rose-700" aria-hidden />;
    label = 'Blocked';
  } else if (help > 0) {
    tone = 'border-2 border-black bg-rose-50 text-rose-950';
    icon = <AlertCircle className="h-3.5 w-3.5 text-rose-700" aria-hidden />;
    label = `Help (${help})`;
  } else if (sending) {
    tone = 'border-2 border-black bg-[#eef7ee] text-emerald-950';
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" aria-hidden />;
    label = waiting > 0 ? `Online (${waiting})` : 'Online';
  } else if (waiting > 0) {
    tone = 'border-2 border-black bg-[#eef7ee] text-emerald-950';
    icon = <Wifi className="h-3.5 w-3.5 text-emerald-700" aria-hidden />;
    label = `Online (${waiting})`;
  }

  const sendNow = async () => {
    setSending(true);
    try {
      await runSyncOnce();
    } finally {
      setSending(false);
      void refresh();
      void refreshList();
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) void refreshList();
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Connection and sync status: ${label}`}
          className={cn(
            'inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-xs transition hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
            tone,
            className
          )}
        >
          {icon}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,360px)] p-3 text-sm shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
          <p className="text-base font-semibold">Saved work on this device</p>
          <button
            type="button"
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="my-2.5 flex items-center justify-between rounded-lg border border-border/80 bg-muted/40 p-2.5">
          <div className="space-y-0.5 pr-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {forced ? (
                <WifiOff className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              )}
              <span>Offline Mode</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {forced ? 'Work is queued locally on device' : 'Connected to server in real time'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={forced}
            onClick={() => {
              const next = !forced;
              setForced(next);
              if (!next) {
                void sendNow();
              }
            }}
            aria-label="Toggle offline mode"
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              forced ? 'bg-amber-600' : 'bg-slate-300'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out',
                forced ? 'translate-x-5' : 'translate-x-0'
              )}
            />
          </button>
        </div>

        <div className="space-y-1 py-1 text-xs text-muted-foreground">
          <p>
            Status:{' '}
            <span className="font-medium text-foreground">
              {forced
                ? 'Offline (Manual Mode)'
                : online
                ? 'Connected to network'
                : 'Offline (No network connection)'}
            </span>
          </p>
          <p>Confirmed today: <span className="font-medium text-foreground">{counts.sentToday}</span></p>
          {device?.state === 'BLOCKED' ? (
            <p className="font-medium text-rose-700">{device.message || 'This device is blocked. Contact office.'}</p>
          ) : null}
          {counts.oldWaiting + counts.oldNeedsAttention > 0 ? (
            <p>
              Old queue: {counts.oldWaiting} waiting{counts.oldNeedsAttention > 0 ? `, ${counts.oldNeedsAttention} need office help` : ''}
            </p>
          ) : null}
        </div>
        {records.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">All items sent. No items waiting.</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto pt-2">
            {records.map((r) => {
              const st = stateWord(r);
              return (
                <li key={r.clientUuid} className="flex min-h-[36px] items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0">
                  <span className="truncate">
                    <span className="block font-medium truncate">{KIND_LABELS[r.item.kind] ?? r.item.kind}</span>
                    <span className="block text-[11px] text-muted-foreground">{timeLabel(r.item.capturedAt)}</span>
                  </span>
                  <span className={`shrink-0 text-right font-semibold ${st.tone}`}>{st.word}</span>
                </li>
              );
            })}
          </ul>
        )}
        {online && (waiting > 0 || help > 0) ? (
          <button
            type="button"
            className="mt-3 h-10 w-full rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
            disabled={sending}
            onClick={() => void sendNow()}
          >
            {sending ? 'Sending…' : 'Send now'}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
