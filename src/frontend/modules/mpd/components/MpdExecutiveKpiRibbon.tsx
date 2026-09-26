'use client';

import React from 'react';
import { Droplet, Truck, ShieldAlert, Layers, Building2 } from 'lucide-react';
import type { MpdSummary } from '../types';

interface MpdExecutiveKpiRibbonProps {
  summary: MpdSummary;
  isLoading?: boolean;
}

export const MpdExecutiveKpiRibbon: React.FC<MpdExecutiveKpiRibbonProps> = ({ summary, isLoading }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {/* 1. Total Division Intake */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Intake</span>
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1E3A8A]">
            <Droplet className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold font-mono text-[#111311]">
            {isLoading ? '...' : `${summary.totalIntakeLiters.toLocaleString()} L`}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Fat: <strong className="font-mono text-slate-700">{summary.weightedFatPercent}%</strong></span>
            <span>•</span>
            <span>LR: <strong className="font-mono text-slate-700">{summary.weightedLr}</strong></span>
          </div>
        </div>
      </div>

      {/* 2. Standardized 13% TS */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">13% TS Equivalent</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold font-mono text-[#111311]">
            {isLoading ? '...' : `${summary.standardized13TsLiters.toLocaleString()} L`}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Solid Solids equivalent base
          </div>
        </div>
      </div>

      {/* 3. In-Transit Volume */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active In-Transit</span>
          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700">
            <Truck className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold font-mono text-[#111311]">
            {isLoading ? '...' : `${summary.inTransitLiters.toLocaleString()} L`}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            <strong className="font-mono text-slate-700">{summary.inTransitTankerCount}</strong> tankers en route to Plant
          </div>
        </div>
      </div>

      {/* 4. Supply Chain Loss Rate */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Supply Chain Loss</span>
          <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-700">
            <ShieldAlert className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold font-mono text-[#111311]">
            {isLoading ? '...' : `${summary.supplyChainLossPercent}%`}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Net: <strong className="font-mono text-slate-700">{summary.supplyChainLossLiters.toLocaleString()} L</strong> across 4 tiers
          </div>
        </div>
      </div>

      {/* 5. Active Supply Nodes */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Supply Nodes</span>
          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
            <Building2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold font-mono text-[#111311]">
            {isLoading ? '...' : `${summary.activeZmccCount + summary.activeContractorCount}`}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            <strong className="font-mono text-slate-700">{summary.activeZmccCount}</strong> ZMCCs • <strong className="font-mono text-slate-700">{summary.activeContractorCount}</strong> Plant Contractors
          </div>
        </div>
      </div>
    </div>
  );
};
