'use client';

import { useCallback, useEffect, useState } from 'react';
import { getUnsyncedSummary, syncAll } from '../offlineStore';

/** Offline queue status and sync triggers (manual, on reconnect, and every 30s while online). */
export function useMotSync() {
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const refreshUnsynced = useCallback(
    () =>
      getUnsyncedSummary()
        .then((summary) => setUnsyncedCount(summary.totalUnsynced))
        .catch(() => {
          // IndexedDB might not be ready
        }),
    []
  );

  useEffect(() => {
    refreshUnsynced();
  }, [refreshUnsynced]);

  const triggerSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const result = await syncAll();
      const totalSynced = result.collections.synced + result.gps.synced + (result.skips?.synced || 0);
      if (totalSynced > 0) {
        setSyncFeedback(`Successfully synced ${totalSynced} pending item(s).`);
      }
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      await refreshUnsynced();
    } catch {
      setSyncFeedback('Sync failed: Network issue.');
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshUnsynced]);

  // Sync as soon as connectivity returns
  useEffect(() => {
    const handleOnline = () => {
      triggerSync();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [triggerSync]);

  // Periodic 30s sync when online
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) {
        triggerSync();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [triggerSync]);

  return { unsyncedCount, lastSyncTime, syncing, syncFeedback, setSyncFeedback, refreshUnsynced, triggerSync };
}
export type MotSync = ReturnType<typeof useMotSync>;
