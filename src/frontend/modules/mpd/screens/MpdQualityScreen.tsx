'use client';

import React from 'react';
import { FlaskConical, Filter } from 'lucide-react';
import type { QualityFunnelTelemetry } from '../types';
import { formatMetric } from '../format';

interface MpdQualityScreenProps {
  qualityFunnel: QualityFunnelTelemetry;
}

/** Green when nothing was flagged today, red otherwise. */
function IncidentDot({ count }: { count: number }) {
  return <span className={`w-2.5 h-2.5 rounded-full ${count > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} />;
}

export const MpdQualityScreen: React.FC<MpdQualityScreenProps> = ({ qualityFunnel }) => {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-primary" />
          <h2 className="text-xs font-semibold text-foreground">
            Upstream 3-Station Quality Screening Funnel
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase">Station 1 · Village Shops</span>
              <span className="tabular-nums text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                MOT / Shop Test
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {formatMetric(qualityFunnel.villageShopRejectedLiters, ' L')}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Rejection Rate:</span>
                <span className="tabular-nums font-semibold text-slate-700">
                  {formatMetric(qualityFunnel.villageShopRejectionPercent, '%')}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-slate-600">
              Not tracked yet: MOT shop collections do not record rejected milk.
            </div>
          </div>

          <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase">Station 2 · ZMCC Reception</span>
              <span className="tabular-nums text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                Lab Attendant
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {qualityFunnel.zmccGateRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Rejection Rate:</span>
                <span className="tabular-nums font-semibold text-amber-700">
                  {formatMetric(qualityFunnel.zmccGateRejectionPercent, '%')}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-slate-600">
              Liters rejected by ZMCC lab decisions today, of all liters tested.
            </div>
          </div>

          <div className="bg-white border border-border rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase">Station 3 · Plant Reception</span>
              <span className="tabular-nums text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                Plant QA Lab
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {qualityFunnel.plantGateRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Plant Rejection:</span>
                <span className="tabular-nums font-semibold text-amber-700">
                  {formatMetric(qualityFunnel.plantGateRejectionPercent, '%')}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-slate-600">
              Portion liters rejected by plant QA today, of all portions decided.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-border rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-semibold text-foreground">
              Today&apos;s Adulteration & Spoilage Incidents Log
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500">
            Failed tests recorded today at dispatch, ZMCC and plant labs
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-lg border border-border bg-subtle">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Formalin (Preservative)</span>
              <IncidentDot count={qualityFunnel.incidents.formalinCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-slate-800">
              {qualityFunnel.incidents.formalinCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Strict zero tolerance</div>
          </div>

          <div className="p-3.5 rounded-lg border border-border bg-subtle">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Urea</span>
              <IncidentDot count={qualityFunnel.incidents.ureaCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-slate-800">
              {qualityFunnel.incidents.ureaCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Strict zero tolerance</div>
          </div>

          <div className="p-3.5 rounded-lg border border-border bg-subtle">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Added Water (LR out of range)</span>
              <IncidentDot count={qualityFunnel.incidents.waterLowLrCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-slate-800">
              {qualityFunnel.incidents.waterLowLrCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Failed lactometer reading</div>
          </div>

          <div className="p-3.5 rounded-lg border border-border bg-subtle">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Clot on Boiling Positive</span>
              <IncidentDot count={qualityFunnel.incidents.cobPositiveCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-slate-800">
              {qualityFunnel.incidents.cobPositiveCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Heat stability test failed</div>
          </div>
        </div>
      </div>
    </div>
  );
};
