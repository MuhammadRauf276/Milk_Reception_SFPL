'use client';

import React from 'react';
import { Layers, HelpCircle, ShieldAlert, ArrowRight } from 'lucide-react';
import type { MpdSummary } from '../types';

interface MpdLossScreenProps {
  summary: MpdSummary;
}

export const MpdLossScreen: React.FC<MpdLossScreenProps> = ({ summary }) => {
  const tiers = [
    {
      tier: 'Tier 1',
      name: 'Field Collection Route Loss',
      scope: 'Village Shops → MOT Van → ZMCC Reception',
      lossLiters: 320,
      lossPercent: 0.18,
      status: 'NORMAL',
      details: 'Dipstick volume vs MOT van bulk dump. Accounting for can residue & temperature variation.',
    },
    {
      tier: 'Tier 2',
      name: 'ZMCC Chilling & Storage Loss',
      scope: 'ZMCC Reception → Silo Chilling → Tanker Dispatch',
      lossLiters: 480,
      lossPercent: 0.22,
      status: 'NORMAL',
      details: 'Piping hold-up, chiller surface stickage, and silo agitator evaporation.',
    },
    {
      tier: 'Tier 3',
      name: 'Inter-Facility Transit Loss',
      scope: 'ZMCC Dispatch Weighbridge → Plant Reception Weighbridge',
      lossLiters: 1210,
      lossPercent: 0.31,
      status: 'MONITORED',
      details: 'Heavy tanker transit variance. Monitored for valve leaks or unauthorized en-route drainage.',
    },
    {
      tier: 'Tier 4',
      name: 'Total Cumulative Supply Chain Loss',
      scope: 'End-to-End Field Purchase → Plant Silo Entry',
      lossLiters: summary.supplyChainLossLiters || 2010,
      lossPercent: summary.supplyChainLossPercent || 0.71,
      status: 'DIAGNOSTIC_HEALTHY',
      details: 'Compound variance across all 3 custody transfer points across division.',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Overview & Pricing Context Banner */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1E3A8A] shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-[#111311] uppercase tracking-wider">
              4-Tier Physical Supply Chain Loss Diagnostics
            </h2>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Tracking physical volumetric shrinkage and TS variance at each transfer stage. Financial evaluations are applied dynamically per supplier-specific pricing agreements (e.g., standard TS formulas, bulk flat incentives, or contractor contracts) rather than uniform static rates.
            </p>
          </div>
        </div>
      </div>

      {/* 4-Tier Diagnostics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiers.map((t, idx) => (
          <div
            key={t.tier}
            className={`bg-white border rounded-xl p-4 shadow-sm flex flex-col justify-between ${
              idx === 3 ? 'border-[#1E3A8A]/40 bg-slate-50/50' : 'border-[#EAE4D5]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.tier}</span>
                <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                  {t.lossPercent}% variance
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#111311] mt-2">{t.name}</h3>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <span>{t.scope}</span>
              </div>

              <div className="mt-4 p-3 rounded-lg bg-white border border-[#EAE4D5] flex items-center justify-between">
                <span className="text-xs text-slate-600 font-medium">Shrinkage Volume</span>
                <span className="text-base font-mono font-bold text-[#111311]">
                  {t.lossLiters.toLocaleString()} L
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#EAE4D5] text-xs text-slate-600 leading-relaxed">
              {t.details}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
