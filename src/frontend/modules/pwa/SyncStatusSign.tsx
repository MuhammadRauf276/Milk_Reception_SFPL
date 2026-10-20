'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { getUnsentWorkSummary } from '@/frontend/modules/mot/offlineStore';
import {
  getSyncQueueCounts,
  listSyncQueueRecords,
  runSyncOnce,
  SYNC_QUEUE_CHANGED_EVENT,
} from './syncEngine';
import { isBackgroundKind, type QueueRecord } from './syncQueueCore';

const REFRESH_MS = 15_000;

const KIND_LABELS: Record<string, string> = {
  MOT_COLLECTION: 'Milk collection',
  MOT_GPS_BATCH: 'GPS point',
  MOT_STOP_SKIP: 'Shop skipped',
  ZMCC_MOT_ARRIVAL: 'MOT arrival',
  ZMCC_LOCAL_SUPPLIER_ARRIVAL: 'Local supplier arrival',
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
  if (r.state === 'NEEDS_ATTENTION') return { word: 'Needs office help', tone: 'text-red-700' };
  if (r.state === 'PHOTOS_PENDING') return { word: 'Sending photos', tone: 'text-amber-700' };
  return { word: 'Waiting', tone: 'text-amber-700' };
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Always-visible sign: green "All sent" / amber "N waiting" / red "N need help from office". */
export function SyncStatusSign() {
  const [counts, setCounts] = useState<SignState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<QueueRecord[]>([]);
  const [sending, setSending] = useState(false);

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

  let tone = 'border-emerald-300 bg-emerald-50 text-emerald-900';
  let icon = <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />;
  let label = 'All sent';
  if (help > 0) {
    tone = 'border-red-300 bg-red-50 text-red-900';
    icon = <AlertCircle className="h-5 w-5 text-red-600" aria-hidden />;
    label = `${help} need help from office`;
  } else if (waiting > 0) {
    tone = 'border-amber-300 bg-amber-50 text-amber-900';
    icon = <RefreshCw className={`h-5 w-5 text-amber-600 ${sending ? 'animate-spin' : ''}`} aria-hidden />;
    label = `${waiting} waiting`;
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
    <div className="pointer-events-none fixed bottom-3 left-3 z-banner flex flex-col items-start gap-2 sm:bottom-4 sm:left-4">
      {open ? (
        <div
          role="dialog"
          aria-label="Saved work on this phone"
          className="pointer-events-auto w-[min(92vw,360px)] rounded-lg border bg-background p-3 text-sm shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-base font-semibold">Saved work on this phone</p>
            <button
              type="button"
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <p className="mb-2 text-muted-foreground">Sent today: {counts.sentToday}</p>
          {counts.oldWaiting + counts.oldNeedsAttention > 0 ? (
            <p className="mb-2 text-muted-foreground">
              MOT work in the old list: {counts.oldWaiting} waiting{counts.oldNeedsAttention > 0 ? `, ${counts.oldNeedsAttention} need help` : ''}
            </p>
          ) : null}
          {records.length === 0 ? (
            <p className="py-2">Nothing waiting in the new list.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {records.map((r) => {
                const st = stateWord(r);
                return (
                  <li key={r.clientUuid} className="flex min-h-[44px] items-center justify-between gap-2 border-b py-1 last:border-b-0">
                    <span>
                      <span className="block font-medium">{KIND_LABELS[r.item.kind] ?? r.item.kind}</span>
                      <span className="block text-xs text-muted-foreground">{timeLabel(r.item.capturedAt)}</span>
                    </span>
                    <span className={`text-right text-xs font-semibold ${st.tone}`}>{st.word}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="mt-3 h-12 min-h-[44px] w-full rounded-md bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
            disabled={sending}
            onClick={() => void sendNow()}
          >
            {sending ? 'Sending...' : 'Send now'}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Sync status: ${label}`}
        className={`pointer-events-auto flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-full border px-3 text-sm font-semibold shadow-md ${tone}`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void refreshList();
        }}
      >
        {icon}
        <span>{label}</span>
      </button>
    </div>
  );
}
