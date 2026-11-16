'use client';

import React from 'react';
import { Layers } from 'lucide-react';
import type { MpdLossTiers } from '../types';
import { NO_DATA } from '../format';
import { InfoTip } from '@/components/ui/info-tip';
import { formatLossGain, formatLossGainPercent, lossGainClass } from '@/lib/lossGain';

interface MpdLossScreenProps {
  lossTiers: MpdLossTiers;
}

export const MpdLossScreen: React.FC<MpdLossScreenProps> = ({ lossTiers }) => {
  const tiers = [
    {
      tier: 'Tier 1',
      name: 'Route loss / gain',
      scope: 'Village Shops → Mobile Tester Vehicle → ZMCC Reception',
      loss: lossTiers?.tier1RouteLoss ?? null,
      details: 'Shop collection volume vs Mobile Tester arrival volume received at the ZMCC.',
    },
    {
      tier: 'Tier 2',
      name: 'ZMCC loss / gain',
      scope: 'ZMCC Reception → Tank Chilling → Tanker Dispatch',
      loss: lossTiers?.tier2ZmccLoss ?? null,
      details: 'Inward receipts vs dispatches, adjusted for the change in tank stock.',
    },
    {
      tier: 'Tier 3',
      name: 'Transit loss / gain',
      scope: 'ZMCC Dispatch → Plant Reception Weighbridge',
      loss: lossTiers?.tier3TransitLoss ?? null,
      details: 'Dispatched tanker volume vs volume accepted at Plant Reception.',
    },
    {
      tier: 'Tier 4',
      name: 'Total loss / gain',
      scope: 'End-to-End Field Purchase → Plant Silo Entry',
      loss: lossTiers?.tier4TotalLoss ?? null,
      details: 'Net of the three transfer points: a gain in one offsets a loss in another.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-card border-border border rounded-2xl p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-foreground">
              Supply Chain Loss / Gain
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
                <span className="text-xs font-semibold text-muted-foreground">{t.tier}</span>
                {t.loss?.at13tsSignedPercent != null && !['', 'Even'].includes(formatLossGainPercent(t.loss.at13tsSignedPercent)) && (
                  <span className={`text-xs tabular-nums font-semibold bg-muted px-2 py-0.5 rounded ${lossGainClass(t.loss.at13tsSignedPercent)}`}>
                    {formatLossGainPercent(t.loss.at13tsSignedPercent)} of milk sent
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-foreground mt-2">{t.name}</h3>

              <div className="bg-card border-border mt-4 p-3 rounded-lg border flex items-center justify-between">
                <span className="text-xs text-secondary-foreground font-medium">Loss / Gain @13% TS</span>
                <span className={`text-base tabular-nums font-semibold ${lossGainClass(t.loss?.at13tsSignedLiters)}`}>
                  {t.loss ? formatLossGain(t.loss.at13tsSignedLiters) : NO_DATA}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Gross litres</span>
                <span className={`tabular-nums font-semibold ${lossGainClass(t.loss?.signedLiters)}`}>
                  {t.loss ? formatLossGain(t.loss.signedLiters) || NO_DATA : NO_DATA}
                </span>
              </div>
              {t.loss?.grossLossLiters != null && t.loss.grossGainLiters != null && (t.loss.grossLossLiters > 0 || t.loss.grossGainLiters > 0) && (
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>All losses and all gains</span>
                  <span className="tabular-nums">
                    <span className="text-rose-700">Loss {t.loss.grossLossLiters.toLocaleString()} L</span> · <span className="text-emerald-700">Gain {t.loss.grossGainLiters.toLocaleString()} L</span>
                  </span>
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              How it is measured
              <InfoTip text={`${t.scope}. ${t.details}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
