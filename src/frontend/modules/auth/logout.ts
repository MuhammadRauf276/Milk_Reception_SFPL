import { clearMotSessionCache, getUnsentWorkSummary, type UnsentWorkSummary } from '@/frontend/modules/mot/offlineStore';

/** Tells the UI whether anything saved on this phone is still waiting to be sent. */
export async function getLogoutSafety(options?: { isMot?: boolean }): Promise<UnsentWorkSummary> {
  return getUnsentWorkSummary(options);
}

/**
 * Gracefully logs out the user:
 * 1. Unsubscribes browser push subscription from PushManager for this device.
 * 2. Calls /api/auth/logout with endpoint for backend DB revocation.
 * 3. Always clears the journey cache and offline preparation (so the next user does not see them). Unsent work (collections, GPS, skips, shop requests, drafts)
 *    is NEVER deleted here; it stays on the phone until the server confirms it.
 * 4. Redirects to /login.
 *
 * `keepUnsentWork` is accepted for clarity at call sites. Unsent work is always kept.
 */
export async function logoutUser(_options?: { keepUnsentWork?: boolean }): Promise<void> {
  let endpoint: string | null = null;

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

  // Trigger custom event so any in-app notification listeners or state stop immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('milk-user-logged-out'));
    // Full reload (not client routing) so no signed-in state survives; replace keeps it out of history.
    window.location.replace('/login');
  }
}
