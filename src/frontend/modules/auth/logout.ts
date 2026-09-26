import { clearMotOfflineWorkspace } from '@/frontend/modules/mot/offlineStore';

/**
 * Gracefully logs out the user:
 * 1. Unsubscribes browser push subscription from PushManager for this device.
 * 2. Calls /api/auth/logout with endpoint for backend DB revocation.
 * 3. Clears offline workspace caches.
 * 4. Redirects to /login.
 */
export async function logoutUser(): Promise<void> {
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
    await clearMotOfflineWorkspace();
  } catch (_e) {
    // Ignore cache clearing errors
  }

  // Trigger custom event so any in-app notification listeners or state stop immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('milk-user-logged-out'));
    window.location.href = '/login';
  }
}
