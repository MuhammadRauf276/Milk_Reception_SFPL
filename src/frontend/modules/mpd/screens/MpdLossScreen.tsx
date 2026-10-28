'use client';

import React from 'react';
import { Layers } from 'lucide-react';
import type { MpdLossTiers } from '../types';
import { formatMetric } from '../format';
import { InfoTip } from '@/components/ui/info-tip';

interface MpdLossScreenProps {
  lossTiers: MpdLossTiers;
}

export const MpdLossScreen: React.FC<MpdLossScreenProps> = ({ lossTiers }) => {
  const tiers = [
    {
      tier: 'Tier 1',
      name: 'Route loss',
      scope: 'Village Shops → Mobile Tester Vehicle → ZMCC Reception',
      loss: lossTiers?.tier1RouteLoss ?? null,
      details: 'Shop collection volume vs Mobile Tester arrival volume received at the ZMCC.',
    },
    {
      tier: 'Tier 2',
      name: 'ZMCC loss',
      scope: 'ZMCC Reception → Tank Chilling → Tanker Dispatch',
      loss: lossTiers?.tier2ZmccLoss ?? null,
      details: 'Inward receipts vs dispatches, adjusted for the change in tank stock.',
    },
    {
      tier: 'Tier 3',
      name: 'Transit loss',
      scope: 'ZMCC Dispatch → Plant Reception Weighbridge',
      loss: lossTiers?.tier3TransitLoss ?? null,
      details: 'Dispatched tanker volume vs volume accepted at Plant Reception.',
    },
    {
      tier: 'Tier 4',
      name: 'Total loss',
      scope: 'End-to-End Field Purchase → Plant Silo Entry',
      loss: lossTiers?.tier4TotalLoss ?? null,
      details: 'Combined variance across all three transfer points.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-card border-border border rounded-xl p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-foreground">
              Supply Chain Loss
            </h2>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiers.map((t, idx) => (
          <div
            key={t.tier}
            className={`bg-card border rounded-xl p-4 shadow-xs flex flex-col justify-between ${
              idx === 3 ? 'border-primary/40' : 'border-border'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.tier}</span>
                <span className="text-xs tabular-nums font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                  {formatMetric(t.loss?.lossPercent, '%')} variance
                </span>
              </div>
              <h3 className="text-sm font-semibold text-foreground mt-2">{t.name}</h3>

              <div className="bg-card border-border mt-4 p-3 rounded-lg border flex items-center justify-between">
                <span className="text-xs text-slate-600 font-medium">Loss volume</span>
                <span className="text-base tabular-nums font-semibold text-foreground">
                  {formatMetric(t.loss?.lossLiters, ' L')}
                </span>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
              How it is measured
              <InfoTip text={`${t.scope}. ${t.details}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
