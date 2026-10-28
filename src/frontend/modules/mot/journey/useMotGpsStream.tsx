'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getFixAgeLabel, shouldRecordPoint, type TrackedPoint } from '@/lib/gpsTracker';
import { queueGpsLocation } from '../offlineStore';

/**
 * One GPS stream: proximity sorting always, route recording while COLLECTING.
 * `recordRoute` is true only for the MOT; a superior covering MOT work does not send route points.
 */
export function useMotGpsStream(opts: {
  journeyId: string | null;
  recordRoute: boolean;
  refreshUnsynced: () => unknown;
  triggerSync: () => unknown;
}) {
  const { journeyId, recordRoute, refreshUnsynced, triggerSync } = opts;
  const [deviceGps, setDeviceGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const [gpsClock, setGpsClock] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setGpsClock(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const gpsFixAgeMs = lastFixAt === null ? null : Math.max(0, gpsClock - lastFixAt);
  const gpsBadge = (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-bold ${
        gpsFixAgeMs !== null && gpsFixAgeMs <= 5 * 60 * 1000
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-slate-200 text-slate-500'
      }`}
    >
      {gpsFixAgeMs === null
        ? 'Last GPS fix: waiting…'
        : `Last GPS fix: ${gpsFixAgeMs < 60_000 ? 'just now' : getFixAgeLabel(gpsFixAgeMs)}`}
    </span>
  );

  const lastSavedPointRef = useRef<TrackedPoint | null>(null);
  const lastSavedJourneyRef = useRef<string | null>(null);
  const latestFixRef = useRef<TrackedPoint | null>(null);
  const refreshUnsyncedRef = useRef(refreshUnsynced);
  const triggerSyncRef = useRef(triggerSync);
  useEffect(() => {
    refreshUnsyncedRef.current = refreshUnsynced;
    triggerSyncRef.current = triggerSync;
  }, [refreshUnsynced, triggerSync]);

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;

    const journeyKey = journeyId === null ? null : String(journeyId);
    if (lastSavedJourneyRef.current !== journeyKey) {
      lastSavedJourneyRef.current = journeyKey;
      lastSavedPointRef.current = null;
    }

    const onPosition = (pos: GeolocationPosition) => {
      const point: TrackedPoint = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
      };
      latestFixRef.current = point;
      setDeviceGps({ latitude: point.latitude, longitude: point.longitude });
      setLastFixAt(pos.timestamp);

      if (!recordRoute || !journeyId) return;

      const decision = shouldRecordPoint(lastSavedPointRef.current, point, Date.now());
      if (!decision.record) return;
      lastSavedPointRef.current = point;

      void (async () => {
        try {
          await queueGpsLocation({
            journey_id: journeyId,
            latitude: point.latitude,
            longitude: point.longitude,
            gps_accuracy: point.accuracy,
            device_recorded_at: new Date(point.timestamp).toISOString(),
          });
          refreshUnsyncedRef.current();
          if (navigator.onLine) {
            void triggerSyncRef.current();
          }
        } catch {
          // Geolocation/queue error ignored for background queue
        }
      })();
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });

    // A stationary phone may stop firing watchPosition events; force a fresh fix so the 2-min heartbeat still records.
    const heartbeat = recordRoute && journeyId
      ? setInterval(() => {
          if (document.visibilityState !== 'visible') return;
          navigator.geolocation.getCurrentPosition(onPosition, () => {}, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000,
          });
        }, 120_000)
      : null;

    // Keep the screen awake while recording: browsers suspend GPS when the screen turns off or the tab is hidden.
    type WakeLockLike = { release: () => Promise<void> };
    let wakeLock: WakeLockLike | null = null;
    const requestWakeLock = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock;
        if (wl && document.visibilityState === 'visible') wakeLock = await wl.request('screen');
      } catch {
        // Not supported or denied; tracking still works while the app is open.
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void requestWakeLock();
      // Back in the foreground: flush anything captured while offline/backgrounded.
      if (navigator.onLine) void triggerSyncRef.current();
    };
    if (recordRoute && journeyId) {
      void requestWakeLock();
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (heartbeat) clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock?.release().catch(() => undefined);
    };
  }, [recordRoute, journeyId]);

  return { deviceGps, latestFixRef, gpsBadge: gpsBadge as React.ReactNode };
}
