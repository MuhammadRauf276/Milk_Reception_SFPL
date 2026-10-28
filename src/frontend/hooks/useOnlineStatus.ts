'use client';

import { useSyncExternalStore } from 'react';

const FORCE_OFFLINE_KEY = 'milk_force_offline';
export const STATUS_CHANGE_EVENT = 'milk-online-status-changed';

export function isForcedOffline(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FORCE_OFFLINE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setForcedOffline(forced: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (forced) {
      localStorage.setItem(FORCE_OFFLINE_KEY, 'true');
    } else {
      localStorage.removeItem(FORCE_OFFLINE_KEY);
    }
  } catch {}
  window.dispatchEvent(new CustomEvent(STATUS_CHANGE_EVENT));
  window.dispatchEvent(new Event(forced ? 'offline' : 'online'));
}

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  window.addEventListener(STATUS_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
    window.removeEventListener(STATUS_CHANGE_EVENT, onChange);
  };
}

/** Reactive hook for manual offline override. */
export function useForcedOffline(): [boolean, (forced: boolean) => void] {
  const forced = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(STATUS_CHANGE_EVENT, onChange);
      return () => window.removeEventListener(STATUS_CHANGE_EVENT, onChange);
    },
    () => isForcedOffline(),
    () => false
  );
  return [forced, setForcedOffline];
}

/** Live `navigator.onLine` with support for user-toggled manual offline mode. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (isForcedOffline()) return false;
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    },
    () => true
  );
}

const noopSubscribe = () => () => {};

/** False during server rendering and hydration, true once running on the client. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
