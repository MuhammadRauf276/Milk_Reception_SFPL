import { clearMotSessionCache, getUnsentWorkSummary, type UnsentWorkSummary } from '@/frontend/modules/mot/offlineStore';
import { getSyncQueueCounts } from '@/frontend/modules/pwa/syncEngine';
import { setActiveOwnerUserId } from '@/frontend/modules/pwa/deviceIdentity';
import { logDeviceEvent } from '@/frontend/modules/pwa/diary';

/** Unsent work from BOTH queues: the old MOT queues and the new offline sync queue. */
export interface LogoutSafety extends UnsentWorkSummary {
  /** New sync queue items not yet confirmed by the server (included in total). */
  syncWaiting: number;
  /** New sync queue items the server refused (included in needsAttention). Kept, never deleted. */
  syncNeedsAttention: number;
}

/** Pure: adds the new sync queue counts to the MOT summary. */
export function combineUnsentWork(mot: UnsentWorkSummary, sync: { waiting: number; needsAttention: number }): LogoutSafety {
  const syncWaiting = Math.max(0, sync.waiting | 0);
  const syncNeedsAttention = Math.max(0, sync.needsAttention | 0);
  return {
    ...mot,
    syncWaiting,
    syncNeedsAttention,
    total: mot.total + syncWaiting,
    needsAttention: mot.needsAttention + syncNeedsAttention,
  };
}

/** Pure guard: true when the user should see the "work not sent yet" dialog before logout. */
export function hasUnsentWork(s: Pick<UnsentWorkSummary, 'total' | 'needsAttention'>): boolean {
  return s.total > 0 || s.needsAttention > 0;
}

/** Tells the UI whether anything saved on this phone is still waiting to be sent (both queues). */
export async function getLogoutSafety(options?: { isMot?: boolean }): Promise<LogoutSafety> {
  const [mot, sync] = await Promise.all([getUnsentWorkSummary(options), getSyncQueueCounts()]);
  return combineUnsentWork(mot, sync);
}

/**
 * Gracefully logs out the user:
 * 1. Unsubscribes browser push subscription from PushManager for this device.
 * 2. Calls /api/auth/logout with endpoint for backend DB revocation.
 * 3. Always clears the journey cache and offline preparation (so the next user does not see them). Unsent work (collections, GPS, skips, shop requests, drafts,
 *    and everything in the new 'milk_sync' queue incl. photos) is NEVER deleted here; it stays on the phone until the server confirms it.
 * 4. Redirects to /login.
 *
 * `keepUnsentWork` is accepted for clarity at call sites. Unsent work is always kept.
 */
export async function logoutUser(_options?: { keepUnsentWork?: boolean }): Promise<void> {
  let endpoint: string | null = null;

  // Diary entry is queued (kept on the phone) like any other item; it never blocks logout.
  await logDeviceEvent('LOGOUT', { keptUnsentWork: _options?.keepUnsentWork === true }).catch(() => null);

  try {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (reg && 'pushManager' in reg) {
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        if (sub) {
          endpoint = sub.endpoint;
          await sub.unsubscribe().catch(() => null);
        }
      }
    }
  } catch (_e) {
    // Ignore service worker access errors
  }

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  } catch (_e) {
    // Ignore network error on logout request
  }

  try {
    await clearMotSessionCache();
  } catch (_e) {
    // Ignore cache clearing errors
  }
  // The new sync queue ('milk_sync') and photos are never cleared here; only the "who is signed in" marker.
  setActiveOwnerUserId(null);

  // Trigger custom event so any in-app notification listeners or state stop immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('milk-user-logged-out'));
    // Full reload (not client routing) so no signed-in state survives; replace keeps it out of history.
    window.location.replace('/login');
  }
}
