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
          <Filter className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold text-foreground">
            Quality Funnel
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border-border border rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Station 1 · Village Shops</span>
              <span className="tabular-nums text-xs font-semibold text-secondary-foreground bg-muted px-2 py-0.5 rounded">
                Mobile Tester / Shop Test
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {formatMetric(qualityFunnel.villageShopRejectedLiters, ' L')}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Rejection Rate:</span>
                <span className="tabular-nums font-semibold text-secondary-foreground">
                  {formatMetric(qualityFunnel.villageShopRejectionPercent, '%')}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-secondary-foreground">
              Not recorded at shop level
            </div>
          </div>

          <div className="bg-card border-border border rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Station 2 · ZMCC Reception</span>
              <span className="tabular-nums text-xs font-semibold text-secondary-foreground bg-muted px-2 py-0.5 rounded">
                Lab Attendant
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {qualityFunnel.zmccGateRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Rejection Rate:</span>
                <span className="tabular-nums font-semibold text-amber-700">
                  {formatMetric(qualityFunnel.zmccGateRejectionPercent, '%')}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-secondary-foreground">
              Rejected vs tested today
            </div>
          </div>

          <div className="bg-card border-border border rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Station 3 · Plant Reception</span>
              <span className="tabular-nums text-xs font-semibold text-secondary-foreground bg-muted px-2 py-0.5 rounded">
                Plant QA Lab
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {qualityFunnel.plantGateRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Plant Rejection:</span>
                <span className="tabular-nums font-semibold text-amber-700">
                  {formatMetric(qualityFunnel.plantGateRejectionPercent, '%')}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-border text-xs text-secondary-foreground">
              Rejected vs decided today
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border-border border rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold text-foreground">
              Failed Tests Today
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border-border p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary-foreground">Formalin (Preservative)</span>
              <IncidentDot count={qualityFunnel.incidents.formalinCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-foreground">
              {qualityFunnel.incidents.formalinCount} flags
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Strict zero tolerance</div>
          </div>

          <div className="bg-card border-border p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary-foreground">Urea</span>
              <IncidentDot count={qualityFunnel.incidents.ureaCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-foreground">
              {qualityFunnel.incidents.ureaCount} flags
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Strict zero tolerance</div>
          </div>

          <div className="bg-card border-border p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary-foreground">Added Water (LR out of range)</span>
              <IncidentDot count={qualityFunnel.incidents.waterLowLrCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-foreground">
              {qualityFunnel.incidents.waterLowLrCount} flags
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Failed lactometer reading</div>
          </div>

          <div className="bg-card border-border p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary-foreground">Clot on Boiling Positive</span>
              <IncidentDot count={qualityFunnel.incidents.cobPositiveCount} />
            </div>
            <div className="mt-2 text-xl tabular-nums font-semibold text-foreground">
              {qualityFunnel.incidents.cobPositiveCount} flags
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Heat stability test failed</div>
          </div>
        </div>
      </div>
    </div>
  );
};
