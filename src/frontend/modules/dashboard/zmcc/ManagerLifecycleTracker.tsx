'use client';

import React from 'react';
import { ManagerLifecycleSummary, LifecycleStageInfo } from './zmccManagerTypes';
import {
  CheckCircle2,
  Circle,
  Clock,
  FlaskConical,
  Scale,
  Factory,
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
  UNLOADING: Factory,
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
        <div className="absolute top-4 left-6 right-6 h-0.5 bg-[#EAE4D5] -z-0" />

        {lifecycle.stages.map((stage, idx) => {
          const Icon = STAGE_ICONS[stage.id] || Circle;
          const isCompleted = stage.status === 'COMPLETED';
          const isCurrent = stage.status === 'CURRENT';
          const isUpcoming = stage.status === 'UPCOMING';

          let circleBg = 'bg-[#F1F5F9] border-slate-300 text-slate-400';
          let labelColor = 'text-slate-500';

          if (isCompleted) {
            circleBg = 'bg-[#166534] border-[#166534] text-white shadow-sm';
            labelColor = 'text-[#166534] font-black';
          } else if (isCurrent) {
            circleBg = 'bg-[#1E3A8A] border-[#1E3A8A] text-white ring-4 ring-blue-100 shadow-md';
            labelColor = 'text-[#1E3A8A] font-black';
          }

          return (
            <div
              key={stage.id}
              className="flex flex-col items-center text-center relative z-10 flex-1 px-1"
            >
              {/* Step Circle Indicator */}
              <div
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${circleBg}`}
                title={`${stage.label}: ${stage.status}`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>

              {/* Stage Title */}
              <span className={`text-[11px] mt-2 block leading-tight ${labelColor}`}>
                {compact ? stage.shortLabel : stage.label}
              </span>

              {/* Status Badge / Detail */}
              {isCurrent && (
                <span className="mt-1 px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                  Current
                </span>
              )}

              {/* Specific Stage Contexts */}
              {stage.id === 'PLANT_QA' && stage.detailText && (
                <span
                  className={`mt-1 text-[9.5px] font-mono font-extrabold px-1.5 py-0.5 rounded ${
                    lifecycle.portionQA.badgeType === 'ALL_ACCEPTED'
                      ? 'bg-[#F0FDF4] text-[#166534]'
                      : lifecycle.portionQA.badgeType === 'ALL_REJECTED' || lifecycle.portionQA.badgeType === 'MIXED'
                      ? 'bg-[#FEF2F2] text-[#991B1B]'
                      : lifecycle.portionQA.badgeType === 'HAS_HOLD'
                      ? 'bg-[#FFFBEB] text-[#B45309]'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {stage.detailText}
                </span>
              )}

              {stage.metricText && (
                <span className="mt-0.5 text-[9.5px] font-mono font-bold text-slate-700">
                  {stage.metricText}
                </span>
              )}

              {stage.id === 'UNLOADING' && stage.detailText && (
                <span className="mt-0.5 text-[9px] font-mono text-slate-600">
                  {stage.detailText}
                </span>
              )}

              {/* Authoritative Milestone Event Date/Time */}
              {stage.eventTimestamp && (
                <span className="mt-0.5 text-[8.5px] font-mono text-slate-500 block leading-tight">
                  {stage.eventTimestamp}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
