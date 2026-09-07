'use client';

import React, { useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  ContractorVehicleVisit,
  ContractorOverviewMetrics,
} from './contractorManagerTypes';
import {
  buildContractorVehicleVisits,
  computeContractorOverview,
} from './contractorManagerHelpers';
import {
  Truck,
  Layers,
  Receipt,
  Scale,
  Building2,
  FileSpreadsheet,
  AlertCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';

interface ContractorOverviewProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
}

export const ContractorOverview: React.FC<ContractorOverviewProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  isLoading = false,
  error = null,
}) => {
  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorOverviewMetrics = useMemo(() => {
    return computeContractorOverview(visits);
  }, [visits]);

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-bold text-rose-900">Failed to Load Overview Data</h4>
        <p className="text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Scope Banner */}
      <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-900 text-white rounded-xl shadow-sm">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 leading-tight">
              {assignedSourceName} — Pipeline Overview
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Direct-to-Plant supply supervision for Business Date:{' '}
              <strong className="text-slate-700 font-mono">{serverBusinessDate || 'Live'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-700 self-start sm:self-auto">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <span>Server Source Scoped</span>
        </div>
      </div>

      {/* 2. Four Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Dispatches */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>Total Dispatches</span>
            <Truck className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-3xl font-black text-slate-900 font-mono">
            {metrics.totalDispatches}
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Gross Vol: <strong className="text-slate-700 font-mono">{metrics.totalGrossLiters.toLocaleString()} L</strong>
          </p>
        </div>

        {/* Active In-Plant */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-amber-700 text-xs font-bold">
            <span>Active In-Plant</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-3xl font-black text-amber-950 font-mono">
            {metrics.activeInPlantCount}
          </p>
          <p className="text-[11px] text-amber-700 font-medium">
            Gate, Lab, Scale, or Silo
          </p>
        </div>

        {/* Completed Receipts */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-bold">
            <span>Authoritative Receipts</span>
            <Receipt className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-950 font-mono">
            {metrics.completedReceiptsCount}
          </p>
          <p className="text-[11px] text-emerald-700 font-medium">
            Verified Silo Receipts
          </p>
        </div>

        {/* Received Liters */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-blue-800 text-xs font-bold">
            <span>Received Liters</span>
            <Scale className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-2xl font-black text-blue-950 font-mono truncate">
            {metrics.totalReceivedLiters.toLocaleString()} L
          </p>
          <p className="text-[11px] text-blue-700 font-medium">
            Silo Transaction Volume
          </p>
        </div>
      </div>

      {/* 3. Recent Dispatches / Activity Table */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#F0EAE1] pb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-blue-800" />
            <h3 className="text-sm font-extrabold text-slate-900">Recent Plant Dispatches</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono font-bold">
            {visits.length} {visits.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs font-bold text-slate-500">
            Loading recent records...
          </div>
        ) : visits.length === 0 ? (
          <div className="py-12 px-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
            <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">No Operational Records</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              No operational records are available for your assigned Plant Contractor.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider bg-slate-50/70">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Reception #</th>
                  <th className="py-2.5 px-3">Business Date</th>
                  <th className="py-2.5 px-3 text-right">Gross Liters</th>
                  <th className="py-2.5 px-3">Journey Stage</th>
                  <th className="py-2.5 px-3">QA Status</th>
                  <th className="py-2.5 px-3 text-right">Final Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {visits.slice(0, 10).map((v) => (
                  <tr key={v.visitId} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3 font-mono font-extrabold text-slate-900">
                      {v.vehicleNumber}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600 text-[11px]">
                      {v.receptionNumber}
                    </td>
                    <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">
                      {v.operationalDate || '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                      {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          v.journeyStage === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : v.journeyStage === 'RECEIPT_PENDING'
                            ? 'bg-purple-100 text-purple-800'
                            : v.journeyStage === 'UNLOADING'
                            ? 'bg-blue-100 text-blue-800'
                            : v.journeyStage === 'WEIGHBRIDGE_GROSS'
                            ? 'bg-indigo-100 text-indigo-800'
                            : v.journeyStage === 'PLANT_QA'
                            ? 'bg-amber-100 text-amber-800'
                            : v.journeyStage === 'GATE_ENTRY'
                            ? 'bg-cyan-100 text-cyan-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {v.journeyStageLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          v.qaSummary.badgeType === 'ALL_ACCEPTED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : v.qaSummary.badgeType === 'ALL_REJECTED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : v.qaSummary.badgeType === 'HAS_HOLD'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-50 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {v.qaSummary.summaryText}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      {v.finalReceiptExists && v.authoritativeFinalLiters != null ? (
                        <span className="text-emerald-700">
                          {v.authoritativeFinalLiters.toLocaleString()} L
                        </span>
                      ) : (
                        <span className="text-slate-400">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
