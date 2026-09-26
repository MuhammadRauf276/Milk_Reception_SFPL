'use client';

import React from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle2, FlaskConical, Filter } from 'lucide-react';
import type { QualityFunnelTelemetry } from '../types';

interface MpdQualityScreenProps {
  qualityFunnel: QualityFunnelTelemetry;
}

export const MpdQualityScreen: React.FC<MpdQualityScreenProps> = ({ qualityFunnel }) => {
  return (
    <div className="space-y-6">
      {/* 3-Station Rejection Funnel Cards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-[#1E3A8A]" />
          <h2 className="text-xs font-bold text-[#111311] uppercase tracking-wider">
            Upstream 3-Station Quality Screening Funnel
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Station 1: Village Shops */}
          <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase">Station 1 • Village Shops</span>
              <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                MOT / Shop Test
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold font-mono text-[#111311]">
                {qualityFunnel.villageShopRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Rejection Rate:</span>
                <span className="font-mono font-bold text-amber-700">
                  {qualityFunnel.villageShopRejectionPercent}%
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[#EAE4D5] text-xs text-slate-600">
              Rejected at local supplier source before pouring into MOT van cans or drums.
            </div>
          </div>

          {/* Station 2: ZMCC Gate */}
          <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase">Station 2 • ZMCC Reception</span>
              <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                Lab Attendant
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold font-mono text-[#111311]">
                {qualityFunnel.zmccGateRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Rejection Rate:</span>
                <span className="font-mono font-bold text-amber-700">
                  {qualityFunnel.zmccGateRejectionPercent}%
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[#EAE4D5] text-xs text-slate-600">
              Rejected at chilling center gate before mixing into bulk chilling silos.
            </div>
          </div>

          {/* Station 3: Plant Reception */}
          <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase">Station 3 • Plant Reception</span>
              <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                Plant QA Lab
              </span>
            </div>
            <div className="mt-4">
              <div className="text-2xl font-bold font-mono text-emerald-700">
                {qualityFunnel.plantGateRejectedLiters.toLocaleString()} L
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">Plant Rejection:</span>
                <span className="font-mono font-bold text-emerald-700">
                  {qualityFunnel.plantGateRejectionPercent}% (Zero Spill)
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-[#EAE4D5] text-xs text-slate-600">
              Protected by upstream screening. Zero contaminated milk reached Plant silos.
            </div>
          </div>
        </div>
      </div>

      {/* Live Adulterant & Contaminant Incident Board */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#EAE4D5]">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
            <h2 className="text-xs font-bold text-[#111311] uppercase tracking-wider">
              Today's Adulteration & Spoilage Incidents Log
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500">
            Real-time automated chemical strip & lactometer flags
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-lg border border-[#EAE4D5] bg-[#FDFBF9]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Formalin (Preservative)</span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="mt-2 text-xl font-mono font-bold text-slate-800">
              {qualityFunnel.incidents.formalinCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Strict zero tolerance</div>
          </div>

          <div className="p-3.5 rounded-lg border border-[#EAE4D5] bg-[#FDFBF9]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Urea / Synthetic Fat</span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="mt-2 text-xl font-mono font-bold text-slate-800">
              {qualityFunnel.incidents.ureaCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Zero contamination</div>
          </div>

          <div className="p-3.5 rounded-lg border border-[#EAE4D5] bg-[#FDFBF9]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Added Water (Low LR &lt; 26)</span>
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            </div>
            <div className="mt-2 text-xl font-mono font-bold text-amber-700">
              {qualityFunnel.incidents.waterLowLrCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Diverted/Penalized at shop</div>
          </div>

          <div className="p-3.5 rounded-lg border border-[#EAE4D5] bg-[#FDFBF9]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">COB Positive / High Acidity</span>
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            </div>
            <div className="mt-2 text-xl font-mono font-bold text-amber-700">
              {qualityFunnel.incidents.cobPositiveCount} flags
            </div>
            <div className="mt-1 text-xs text-slate-500">Heat stability test failed</div>
          </div>
        </div>
      </div>
    </div>
  );
};
