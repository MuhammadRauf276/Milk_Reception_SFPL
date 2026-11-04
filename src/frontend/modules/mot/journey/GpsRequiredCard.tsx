'use client';

import React from 'react';
import { MapPinOff } from 'lucide-react';
import type { GpsProblem } from './useMotGpsStream';

interface Props {
  problem: Exclude<GpsProblem, null>;
  onRetry: () => void;
}

/** Shown in place of the journey: a Mobile Tester cannot work with location off. */
export function GpsRequiredCard({ problem, onRetry }: Props) {
  return (
    <div role="alert" className="p-5 bg-card rounded-xl border-2 border-rose-300 shadow-2xs text-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
        <MapPinOff className="w-6 h-6" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-foreground">Turn on your GPS</h2>
      <p className="text-sm text-slate-600">
        {problem === 'denied'
          ? 'This app is not allowed to use your location. Tap the lock icon next to the web address, choose Location, then Allow.'
          : 'Location is switched off on this phone. Open your phone settings and turn on Location.'}
      </p>
      <p className="text-xs text-slate-500">You can continue your journey once GPS is on.</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 w-full sm:w-auto px-6 rounded-xl bg-primary text-white text-sm font-semibold"
      >
        I turned it on
      </button>
    </div>
  );
}
