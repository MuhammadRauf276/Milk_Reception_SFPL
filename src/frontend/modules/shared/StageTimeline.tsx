'use client';

import React from 'react';
import { Check, Truck, KeyRound, TestTube2, Scale, Droplet, ArrowRight, Factory } from 'lucide-react';
import { ProcessStatus } from '@core/types';

interface StageTimelineProps {
  currentStatus: ProcessStatus;
  onSelectStageFilter?: (stage: ProcessStatus) => void;
  compact?: boolean;
}

const STAGES = [
  'DISPATCHED',
  'TOKEN_ISSUED',
  'PLANT_QA',
  'READY_FOR_GROSS',
  'GROSS_WEIGHED',
  'READY_FOR_UNLOADING',
  'UNLOADING',
  'READY_FOR_TARE',
  'TARE_WEIGHED',
  'READY_FOR_GATE_EXIT',
  'COMPLETED',
];

const STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  'DISPATCHED': { label: 'Dispatched', icon: <Truck className="w-3.5 h-3.5" /> },
  'TOKEN_ISSUED': { label: 'Token Issued', icon: <KeyRound className="w-3.5 h-3.5" /> },
  'PLANT_QA': { label: 'Plant QA', icon: <TestTube2 className="w-3.5 h-3.5" /> },
  'READY_FOR_GROSS': { label: 'Ready First Wt', icon: <Scale className="w-3.5 h-3.5" /> },
  'GROSS_WEIGHED': { label: 'First Wt Done', icon: <Scale className="w-3.5 h-3.5" /> },
  'READY_FOR_UNLOADING': { label: 'Ready Unload', icon: <Factory className="w-3.5 h-3.5" /> },
  'UNLOADING': { label: 'Unloading', icon: <Droplet className="w-3.5 h-3.5" /> },
  'READY_FOR_TARE': { label: 'Ready Second Wt', icon: <Scale className="w-3.5 h-3.5" /> },
  'TARE_WEIGHED': { label: 'Second Wt Done', icon: <Scale className="w-3.5 h-3.5" /> },
  'READY_FOR_GATE_EXIT': { label: 'Ready Exit', icon: <KeyRound className="w-3.5 h-3.5" /> },
  'COMPLETED': { label: 'Completed', icon: <Check className="w-3.5 h-3.5" /> },

  // Legacy fallback mappings
  'Dispatched': { label: 'Dispatched', icon: <Truck className="w-3.5 h-3.5" /> },
  'Token Issued': { label: 'Token Issued', icon: <KeyRound className="w-3.5 h-3.5" /> },
  'GATE': { label: 'Token Issued', icon: <KeyRound className="w-3.5 h-3.5" /> },
  'Sampling': { label: 'Plant QA', icon: <TestTube2 className="w-3.5 h-3.5" /> },
  'LAB': { label: 'Plant QA', icon: <TestTube2 className="w-3.5 h-3.5" /> },
  'First Weight': { label: 'First Weight', icon: <Scale className="w-3.5 h-3.5" /> },
  'SCALE_1': { label: 'First Wt Done', icon: <Scale className="w-3.5 h-3.5" /> },
  'Silo Reception': { label: 'Silo Reception', icon: <Factory className="w-3.5 h-3.5" /> },
  'UNLOAD': { label: 'Unloading', icon: <Droplet className="w-3.5 h-3.5" /> },
  'SCALE_2_READY': { label: 'Ready Second Wt', icon: <Scale className="w-3.5 h-3.5" /> },
  'Second Weight': { label: 'Second Weight', icon: <Scale className="w-3.5 h-3.5" /> },
  'Completed': { label: 'Completed', icon: <Check className="w-3.5 h-3.5" /> },
};

function normalizeStatus(st: string): string {
  if (!st) return 'DISPATCHED';
  const u = st.toUpperCase();
  if (u === 'DISPATCHED') return 'DISPATCHED';
  if (u === 'TOKEN_ISSUED' || u === 'GATE' || st === 'Token Issued') return 'TOKEN_ISSUED';
  if (u === 'PLANT_QA' || u === 'LAB' || st === 'Sampling') return 'PLANT_QA';
  if (u === 'READY_FOR_GROSS') return 'READY_FOR_GROSS';
  if (u === 'GROSS_WEIGHED' || u === 'SCALE_1' || st === 'First Weight') return 'GROSS_WEIGHED';
  if (u === 'READY_FOR_UNLOADING' || st === 'Silo Reception') return 'READY_FOR_UNLOADING';
  if (u === 'UNLOADING' || u === 'UNLOAD') return 'UNLOADING';
  if (u === 'READY_FOR_TARE' || u === 'SCALE_2_READY') return 'READY_FOR_TARE';
  if (u === 'TARE_WEIGHED' || st === 'Second Weight') return 'TARE_WEIGHED';
  if (u === 'READY_FOR_GATE_EXIT') return 'READY_FOR_GATE_EXIT';
  if (u === 'COMPLETED' || u === 'EXIT' || st === 'Completed') return 'COMPLETED';
  return 'DISPATCHED';
}

export const StageTimeline: React.FC<StageTimelineProps> = ({ currentStatus, compact = false }) => {
  const normStatus = normalizeStatus(currentStatus);
  const safeStages = STAGES;
  const currentIndex = Math.max(0, safeStages.indexOf(normStatus));

  if (compact) {
    return (
      <div className="flex items-center space-x-1 overflow-x-auto py-0.5 scrollbar-none">
        {safeStages.map((stage, idx) => {
          const isDone = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const config = STAGE_CONFIG[stage] || { label: stage, icon: <Truck className="w-3.5 h-3.5" /> };

          return (
            <React.Fragment key={`stage-compact-${stage}`}>
              <div
                className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap transition-all ${
                  isCurrent
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : isDone
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white text-slate-500 border border-slate-200'
                }`}
              >
                {isDone ? <Check className="w-2.5 h-2.5 text-white stroke-[3]" /> : config.icon}
                <span>{config.label}</span>
              </div>
              {idx < safeStages.length - 1 && (
                <ArrowRight className={`w-2.5 h-2.5 shrink-0 ${idx < currentIndex ? 'text-emerald-700' : 'text-slate-300'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-full py-3 px-1">
      <div className="relative flex items-center justify-between w-full">
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-slate-200 -translate-y-1/2 z-0 rounded-full" />
        <div
          className="absolute top-1/2 left-0 h-1 bg-[#1E40AF] -translate-y-1/2 z-0 rounded-full transition-all duration-500"
          style={{ width: `${(Math.max(0, currentIndex) / (safeStages.length - 1)) * 100}%` }}
        />

        {safeStages.map((stage, idx) => {
          const isDone = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const config = STAGE_CONFIG[stage] || { label: stage, icon: <Truck className="w-3.5 h-3.5" /> };

          return (
            <div key={`stage-full-${stage}`} className="relative z-10 flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all border-2 ${
                  isCurrent
                    ? 'bg-[#1E40AF] border-[#1E40AF] text-white ring-4 ring-blue-100 scale-110 shadow-sm'
                    : isDone
                    ? 'bg-emerald-700 border-emerald-700 text-white shadow-sm'
                    : 'bg-white border-slate-300 text-slate-400'
                }`}
              >
                {isDone ? <Check className="w-4 h-4 text-white stroke-[3]" /> : config.icon}
              </div>

              <span
                className={`mt-1.5 text-[10px] font-bold transition-colors ${
                  isCurrent
                    ? 'text-[#0F172A] font-extrabold'
                    : isDone
                    ? 'text-emerald-800 font-extrabold'
                    : 'text-slate-400'
                }`}
              >
                {config.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
