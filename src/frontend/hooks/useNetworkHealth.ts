'use client';

import { useSyncExternalStore, useCallback } from 'react';

export type NetworkHealthStatus =
  | 'ONLINE'           // Browser online & backend API responded successfully
  | 'API_UNREACHABLE'  // Browser online, but backend API probe failed or timed out
  | 'OFFLINE'          // Browser has no network connectivity (navigator.onLine === false)
  | 'RECONNECTING';    // Actively probing connection after an outage

export interface NetworkHealthSnapshot {
  status: NetworkHealthStatus;
  isOnline: boolean;
  isOffline: boolean;
  isApiUnreachable: boolean;
  isReconnecting: boolean;
  lastCheckedAt: number | null;
  latencyMs: number | null;
}

export const NETWORK_HEALTH_EVENT = 'milk-network-health-changed';

// Module-level singleton state to avoid duplicate probe intervals across components
let currentSnapshot: NetworkHealthSnapshot = {
  status: typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'ONLINE',
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  isApiUnreachable: false,
  isReconnecting: false,
  lastCheckedAt: null,
  latencyMs: null,
};

const listeners = new Set<() => void>();
let probeIntervalId: ReturnType<typeof setInterval> | null = null;
let isProbing = false;
let consecutiveFailures = 0;

function notifyListeners() {
  listeners.forEach((listener) => listener());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(NETWORK_HEALTH_EVENT, { detail: currentSnapshot })
    );
  }
}

function updateSnapshot(partial: Partial<NetworkHealthSnapshot>) {
  currentSnapshot = {
    ...currentSnapshot,
    ...partial,
    isOnline: (partial.status ?? currentSnapshot.status) === 'ONLINE',
    isOffline: (partial.status ?? currentSnapshot.status) === 'OFFLINE',
    isApiUnreachable: (partial.status ?? currentSnapshot.status) === 'API_UNREACHABLE',
    isReconnecting: (partial.status ?? currentSnapshot.status) === 'RECONNECTING',
  };
  notifyListeners();
}

/**
 * Pure evaluation function for network health status based on browser and reachability flags.
 */
export function evaluateNetworkHealthState(
  isBrowserOnline: boolean,
  isBackendReachable: boolean
): NetworkHealthStatus {
  if (!isBrowserOnline) return 'OFFLINE';
  if (!isBackendReachable) return 'API_UNREACHABLE';
  return 'ONLINE';
}

/**
 * Executes a lightweight HTTP probe against /api/health to confirm true backend reachability.
 */
export async function probeBackendHealth(): Promise<NetworkHealthStatus> {
  if (typeof window === 'undefined') return 'ONLINE';

  if (!navigator.onLine) {
    consecutiveFailures++;
    updateSnapshot({
      status: 'OFFLINE',
      lastCheckedAt: Date.now(),
      latencyMs: null,
    });
    return 'OFFLINE';
  }

  if (isProbing) return currentSnapshot.status;
  isProbing = true;

  if (currentSnapshot.status !== 'ONLINE') {
    updateSnapshot({ status: 'RECONNECTING' });
  }

  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const elapsed = Math.round(performance.now() - startTime);

    if (res.ok) {
      consecutiveFailures = 0;
      updateSnapshot({
        status: 'ONLINE',
        lastCheckedAt: Date.now(),
        latencyMs: elapsed,
      });
      return 'ONLINE';
    } else {
      consecutiveFailures++;
      updateSnapshot({
        status: 'API_UNREACHABLE',
        lastCheckedAt: Date.now(),
        latencyMs: elapsed,
      });
      return 'API_UNREACHABLE';
    }
  } catch (_err) {
    clearTimeout(timeoutId);
    consecutiveFailures++;
    const newStatus = navigator.onLine ? 'API_UNREACHABLE' : 'OFFLINE';
    updateSnapshot({
      status: newStatus,
      lastCheckedAt: Date.now(),
      latencyMs: null,
    });
    return newStatus;
  } finally {
    isProbing = false;
  }
}

function startGlobalHealthPolling() {
  if (typeof window === 'undefined' || probeIntervalId !== null) return;

  const handleOnline = () => {
    void probeBackendHealth();
  };

  const handleOffline = () => {
    updateSnapshot({
      status: 'OFFLINE',
      lastCheckedAt: Date.now(),
      latencyMs: null,
    });
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Background heartbeat: 30 seconds when healthy, adaptive backoff when failing
  const scheduleNextProbe = () => {
    const delay = consecutiveFailures === 0 ? 30_000 : Math.min(5_000 * Math.pow(1.5, consecutiveFailures - 1), 30_000);
    probeIntervalId = setTimeout(async () => {
      // Skip background ping if page is hidden to conserve battery & network
      if (typeof document !== 'undefined' && !document.hidden) {
        await probeBackendHealth();
      }
      scheduleNextProbe();
    }, delay) as unknown as ReturnType<typeof setInterval>;
  };

  scheduleNextProbe();

  // Run initial probe on load if browser claims online
  if (navigator.onLine && currentSnapshot.lastCheckedAt === null) {
    void probeBackendHealth();
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (listeners.size === 1) {
    startGlobalHealthPolling();
  }
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): NetworkHealthSnapshot {
  return currentSnapshot;
}

function getServerSnapshot(): NetworkHealthSnapshot {
  return {
    status: 'ONLINE',
    isOnline: true,
    isOffline: false,
    isApiUnreachable: false,
    isReconnecting: false,
    lastCheckedAt: null,
    latencyMs: null,
  };
}

/**
 * Hook providing reactive network connectivity and backend API reachability status.
 */
export function useNetworkHealth(): NetworkHealthSnapshot & { checkHealth: () => Promise<NetworkHealthStatus> } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const checkHealth = useCallback(async () => {
    return await probeBackendHealth();
  }, []);

  return {
    ...snapshot,
    checkHealth,
  };
}
