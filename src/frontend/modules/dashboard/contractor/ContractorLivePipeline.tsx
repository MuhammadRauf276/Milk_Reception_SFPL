'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  ContractorVehicleVisit,
  ContractorJourneyStage,
} from './contractorManagerTypes';
import { buildContractorVehicleVisits } from './contractorManagerHelpers';
import {
  Truck,
  Search,
  Filter,
  Clock,
  ShieldCheck,
  Scale,
  FlaskConical,
  Factory,
  Receipt,
  FileSpreadsheet,
  AlertCircle,
} from 'lucide-react';

interface ContractorLivePipelineProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
}

type LiveStageFilter = 'ALL_ACTIVE' | 'GATE' | 'QA' | 'SCALE' | 'UNLOADING' | 'RECEIPT_PENDING';

export const ContractorLivePipeline: React.FC<ContractorLivePipelineProps> = ({
  logs,
  assignedSourceName,
  isLoading = false,
  error = null,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<LiveStageFilter>('ALL_ACTIVE');

  const allVisits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  // Active visits (in-plant or active pipeline, not fully completed)
  const activeVisits = useMemo(() => {
    return allVisits.filter((v) => !v.finalReceiptExists && v.status !== 'CANCELLED');
  }, [allVisits]);

  // Filtered active visits
  const filteredVisits = useMemo(() => {
    return activeVisits.filter((v) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchVehicle = v.vehicleNumber.toLowerCase().includes(q);
        const matchToken = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
        const matchRec = v.receptionNumber.toLowerCase().includes(q);
        if (!matchVehicle && !matchToken && !matchRec) return false;
      }

      // 2. Stage Filter
      if (stageFilter === 'ALL_ACTIVE') return true;
      if (stageFilter === 'GATE') return v.journeyStage === 'GATE_ENTRY';
      if (stageFilter === 'QA') return v.journeyStage === 'PLANT_QA';
      if (stageFilter === 'SCALE') return v.journeyStage === 'WEIGHBRIDGE_GROSS';
      if (stageFilter === 'UNLOADING') return v.journeyStage === 'UNLOADING';
      if (stageFilter === 'RECEIPT_PENDING') return v.journeyStage === 'RECEIPT_PENDING';

      return true;
    });
  }, [activeVisits, searchQuery, stageFilter]);

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-bold text-rose-900">Failed to Load Live Pipeline</h4>
        <p className="text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Filter & Search Controls */}
      <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vehicle, token, reception..."
            className="w-full pl-9 pr-4 py-2.5 min-h-[44px] text-xs font-mono font-bold bg-slate-50 border border-[#C4B9A3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
          />
        </div>

        {/* Stage Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Stage:</span>
          </span>

          <button
            type="button"
            onClick={() => setStageFilter('ALL_ACTIVE')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'ALL_ACTIVE'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Active ({activeVisits.length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('GATE')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'GATE'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Security ({activeVisits.filter((v) => v.journeyStage === 'GATE_ENTRY').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('QA')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'QA'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            QA ({activeVisits.filter((v) => v.journeyStage === 'PLANT_QA').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('SCALE')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'SCALE'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Scale ({activeVisits.filter((v) => v.journeyStage === 'WEIGHBRIDGE_GROSS').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('UNLOADING')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'UNLOADING'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Unloading ({activeVisits.filter((v) => v.journeyStage === 'UNLOADING').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('RECEIPT_PENDING')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'RECEIPT_PENDING'
                ? 'bg-purple-900 text-white shadow-sm'
                : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
            }`}
          >
            Receipt Pending ({activeVisits.filter((v) => v.journeyStage === 'RECEIPT_PENDING').length})
          </button>
        </div>
      </div>

      {/* 2. Active Tanker Cards List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-16 text-center text-xs font-bold text-slate-500 bg-white rounded-2xl border border-[#EAE4D5] shadow-sm">
            Loading active pipeline visits...
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="py-16 px-4 rounded-2xl bg-white border border-dashed border-slate-200 text-center space-y-2 shadow-sm">
            <Truck className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">No Active Tankers in Pipeline</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              All dispatches for your assigned Plant Contractor have completed final receipting or no active tankers are currently in plant.
            </p>
          </div>
        ) : (
          filteredVisits.map((v) => (
            <div
              key={v.visitId}
              className="p-5 sm:p-6 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-4 hover:border-blue-300 transition"
            >
              {/* Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-blue-50 text-blue-900 rounded-xl">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-black text-slate-900 font-mono tracking-tight">
                        {v.vehicleNumber}
                      </h3>
                      {v.tokenNumber && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-mono font-extrabold border border-slate-200">
                          Token: {v.tokenNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                      Reception #{' '}
                      <strong className="font-mono text-slate-700">{v.receptionNumber}</strong> · Date:{' '}
                      <strong className="font-mono text-slate-700">{v.operationalDate || '—'}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 self-start sm:self-auto">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${
                      v.journeyStage === 'RECEIPT_PENDING'
                        ? 'bg-purple-100 text-purple-900 border border-purple-300'
                        : v.journeyStage === 'UNLOADING'
                        ? 'bg-blue-100 text-blue-900 border border-blue-300'
                        : v.journeyStage === 'WEIGHBRIDGE_GROSS'
                        ? 'bg-indigo-100 text-indigo-900 border border-indigo-300'
                        : v.journeyStage === 'PLANT_QA'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : v.journeyStage === 'GATE_ENTRY'
                        ? 'bg-cyan-100 text-cyan-900 border border-cyan-300'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {v.journeyStageLabel}
                  </span>
                </div>
              </div>

              {/* Journey Milestones Tracker Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-center text-[11px]">
                {/* 1. Gate */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    v.gateEntryTimestamp
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-bold block">1. Security Gate</span>
                  <span className="text-[10px] font-mono">
                    {v.gateEntryTimestamp ? 'Arrived' : 'Pending'}
                  </span>
                </div>

                {/* 2. QA */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    v.qaSummary.totalPortions > 0 && v.qaSummary.badgeType !== 'ALL_PENDING'
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : v.journeyStage === 'PLANT_QA'
                      ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <FlaskConical className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-bold block">2. QA Lab</span>
                  <span className="text-[10px] font-mono truncate block">
                    {v.qaSummary.summaryText}
                  </span>
                </div>

                {/* 3. Scale (Gross) */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    v.firstWeightTimestamp
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <Scale className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-bold block">3. 1st Weight</span>
                  <span className="text-[10px] font-mono">
                    {v.firstWeightKg ? `${v.firstWeightKg.toLocaleString()} kg` : 'Pending'}
                  </span>
                </div>

                {/* 4. Silo Unloading */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    v.unloadingEndTimestamp
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : v.journeyStage === 'UNLOADING'
                      ? 'bg-blue-50/70 border-blue-200 text-blue-900'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <Factory className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-bold block">4. Silo Unload</span>
                  <span className="text-[10px] font-mono">
                    {v.unloadingEndTimestamp ? 'Completed' : 'In Progress'}
                  </span>
                </div>

                {/* 5. Final Receipt */}
                <div
                  className={`p-2.5 rounded-xl border col-span-2 sm:col-span-1 ${
                    v.finalReceiptExists
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                      : v.journeyStage === 'RECEIPT_PENDING'
                      ? 'bg-purple-50/70 border-purple-200 text-purple-900'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <Receipt className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-bold block">5. Final Receipt</span>
                  <span className="text-[10px] font-mono font-bold">
                    {v.finalReceiptExists && v.authoritativeFinalLiters != null
                      ? `${v.authoritativeFinalLiters.toLocaleString()} L`
                      : v.journeyStage === 'RECEIPT_PENDING'
                      ? 'Pending Receipt'
                      : 'Awaiting Scale 2'}
                  </span>
                </div>
              </div>

              {/* Quantity Summary Row */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 font-bold">Whole Vehicle Gross:</span>
                  <span className="font-mono font-extrabold text-slate-900">
                    {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                  </span>
                </div>

                {v.netWeightKg != null && (
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500 font-bold">Scale Net Weight:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {v.netWeightKg.toLocaleString()} kg
                    </span>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 font-bold">Authoritative Receipt:</span>
                  <span
                    className={`font-mono font-extrabold ${
                      v.finalReceiptExists && v.authoritativeFinalLiters != null
                        ? 'text-emerald-700'
                        : 'text-purple-700'
                    }`}
                  >
                    {v.finalReceiptExists && v.authoritativeFinalLiters != null
                      ? `${v.authoritativeFinalLiters.toLocaleString()} L`
                      : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
