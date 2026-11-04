// Drafts for forms that keep what was typed on this device only. Pure rules; the hook does the I/O.
import type { DraftStorage } from './draftSync';

const PREFIX = 'milk-form-draft:v1';
const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

export const localFormDraftKey = (userId: string, formKey: string) => `${PREFIX}:${userId}:${formKey}`;

/**
 * Only the fields the person changed. A default such as the current time is left out, so reopening a form tomorrow
 * cannot quietly bring back yesterday's time.
 */
export function changedFields(values: Record<string, string>, initial: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([field, value]) => value !== initial[field]));
}

export function readLocalFormDraft(
  storage: DraftStorage | null,
  key: string,
  now: Date = new Date()
): Record<string, string> | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: string; fields?: Record<string, string> };
    if (!parsed.fields || !parsed.savedAt) return null;
    if (now.getTime() - new Date(parsed.savedAt).getTime() > EXPIRY_MS) {
      storage?.removeItem(key);
      return null;
    }
    return parsed.fields;
  } catch {
    return null;
  }
}

export function writeLocalFormDraft(
  storage: DraftStorage | null,
  key: string,
  fields: Record<string, string>,
  now: Date = new Date()
): void {
  try {
    if (Object.keys(fields).length === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify({ savedAt: now.toISOString(), fields }));
  } catch {
    // A full or blocked store only means this draft is not kept.
  }
}
