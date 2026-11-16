'use client';

import React from 'react';
import { Droplet, Truck, ShieldAlert, Building2 } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { QuantityStat } from '@/components/ui/quantity-stat';
import { Skeleton } from '@/components/ui/skeleton';
import type { MpdSummary } from '../types';
import { formatMetric, NO_DATA } from '../format';
import { formatLossGain, formatLossGainPercent, lossGainClass } from '@/lib/lossGain';

interface MpdExecutiveKpiRibbonProps {
  summary: MpdSummary;
  isLoading?: boolean;
}

const loadingValue = <Skeleton className="h-7 w-24" />;

export const MpdExecutiveKpiRibbon: React.FC<MpdExecutiveKpiRibbonProps> = ({ summary, isLoading }) => {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-3 stagger-children">
      {isLoading ? (
        <StatCard label="Intake" icon={Droplet} tone="info" value={loadingValue} />
      ) : (
        <QuantityStat
          label="Intake"
          icon={Droplet}
          tone="info"
          at13ts={summary.totalIntakeAt13tsLiters}
          gross={summary.totalIntakeLiters}
          missingAt13tsCount={summary.totalIntakeMissing13tsCount}
          hint={
            <span className="tabular-nums">
              Fat {formatMetric(summary.weightedFatPercent, '%')} · LR {formatMetric(summary.weightedLr)}
            </span>
          }
        />
      )}
      {isLoading ? (
        <StatCard label="In transit" icon={Truck} tone="warning" value={loadingValue} />
      ) : (
        <QuantityStat
          label="In transit"
          icon={Truck}
          tone="warning"
          at13ts={summary.inTransitAt13tsLiters}
          gross={summary.inTransitLiters}
          missingAt13tsCount={summary.inTransitMissing13tsCount}
          hint={
            <span>
              <span className="tabular-nums">{summary.inTransitTankerCount}</span> tankers en route to plant
            </span>
          }
        />
      )}
      {isLoading ? (
        <StatCard label="Whole loss / gain" icon={ShieldAlert} tone="warning" value={loadingValue} />
      ) : (
        <QuantityStat
          label="Whole loss / gain"
          icon={ShieldAlert}
          tone="warning"
          at13ts={summary.wholeSignedAt13tsLiters}
          valueText={
            summary.wholeSignedAt13tsLiters == null ? undefined : (
              <span className={lossGainClass(summary.wholeSignedAt13tsLiters)}>{formatLossGain(summary.wholeSignedAt13tsLiters) || NO_DATA}</span>
            )
          }
          hint={
            <span className="space-y-0.5">
              <span className={`block tabular-nums ${lossGainClass(summary.wholeSignedAt13tsPercent)}`}>
                {summary.wholeSignedAt13tsPercent == null ? NO_DATA : formatLossGainPercent(summary.wholeSignedAt13tsPercent)}
              </span>
              <span className="block">
                Gross{' '}
                <span className={`tabular-nums ${lossGainClass(summary.wholeSignedLiters)}`}>
                  {summary.wholeSignedLiters == null ? NO_DATA : formatLossGain(summary.wholeSignedLiters)}
                </span>
              </span>
            </span>
          }
        />
      )}
      <StatCard
        label="Active supply nodes"
        icon={Building2}
        value={isLoading ? loadingValue : summary.activeZmccCount + summary.activeContractorCount}
        hint={
          <span>
            <span className="tabular-nums">{summary.activeZmccCount}</span> ZMCCs ·{' '}
            <span className="tabular-nums">{summary.activeContractorCount}</span> plant contractors
          </span>
        }
      />
    </div>
  );
};
