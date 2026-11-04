'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/frontend/context/ToastContext';

/** Same shape the server keeps: typed values and photo ids only, never a decision. */
export interface ServerDraftContent {
  values: Record<string, string>;
  photos: Record<string, string>;
  remarks: string;
}

export type DraftFormType = 'PLANT_QA' | 'ZMCC_LAB_MC' | 'ZMCC_LAB_HC' | 'DISPATCH' | 'ZMCC_DISPATCH' | 'CONTRACTOR_DISPATCH' | 'MOT_SHOP';

/** Typing pauses this long before the draft is saved. */
export const DRAFT_AUTOSAVE_DELAY_MS = 1500;

interface DraftView {
  version: number;
  content: ServerDraftContent;
}

interface UseServerDraftArgs {
  formType: DraftFormType;
  scopeId: string | null;
  /** Portion row id. Null while no portion is open. */
  portionKey: string | null;
  /** Current form content. */
  content: ServerDraftContent;
  /** Called with the saved draft when the form opens, or with the newer draft after another device saved. */
  onRemote: (content: ServerDraftContent, reason: 'load' | 'stale') => void;
}

const hasAnything = (c: ServerDraftContent) =>
  c.remarks.trim() !== '' ||
  Object.values(c.values).some((v) => v.trim() !== '') ||
  Object.values(c.photos).some((v) => v.trim() !== '');

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Keeps a private, per-user server draft of the open portion so the same login continues on any device.
 * The draft is never a result: the normal submit still decides everything. Failures here are silent,
 * the typed values stay in the form either way.
 */
export function useServerDraft({ formType, scopeId, portionKey, content, onRemote }: UseServerDraftArgs): { flush: () => void } {
  const toast = useToast();
  const target = scopeId && portionKey ? { formType, scopeId, portionKey } : null;
  const targetKey = target ? `${formType}:${scopeId}:${portionKey}` : null;

  const versionRef = useRef<number | null>(null);
  const readyKey = useRef<string | null>(null);
  const closedKey = useRef<string | null>(null);
  const lastSent = useRef<string>('');
  const latest = useRef(content);
  const onRemoteRef = useRef(onRemote);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRef = useRef(toast);

  useEffect(() => {
    latest.current = content;
    onRemoteRef.current = onRemote;
    toastRef.current = toast;
  });

  const save = (keepalive = false) => {
    if (!target || readyKey.current !== targetKey || closedKey.current === targetKey) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const body = latest.current;
    const json = JSON.stringify(body);
    if (json === lastSent.current) return;
    if (versionRef.current === null && !hasAnything(body)) return;
    const savingFor = targetKey;
    void fetch('/api/drafts', {
      method: 'PUT',
      credentials: 'same-origin',
      keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, baseVersion: versionRef.current, content: body }),
    })
      .then(async (res) => {
        if (savingFor !== targetKey) return;
        const data = (await res.json().catch(() => ({}))) as { draft?: DraftView; error?: string; code?: string; current?: DraftView };
        if (res.ok && data.draft) {
          versionRef.current = data.draft.version;
          lastSent.current = json;
        } else if (res.status === 409 && data.code === 'DRAFT_STALE' && data.current) {
          versionRef.current = data.current.version;
          lastSent.current = JSON.stringify(data.current.content);
          toastRef.current.showWarning(data.error || 'This draft was changed on another device. It has been reloaded.', 'Draft Updated');
          onRemoteRef.current(data.current.content, 'stale');
        } else if (res.status === 409) {
          closedKey.current = savingFor;
          toastRef.current.showInfo(data.error || 'This portion is already decided. Your draft is kept.', 'Draft Not Saved');
        }
      })
      .catch(() => undefined);
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  // Open: load my draft and tell me who else started this portion.
  useEffect(() => {
    versionRef.current = null;
    readyKey.current = null;
    closedKey.current = null;
    lastSent.current = '';
    if (!target || !targetKey) return;
    let cancelled = false;
    const qs = new URLSearchParams({ formType: target.formType, scopeId: target.scopeId, portionKey: target.portionKey });
    fetch(`/api/drafts?${qs.toString()}`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok || cancelled) return null;
        return (await res.json()) as { draft: DraftView | null; colleagues: Array<{ name: string; startedAt: string }>; closedMessage: string | null };
      })
      .then((data) => {
        if (!data || cancelled) return;
        if (data.draft) {
          versionRef.current = data.draft.version;
          lastSent.current = JSON.stringify(data.draft.content);
          onRemoteRef.current(data.draft.content, 'load');
        }
        if (data.closedMessage) closedKey.current = targetKey;
        for (const c of data.colleagues.slice(0, 2)) {
          toastRef.current.showInfo(`${c.name} started this portion at ${timeLabel(c.startedAt)}.`, 'Draft In Progress');
        }
        readyKey.current = targetKey;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The target is fully described by targetKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Typing: save after a pause.
  const contentJson = JSON.stringify(content);
  useEffect(() => {
    if (!targetKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), DRAFT_AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [contentJson, targetKey]);

  // Leaving the page or hiding the tab: save now.
  useEffect(() => {
    const leave = () => saveRef.current(true);
    const hidden = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hidden);
      leave();
    };
  }, []);

  return { flush: () => saveRef.current() };
}
