'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import {
  LAST_USER_KEY,
  decideOnOpen,
  hasDraftContent,
  localDraftKey,
  readLocalDraft,
  removeLocalDraft,
  shouldResync,
  writeLocalDraft,
  type DraftContent,
  type DraftStorage,
  type ServerDraftView,
} from '@/frontend/lib/draftSync';

/** Same shape the server keeps: typed values and photo ids only, never a decision. */
export type ServerDraftContent = DraftContent;

export type DraftFormType = 'PLANT_QA' | 'ZMCC_LAB_MC' | 'ZMCC_LAB_HC' | 'DISPATCH' | 'ZMCC_DISPATCH' | 'CONTRACTOR_DISPATCH' | 'MOT_SHOP';

/** Typing pauses this long before the draft is sent to the server. */
export const DRAFT_AUTOSAVE_DELAY_MS = 1500;
/** A failed send is tried again after this long while the phone still says it is online. */
export const DRAFT_RETRY_MS = 15_000;

interface UseServerDraftArgs {
  formType: DraftFormType;
  scopeId: string | null;
  /** Portion row id. Null while no portion is open. */
  portionKey: string | null;
  /** Current form content. */
  content: ServerDraftContent;
  /**
   * Called with a saved draft. 'load': the form is opening, fill only fields that are still empty.
   * 'stale': a newer copy from another device, its values win (nothing typed here may be blanked).
   */
  onRemote: (content: ServerDraftContent, reason: 'load' | 'stale') => void;
}

function browserStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** User id for the local key: the signed-in user, or the last one seen (so the form still works offline after a reload). */
function rememberedUser(storage: DraftStorage | null, current: string | null): string | null {
  try {
    if (current) {
      storage?.setItem(LAST_USER_KEY, current);
      return current;
    }
    return storage?.getItem(LAST_USER_KEY) ?? null;
  } catch {
    return current;
  }
}

/** Removes the phone's copy of a draft (after the portion or form was submitted). */
export function discardLocalDraft(userId: string | null, formType: DraftFormType, scopeId: string | null, portionKey: string | null): void {
  if (!userId || !scopeId || !portionKey) return;
  removeLocalDraft(browserStorage(), localDraftKey(userId, formType, scopeId, portionKey));
}

/** True when this phone already holds a local-first draft for the form (used to skip older draft stores). */
export function hasLocalDraft(userId: string | null, formType: DraftFormType, scopeId: string, portionKey: string): boolean {
  if (!userId) return false;
  const rec = readLocalDraft(browserStorage(), localDraftKey(userId, formType, scopeId, portionKey));
  return rec !== null && hasDraftContent(rec.content);
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Local-first private draft of the open portion. Every change is written on the phone at once (no signal needed);
 * when online it is also sent to the server so the same login continues on another device. When the form opens
 * the phone's copy shows first and is then reconciled with the server (see decideOnOpen). The draft is never a
 * result: the normal submit still decides everything. Failures here are silent, typed values stay in the form.
 */
export function useServerDraft({ formType, scopeId, portionKey, content, onRemote }: UseServerDraftArgs): {
  flush: () => void;
  discard: () => void;
} {
  const toast = useToast();
  const { currentUser } = useCurrentUser();
  const target = scopeId && portionKey ? { formType, scopeId, portionKey } : null;
  const targetKey = target ? `${formType}:${scopeId}:${portionKey}` : null;

  const userId = rememberedUser(browserStorage(), currentUser?.id ? String(currentUser.id) : null);
  const storageKey = target && userId ? localDraftKey(userId, formType, target.scopeId, target.portionKey) : null;

  const versionRef = useRef<number | null>(null);
  const syncedKey = useRef<string | null>(null);
  const closedKey = useRef<string | null>(null);
  const discardedKey = useRef<string | null>(null);
  const lastSent = useRef<string>('');
  const sending = useRef(false);
  const latest = useRef(content);
  const onRemoteRef = useRef(onRemote);
  const toastRef = useRef(toast);
  const serverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveRef = useRef<(keepalive?: boolean, retried?: boolean) => void>(() => undefined);
  const syncRef = useRef<() => void>(() => undefined);
  const targetKeyRef = useRef<string | null>(targetKey);
  const colleaguesShown = useRef<Set<string>>(new Set());
  const lastSyncAt = useRef<number | null>(null);

  useEffect(() => {
    latest.current = content;
    onRemoteRef.current = onRemote;
    toastRef.current = toast;
  });

  const scheduleServer = () => {
    if (serverTimer.current) clearTimeout(serverTimer.current);
    serverTimer.current = setTimeout(() => saveRef.current(), DRAFT_AUTOSAVE_DELAY_MS);
  };
  const scheduleRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) saveRef.current();
    }, DRAFT_RETRY_MS);
  };

  const writeLocal = () => {
    if (!storageKey || discardedKey.current === targetKey) return;
    const storage = browserStorage();
    const body = latest.current;
    const existing = readLocalDraft(storage, storageKey);
    // An empty form never replaces a draft that has values (same rule as the server).
    if (!hasDraftContent(body) && existing && hasDraftContent(existing.content)) return;
    if (!hasDraftContent(body) && !existing) return;
    writeLocalDraft(storage, storageKey, {
      content: body,
      baseVersion: versionRef.current,
      dirty: JSON.stringify(body) !== lastSent.current,
      updatedAt: new Date().toISOString(),
    });
  };

  const save = (keepalive = false, retried = false) => {
    if (!target || syncedKey.current !== targetKey || closedKey.current === targetKey) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (sending.current && !keepalive) return;
    const body = latest.current;
    const json = JSON.stringify(body);
    if (json === lastSent.current) return;
    if (versionRef.current === null && !hasDraftContent(body)) return;
    const savingFor = targetKey;
    sending.current = true;
    void fetch('/api/drafts', {
      method: 'PUT',
      credentials: 'same-origin',
      keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, baseVersion: versionRef.current, content: body }),
    })
      .then(async (res) => {
        sending.current = false;
        if (savingFor !== targetKey) return;
        const data = (await res.json().catch(() => ({}))) as { draft?: ServerDraftView; error?: string; code?: string; current?: ServerDraftView };
        if (res.ok && data.draft) {
          versionRef.current = data.draft.version;
          lastSent.current = json;
          writeLocal();
          // Typing went on while this was in flight: send that too.
          if (JSON.stringify(latest.current) !== json) scheduleServer();
        } else if (res.status === 409 && data.code === 'DRAFT_STALE' && data.current) {
          // The phone wins: take the server's version number, fill only empty fields from its values, send again.
          versionRef.current = data.current.version;
          lastSent.current = '';
          onRemoteRef.current(data.current.content, 'load');
          if (!retried) {
            toastRef.current.showInfo('This draft was also changed on another device. What you typed here was kept.', 'Draft Updated');
            setTimeout(() => saveRef.current(false, true), 0);
          }
        } else if (res.status === 409) {
          closedKey.current = savingFor;
          toastRef.current.showInfo(data.error || 'This portion is already decided. Your draft is kept.', 'Draft Not Saved');
        } else if (res.status >= 500 || res.status === 0) {
          scheduleRetry();
        }
      })
      .catch(() => {
        sending.current = false;
        scheduleRetry();
      });
  };
  useEffect(() => {
    saveRef.current = save;
  });

  /** Asks the server for its copy and reconciles it with the phone's. Runs on open and again when the signal returns. */
  const syncWithServer = () => {
    if (!target || !targetKey) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    lastSyncAt.current = Date.now();
    const forKey = targetKey;
    const qs = new URLSearchParams({ formType: target.formType, scopeId: target.scopeId, portionKey: target.portionKey });
    fetch(`/api/drafts?${qs.toString()}`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { draft: ServerDraftView | null; colleagues: Array<{ name: string; startedAt: string }>; closedMessage: string | null };
      })
      .then((data) => {
        if (!data || forKey !== targetKeyRef.current) return;
        const local = storageKey ? readLocalDraft(browserStorage(), storageKey) : null;
        const decision = decideOnOpen(local, data.draft);
        versionRef.current = decision.baseVersion;
        // In sync with the server unless the phone has edits to send.
        lastSent.current = data.draft && !decision.push ? JSON.stringify(data.draft.content) : '';
        if (data.draft && decision.apply) onRemoteRef.current(data.draft.content, decision.apply === 'server-wins' ? 'stale' : 'load');
        if (decision.keptPhone) toastRef.current.showInfo('Kept what you typed on this phone.', 'Draft Updated');
        if (data.closedMessage) closedKey.current = forKey;
        if (!colleaguesShown.current.has(forKey)) {
          colleaguesShown.current.add(forKey);
          for (const c of data.colleagues.slice(0, 2)) {
            toastRef.current.showInfo(`${c.name} started this portion at ${timeLabel(c.startedAt)}.`, 'Draft In Progress');
          }
        }
        syncedKey.current = forKey;
        if (decision.push) saveRef.current();
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    syncRef.current = syncWithServer;
    targetKeyRef.current = targetKey;
  });

  // Open: show the phone's copy at once, then reconcile with the server.
  useEffect(() => {
    versionRef.current = null;
    syncedKey.current = null;
    closedKey.current = null;
    discardedKey.current = null;
    lastSent.current = '';
    sending.current = false;
    if (!target || !targetKey) return;
    const local = storageKey ? readLocalDraft(browserStorage(), storageKey) : null;
    if (local && hasDraftContent(local.content)) {
      versionRef.current = local.baseVersion;
      lastSent.current = local.dirty ? '' : JSON.stringify(local.content);
      onRemoteRef.current(local.content, 'load');
    }
    syncRef.current();
    // The target is fully described by targetKey and storageKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, storageKey]);

  // Typing: write on the phone now, send to the server after a pause.
  const contentJson = JSON.stringify(content);
  useEffect(() => {
    if (!targetKey) return;
    // The phone's copy is written at once on every change (small text, no network); the server copy waits for a pause.
    writeLocal();
    scheduleServer();
    return () => {
      if (serverTimer.current) clearTimeout(serverTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentJson, targetKey]);

  // Signal back, tab hidden or page left: write now and send what is waiting.
  useEffect(() => {
    const leave = () => {
      writeLocal();
      saveRef.current(true);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    const online = () => {
      if (syncedKey.current === targetKeyRef.current) saveRef.current();
      else syncRef.current();
    };
    // Tab or window back in front: ask the server again (same reconcile path), at most once per 10 s.
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      const ok = shouldResync({
        hasTarget: targetKeyRef.current !== null,
        online: typeof navigator === 'undefined' || navigator.onLine !== false,
        lastSyncAt: lastSyncAt.current,
        now: Date.now(),
      });
      if (ok) syncRef.current();
    };
    const visible = () => {
      hidden();
      resume();
    };
    window.addEventListener('focus', resume);
    window.addEventListener('pagehide', leave);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    flush: () => {
      writeLocal();
      saveRef.current();
    },
    /** Call after the portion or form was submitted: stops saving and removes the phone's copy. */
    discard: () => {
      closedKey.current = targetKey;
      discardedKey.current = targetKey;
      if (serverTimer.current) clearTimeout(serverTimer.current);
      if (storageKey) removeLocalDraft(browserStorage(), storageKey);
    },
  };
}
