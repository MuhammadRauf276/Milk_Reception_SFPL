'use client';

import React from 'react';
import { MapPin } from 'lucide-react';
import type { GpsState } from './arrivalTypes';
import type { AutoGpsStatus } from './useGpsCapture';

interface Props {
  label: string;
  gps: GpsState;
  status: AutoGpsStatus;
  onRetry: () => void;
}

/** The location saved with the arrival. It fills in by itself, so there is nothing to press unless no location was found. */
export function AutoGpsStatusLine({ label, gps, status, onRetry }: Props) {
  const hasLocation = gps.lat != null && gps.lng != null;
  return (
    <div className="bg-card border-border p-3 rounded-xl border text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-600 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" />
          {label}
        </span>
        {status === 'NONE' ? (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 min-w-11 text-primary hover:underline text-xs font-semibold"
          >
            Try again
          </button>
        ) : hasLocation ? (
          <span
            className={`font-semibold tabular-nums text-[11px] ${
              status === 'APPROXIMATE' ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {gps.lat!.toFixed(5)}, {gps.lng!.toFixed(5)}
          </span>
        ) : (
          <span role="status" className="text-slate-500 text-[11px]">
            Getting GPS…
          </span>
        )}
      </div>
      {status === 'APPROXIMATE' && hasLocation && (
        <p className="mt-1 text-[11px] text-amber-700">
          Approximate: no live GPS signal, so the last saved or ZMCC location is used. It updates when GPS is found.
        </p>
      )}
      {status === 'NONE' && (
        <p className="mt-1 text-[11px] text-slate-500">
          No location found. Turn on Location on this phone. You can still save the arrival.
        </p>
      )}
    </div>
  );
}
