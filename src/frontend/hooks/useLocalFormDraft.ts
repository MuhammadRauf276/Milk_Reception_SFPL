'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '@/frontend/context/ToastContext';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import type { DraftStorage } from '@/frontend/lib/draftSync';
import { changedFields, localFormDraftKey, readLocalFormDraft, writeLocalFormDraft } from '@/frontend/lib/localFormDraft';

function browserStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Keeps what was typed in a form on this device until it is submitted, through a lost connection, a closed tab or a
 * refresh. `formKey` names one record (null while none is open).
 */
export function useLocalFormDraft({
  formKey,
  values,
  onRestore,
}: {
  formKey: string | null;
  values: Record<string, string>;
  onRestore: (fields: Record<string, string>) => void;
}): { clear: () => void } {
  const toast = useToast();
  const { currentUser } = useCurrentUser();
  const userId = currentUser?.id ? String(currentUser.id) : null;
  const storageKey = formKey && userId ? localFormDraftKey(userId, formKey) : null;

  const initial = useRef<Record<string, string>>({});
  const openedKey = useRef<string | null>(null);
  const clearedKey = useRef<string | null>(null);
  const latest = useRef({ values, onRestore, toast });
  useEffect(() => {
    latest.current = { values, onRestore, toast };
  });

  useEffect(() => {
    openedKey.current = storageKey;
    clearedKey.current = null;
    if (!storageKey) return;
    initial.current = latest.current.values;
    const saved = readLocalFormDraft(browserStorage(), storageKey);
    if (saved) {
      latest.current.onRestore(saved);
      latest.current.toast.showToast('INFO', 'Your saved work was restored.', undefined, 3000);
    }
  }, [storageKey]);

  const valuesJson = JSON.stringify(values);
  useEffect(() => {
    if (!storageKey || openedKey.current !== storageKey || clearedKey.current === storageKey) return;
    writeLocalFormDraft(browserStorage(), storageKey, changedFields(latest.current.values, initial.current));
  }, [valuesJson, storageKey]);

  /** Call after the form was submitted. */
  const clear = useCallback(() => {
    const key = openedKey.current;
    if (!key) return;
    clearedKey.current = key;
    writeLocalFormDraft(browserStorage(), key, {});
  }, []);
  return { clear };
}
