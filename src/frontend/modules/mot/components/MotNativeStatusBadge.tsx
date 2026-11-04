'use client';

import React, { useEffect, useState } from 'react';
import { androidBridge, type NativeGpsStatus, type NativeOfflineSummary } from '../native/androidBridge';
import { getFixAgeLabel } from '@/lib/gpsTracker';

export interface MotNativeStatusBadgeProps {
  journeyId?: string | null;
  online: boolean;
  onManualSync?: () => void;
}

export function MotNativeStatusBadge({ journeyId, online, onManualSync }: MotNativeStatusBadgeProps) {
  const [isNative, setIsNative] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<NativeGpsStatus | null>(null);
  const [summary, setSummary] = useState<NativeOfflineSummary | null>(null);
  const [batteryIgnored, setBatteryIgnored] = useState(true);

  useEffect(() => {
    setIsNative(androidBridge.isNativeAndroid());
    setBatteryIgnored(androidBridge.isBatteryOptimizationIgnored());

    const updateStatus = () => {
      if (androidBridge.isNativeAndroid()) {
        setGpsStatus(androidBridge.getGpsTrackingStatus());
        setSummary(androidBridge.getOfflineSummary());
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncClick = () => {
    if (androidBridge.isNativeAndroid()) {
      androidBridge.triggerSyncNow();
    }
    onManualSync?.();
  };

  const handleBatteryWarningClick = () => {
    androidBridge.requestIgnoreBatteryOptimization();
  };

  const unsentCount = (summary?.unsyncedCollections ?? 0) + (summary?.unsyncedGps ?? 0);
  const fixAgeMs = gpsStatus?.lastFixTimestamp ? Date.now() - gpsStatus.lastFixTimestamp : null;

  if (!isNative) return null;

  return (
    <div className="w-full flex flex-col gap-2 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200">
      {/* Top Row: Network & GPS Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Native vs Web GPS Indicator */}
          {isNative ? (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-[11px] ${
                gpsStatus?.isTracking
                  ? 'bg-sky-950/80 text-sky-400 border border-sky-800/60'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${gpsStatus?.isTracking ? 'bg-sky-400' : 'bg-slate-500'}`} />
              {gpsStatus?.isTracking ? 'Native Background GPS Active' : 'GPS Idle'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium text-[11px] bg-slate-800 text-slate-400">
              Web GPS
            </span>
          )}
        </div>

        {/* GPS Fix & Accuracy Badge */}
        {gpsStatus?.isTracking && gpsStatus.accuracy !== undefined && (
          <div className="text-[11px] text-slate-400">
            Fix: <span className="font-semibold text-slate-200">{fixAgeMs ? getFixAgeLabel(fixAgeMs) : 'acquiring'}</span> (±{Math.round(gpsStatus.accuracy)}m)
          </div>
        )}
      </div>

      {/* Unsent Work & Sync Queue Status */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
        <div className="flex items-center gap-3 text-[11px]">
          {summary ? (
            <>
              <span className={summary.unsyncedCollections > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                {summary.unsyncedCollections} {summary.unsyncedCollections === 1 ? 'collection' : 'collections'} queued
              </span>
              <span className="text-slate-600">·</span>
              <span className={summary.unsyncedGps > 0 ? 'text-sky-400' : 'text-slate-400'}>
                {summary.unsyncedGps} GPS points
              </span>
              {summary.pendingPhotos > 0 && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-purple-400">{summary.pendingPhotos} photos</span>
                </>
              )}
            </>
          ) : (
            <span className="text-slate-400">Ready</span>
          )}
        </div>

        {online && unsentCount > 0 && (
          <button
            type="button"
            onClick={handleSyncClick}
            className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-[11px] transition-colors"
          >
            Sync Now
          </button>
        )}
      </div>

      {/* Battery Optimization Warning (if not disabled) */}
      {isNative && !batteryIgnored && (
        <div className="flex items-center justify-between p-2 mt-1 rounded bg-amber-950/60 border border-amber-800/80 text-[11px] text-amber-200">
          <span>Battery optimization may restrict GPS tracking when screen is locked.</span>
          <button
            type="button"
            onClick={handleBatteryWarningClick}
            className="ml-2 px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-900 font-bold shrink-0"
          >
            Disable
          </button>
        </div>
      )}
    </div>
  );
}
