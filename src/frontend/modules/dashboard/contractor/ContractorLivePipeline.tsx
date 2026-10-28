'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import { buildContractorVehicleVisits } from './contractorManagerHelpers';
import {
  Truck,
  Search,
  Filter,
  ShieldCheck,
  Scale,
  FlaskConical,
  Building2,
  Receipt,
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
      <div className="bg-card border-border p-6 rounded-xl border text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-semibold text-rose-900">Failed to load pipeline</h4>
        <p className="text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border-border p-5 rounded-xl border shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full pl-9 pr-4 py-2.5 min-h-[44px] text-xs tabular-nums font-semibold bg-slate-50 border border-border-strong rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-900"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 mr-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Stage:</span>
          </span>

          <button
            type="button"
            onClick={() => setStageFilter('ALL_ACTIVE')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'ALL_ACTIVE'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({activeVisits.length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('GATE')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'GATE'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Security ({activeVisits.filter((v) => v.journeyStage === 'GATE_ENTRY').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('QA')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'QA'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            QA ({activeVisits.filter((v) => v.journeyStage === 'PLANT_QA').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('SCALE')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'SCALE'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Scale ({activeVisits.filter((v) => v.journeyStage === 'WEIGHBRIDGE_GROSS').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('UNLOADING')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'UNLOADING'
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Unloading ({activeVisits.filter((v) => v.journeyStage === 'UNLOADING').length})
          </button>

          <button
            type="button"
            onClick={() => setStageFilter('RECEIPT_PENDING')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
              stageFilter === 'RECEIPT_PENDING'
                ? 'bg-amber-900 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Pending ({activeVisits.filter((v) => v.journeyStage === 'RECEIPT_PENDING').length})
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="bg-card border-border py-16 text-center text-xs font-semibold text-slate-500 rounded-xl border shadow-xs">
            Loading active pipeline visits…
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="bg-card border-border py-16 px-4 rounded-xl border border-dashed text-center space-y-2 shadow-xs">
            <Truck className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-sm font-semibold text-slate-700">No Active Tankers in Pipeline</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No active tankers
            </p>
          </div>
        ) : (
          filteredVisits.map((v) => (
            <div
              key={v.visitId}
              className="p-5 sm:p-6 rounded-xl bg-white border border-border shadow-xs space-y-4 hover:border-blue-300 transition"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-blue-50 text-blue-900 rounded-xl">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-semibold text-slate-900 tabular-nums tracking-tight">
                        {v.vehicleNumber}
                      </h3>
                      {v.tokenNumber && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] tabular-nums font-semibold border border-slate-200">
                          Token: {v.tokenNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium">
                      Reception #{' '}
                      <strong className="tabular-nums text-slate-700">{v.receptionNumber}</strong> · Date:{' '}
                      <strong className="tabular-nums text-slate-700">{v.operationalDate || '—'}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 self-start sm:self-auto">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold ${
                      v.journeyStage === 'RECEIPT_PENDING'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : v.journeyStage === 'UNLOADING'
                        ? 'bg-blue-100 text-blue-900 border border-blue-300'
                        : v.journeyStage === 'WEIGHBRIDGE_GROSS'
                        ? 'bg-blue-100 text-blue-900 border border-blue-300'
                        : v.journeyStage === 'PLANT_QA'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : v.journeyStage === 'GATE_ENTRY'
                        ? 'bg-blue-50 text-blue-900 border border-blue-200'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {v.journeyStageLabel}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-center text-[11px]">
                <div
                  className={`p-2.5 rounded-xl border ${
                    v.gateEntryTimestamp
                      ? 'bg-card border-border text-emerald-800'
                      : 'bg-card border-border text-slate-400'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-semibold block">1. Security Gate</span>
                  <span className="text-[10px] tabular-nums">
                    {v.gateEntryTimestamp ? 'Arrived' : 'Pending'}
                  </span>
                </div>

                <div
                  className={`p-2.5 rounded-xl border ${
                    v.qaSummary.totalPortions > 0 && v.qaSummary.badgeType !== 'ALL_PENDING'
                      ? 'bg-card border-border text-emerald-800'
                      : v.journeyStage === 'PLANT_QA'
                      ? 'bg-card border-border text-amber-800'
                      : 'bg-card border-border text-slate-400'
                  }`}
                >
                  <FlaskConical className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-semibold block">2. QA Lab</span>
                  <span className="text-[10px] tabular-nums truncate block">
                    {v.qaSummary.summaryText}
                  </span>
                </div>

                <div
                  className={`p-2.5 rounded-xl border ${
                    v.firstWeightTimestamp
                      ? 'bg-card border-border text-emerald-800'
                      : 'bg-card border-border text-slate-400'
                  }`}
                >
                  <Scale className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-semibold block">3. 1st Weight</span>
                  <span className="text-[10px] tabular-nums">
                    {v.firstWeightKg ? `${v.firstWeightKg.toLocaleString()} kg` : 'Pending'}
                  </span>
                </div>

                <div
                  className={`p-2.5 rounded-xl border ${
                    v.unloadingEndTimestamp
                      ? 'bg-card border-border text-emerald-800'
                      : v.journeyStage === 'UNLOADING'
                      ? 'bg-card border-border text-blue-800'
                      : 'bg-card border-border text-slate-400'
                  }`}
                >
                  <Building2 className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-semibold block">4. Silo Unload</span>
                  <span className="text-[10px] tabular-nums">
                    {v.unloadingEndTimestamp ? 'Completed' : 'In Progress'}
                  </span>
                </div>

                <div
                  className={`p-2.5 rounded-xl border col-span-2 sm:col-span-1 ${
                    v.finalReceiptExists
                      ? 'bg-card border-border text-emerald-800'
                      : v.journeyStage === 'RECEIPT_PENDING'
                      ? 'bg-card border-border text-amber-800'
                      : 'bg-card border-border text-slate-400'
                  }`}
                >
                  <Receipt className="w-4 h-4 mx-auto mb-1 text-inherit" />
                  <span className="font-semibold block">5. Final Receipt</span>
                  <span className="text-[10px] tabular-nums font-semibold">
                    {v.finalReceiptExists && v.authoritativeFinalLiters != null
                      ? `${v.authoritativeFinalLiters.toLocaleString()} L`
                      : v.journeyStage === 'RECEIPT_PENDING'
                      ? 'Pending Receipt'
                      : 'Awaiting Scale 2'}
                  </span>
                </div>
              </div>

              <div className="bg-card border-border p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 font-semibold">Whole Vehicle Gross:</span>
                  <span className="tabular-nums font-semibold text-slate-900">
                    {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                  </span>
                </div>

                {v.netWeightKg != null && (
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-500 font-semibold">Scale Net Weight:</span>
                    <span className="tabular-nums font-semibold text-slate-800">
                      {v.netWeightKg.toLocaleString()} kg
                    </span>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <span className="text-slate-500 font-semibold">Authoritative Receipt:</span>
                  <span
                    className={`tabular-nums font-semibold ${
                      v.finalReceiptExists && v.authoritativeFinalLiters != null
                        ? 'text-emerald-700'
                        : 'text-amber-700'
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
