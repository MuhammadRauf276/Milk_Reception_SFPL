'use client';

import React from 'react';
import { ManagerLifecycleSummary } from './zmccManagerTypes';
import {
  CheckCircle2,
  Circle,
  FlaskConical,
  Scale,
  Building2,
  Truck,
  ShieldCheck,
} from 'lucide-react';

interface ManagerLifecycleTrackerProps {
  lifecycle: ManagerLifecycleSummary;
  compact?: boolean;
}

const STAGE_ICONS: Record<string, React.ElementType> = {
  DISPATCH: Truck,
  GATE_ENTRY: ShieldCheck,
  PLANT_QA: FlaskConical,
  FIRST_WEIGHT: Scale,
  UNLOADING: Building2,
  SECOND_WEIGHT: Scale,
  FINAL_RECEIPT: CheckCircle2,
};

export const ManagerLifecycleTracker: React.FC<ManagerLifecycleTrackerProps> = ({
  lifecycle,
  compact = false,
}) => {
  return (
    <div className="w-full overflow-x-auto pb-1" role="region" aria-label="Vehicle Lifecycle Progression">
      <div className="flex items-start min-w-[620px] justify-between relative">
        {/* Continuous background connector line */}
        <div className="absolute top-4 left-6 right-6 h-0.5 bg-border z-0" />

        {lifecycle.stages.map((stage) => {
          const Icon = STAGE_ICONS[stage.id] || Circle;
          const isCompleted = stage.status === 'COMPLETED';
          const isCurrent = stage.status === 'CURRENT';

          let circleBg = 'bg-muted border-border-strong text-muted-foreground';
          let labelColor = 'text-muted-foreground';

          if (isCompleted) {
            circleBg = 'bg-emerald-700 border-emerald-700 text-white shadow-xs';
            labelColor = 'text-emerald-800 font-semibold';
          } else if (isCurrent) {
            circleBg = 'bg-primary border-primary text-white ring-4 ring-blue-100 shadow-md';
            labelColor = 'text-primary font-semibold';
          }

          return (
            <div
              key={stage.id}
              className="flex flex-col items-center text-center relative z-raised flex-1 px-1"
            >
              {/* Step Circle Indicator */}
              <div
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-[color,background-color,border-color,box-shadow,opacity,transform] ${circleBg}`}
                title={`${stage.label}: ${stage.status}`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 bg-card rounded-full" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>

              {/* Stage Title */}
              <span className={`text-xs mt-2 block leading-tight ${labelColor}`}>
                {compact ? stage.shortLabel : stage.label}
              </span>

              {/* Status Badge / Detail */}
              {isCurrent && (
                <span className="mt-1 px-2 py-0.2 rounded text-xs font-semibold bg-blue-50 text-primary-hover border border-blue-200">
                  Current
                </span>
              )}

              {/* Specific Stage Contexts */}
              {stage.id === 'PLANT_QA' && stage.detailText && (
                <span
                  className={`mt-1 text-xs tabular-nums font-semibold px-2 py-0.5 rounded ${
                    lifecycle.portionQA.badgeType === 'ALL_ACCEPTED'
                      ? 'bg-emerald-50 text-emerald-800'
                      : lifecycle.portionQA.badgeType === 'ALL_REJECTED' || lifecycle.portionQA.badgeType === 'MIXED'
                      ? 'bg-rose-50 text-rose-800'
                      : lifecycle.portionQA.badgeType === 'HAS_HOLD'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-muted text-secondary-foreground'
                  }`}
                >
                  {stage.detailText}
                </span>
              )}

              {stage.metricText && (
                <span className="mt-0.5 text-xs tabular-nums font-semibold text-secondary-foreground">
                  {stage.metricText}
                </span>
              )}

              {stage.id === 'UNLOADING' && stage.detailText && (
                <span className="mt-0.5 text-xs tabular-nums text-secondary-foreground">
                  {stage.detailText}
                </span>
              )}

              {/* Authoritative Milestone Event Date/Time */}
              {stage.id === 'UNLOADING' ? (
                <div className="mt-0.5 space-y-0.5">
                  {stage.eventTimestamp && (
                    <span className="text-xs tabular-nums text-muted-foreground block leading-tight">
                      Started: {stage.eventTimestamp}
                    </span>
                  )}
                  {stage.eventTimestampEnd && (
                    <span className="text-xs tabular-nums text-muted-foreground block leading-tight">
                      Completed: {stage.eventTimestampEnd}
                    </span>
                  )}
                </div>
              ) : (
                stage.eventTimestamp && (
                  <span className="mt-0.5 text-xs tabular-nums text-muted-foreground block leading-tight">
                    {stage.eventTimestamp}
                  </span>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
