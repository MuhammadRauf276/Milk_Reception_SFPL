// Local-first drafts. The phone keeps the real draft (works with no signal); the server keeps a copy for the
// user's other devices. These are the pure rules; the hook in hooks/useServerDraft.ts does the I/O.
import { DRAFT_EXPIRY_DAYS } from '@/backend/services/formDraftService';

/** Same shape the server keeps: typed values and photo ids only, never a decision. */
export interface DraftContent {
  values: Record<string, string>;
  photos: Record<string, string>;
  remarks: string;
}

export interface LocalDraftRecord {
  content: DraftContent;
  /** Server version this copy was last in sync with (null: the server has not seen it). */
  baseVersion: number | null;
  /** True while there are edits the server has not received. */
  dirty: boolean;
  updatedAt: string;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ServerDraftView {
  version: number;
  content: DraftContent;
}

const PREFIX = 'milk-draft:v1';
export const LAST_USER_KEY = `${PREFIX}:last-user`;
const DAY_MS = 24 * 60 * 60 * 1000;

export const emptyDraftContent = (): DraftContent => ({ values: {}, photos: {}, remarks: '' });

export function hasDraftContent(c: DraftContent): boolean {
  return (
    c.remarks.trim() !== '' ||
    Object.values(c.values).some((v) => v.trim() !== '') ||
    Object.values(c.photos).some((v) => v.trim() !== '')
  );
}

/** One key per user, so a shared phone never shows another user's draft. */
export function localDraftKey(userId: string, formType: string, scopeId: string, portionKey: string): string {
  return `${PREFIX}:${userId}:${formType}:${scopeId}:${portionKey}`;
}

export function readLocalDraft(storage: DraftStorage | null, key: string, now: Date = new Date()): LocalDraftRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw) as LocalDraftRecord;
    if (!rec || typeof rec !== 'object' || !rec.content || typeof rec.content !== 'object') return null;
    const age = now.getTime() - new Date(rec.updatedAt).getTime();
    if (!Number.isFinite(age) || age > DRAFT_EXPIRY_DAYS * DAY_MS) {
      storage.removeItem(key);
      return null;
    }
    return {
      content: {
        values: rec.content.values ?? {},
        photos: rec.content.photos ?? {},
        remarks: typeof rec.content.remarks === 'string' ? rec.content.remarks : '',
      },
      baseVersion: typeof rec.baseVersion === 'number' ? rec.baseVersion : null,
      dirty: Boolean(rec.dirty),
      updatedAt: rec.updatedAt,
    };
  } catch {
    return null;
  }
}

export function writeLocalDraft(storage: DraftStorage | null, key: string, rec: LocalDraftRecord): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

export function removeLocalDraft(storage: DraftStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // storage blocked: nothing to remove
  }
}

export type OpenApply = 'server-wins' | 'fill-empty' | null;

export interface OpenDecision {
  /** How to put the server's values into the form: overwrite, or fill only empty fields. */
  apply: OpenApply;
  /** Send the phone's copy to the server. */
  push: boolean;
  /** Version to use as the base of the next save. */
  baseVersion: number | null;
  /** The server had newer changes but the phone had unsent edits, which were kept. */
  keptPhone: boolean;
}

/**
 * What to do when the form opens and the server answers.
 * The phone is already showing its own copy. The phone wins over the server for anything it typed; the server's
 * values only fill fields that are still empty. If the phone has no unsent edits, a newer server copy wins.
 */
export function decideOnOpen(local: LocalDraftRecord | null, server: ServerDraftView | null): OpenDecision {
  const localHas = local !== null && hasDraftContent(local.content);
  if (!server) {
    return { apply: null, push: localHas && (local?.dirty ?? false), baseVersion: null, keptPhone: false };
  }
  if (!localHas) {
    return { apply: 'fill-empty', push: false, baseVersion: server.version, keptPhone: false };
  }
  if (local!.baseVersion === server.version) {
    return { apply: null, push: local!.dirty, baseVersion: server.version, keptPhone: false };
  }
  // The server has a different (newer) copy than the one this phone last synced with.
  if (!local!.dirty) return { apply: 'server-wins', push: false, baseVersion: server.version, keptPhone: false };
  return { apply: 'fill-empty', push: true, baseVersion: server.version, keptPhone: true };
}

/** A returning tab re-checks the server at most this often. */
export const RESYNC_MIN_INTERVAL_MS = 10_000;

/** Whether a tab/window coming back to the front should ask the server again: form open with a target, online, and not within the throttle. */
export function shouldResync(args: { hasTarget: boolean; online: boolean; lastSyncAt: number | null; now: number; minIntervalMs?: number }): boolean {
  if (!args.hasTarget || !args.online) return false;
  if (args.lastSyncAt === null) return true;
  const elapsed = args.now - args.lastSyncAt;
  return elapsed < 0 || elapsed >= (args.minIntervalMs ?? RESYNC_MIN_INTERVAL_MS);
}
