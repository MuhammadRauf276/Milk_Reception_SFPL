'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  ContractorVehicleVisit,
  ContractorQualityMetrics,
} from './contractorManagerTypes';
import {
  buildContractorVehicleVisits,
  computeContractorQualityMetrics,
  PLANT_LR_TEST_CODE,
  PLANT_FAT_TEST_CODE,
} from './contractorManagerHelpers';
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  ShieldCheck,
  Building2,
  FileSpreadsheet,
  AlertCircle,
  Truck,
} from 'lucide-react';

interface ContractorQualityRejectionsProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
}

type QADecisionFilter = 'ALL' | 'ACCEPTED' | 'REJECTED' | 'HOLD' | 'PENDING';

export const ContractorQualityRejections: React.FC<ContractorQualityRejectionsProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  isLoading = false,
  error = null,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [decisionFilter, setDecisionFilter] = useState<QADecisionFilter>('ALL');

  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorQualityMetrics = useMemo(() => {
    return computeContractorQualityMetrics(logs);
  }, [logs]);

  // Filter visits and their portions
  const filteredVisits = useMemo(() => {
    return visits
      .map((v) => {
        // Filter portions matching search & decision filter
        const matchingPortions = v.portions.filter((p) => {
          const st = String(p.calculated_status || 'PENDING').toUpperCase();
          if (decisionFilter === 'ALL') return true;
          if (decisionFilter === 'ACCEPTED') return st === 'ACCEPTED';
          if (decisionFilter === 'REJECTED') return st === 'REJECTED';
          if (decisionFilter === 'HOLD') return st === 'HOLD';
          if (decisionFilter === 'PENDING') return st === 'PENDING' || !p.calculated_status;
          return true;
        });

        // Search query over vehicle / reception / token
        let vehicleMatch = true;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchVeh = v.vehicleNumber.toLowerCase().includes(q);
          const matchRec = v.receptionNumber.toLowerCase().includes(q);
          const matchTok = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
          vehicleMatch = matchVeh || matchRec || matchTok;
        }

        if (!vehicleMatch || matchingPortions.length === 0) {
          return null;
        }

        return {
          ...v,
          visiblePortions: matchingPortions,
        };
      })
      .filter((v): v is (ContractorVehicleVisit & { visiblePortions: MilkProcessLog[] }) => v !== null);
  }, [visits, searchQuery, decisionFilter]);

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-bold text-rose-900">Failed to Load Quality & Rejections</h4>
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
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 leading-tight">
              {assignedSourceName} — Quality & Rejections Supervision
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Portion-wise laboratory testing & acceptance status for Business Date:{' '}
              <strong className="text-slate-700 font-mono">{serverBusinessDate || 'Live'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-700 self-start sm:self-auto">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <span>Portion-Wise Authority</span>
        </div>
      </div>

      {/* 2. Four Summary Portion Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Accepted Portions */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-bold">
            <span>Accepted Portions</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-950 font-mono">
            {metrics.acceptedPortions}
          </p>
          <p className="text-[11px] text-emerald-700 font-medium">
            Passed Plant QA criteria
          </p>
        </div>

        {/* Rejected Portions */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-rose-700 text-xs font-bold">
            <span>Rejected Portions</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-3xl font-black text-rose-950 font-mono">
            {metrics.rejectedPortions}
          </p>
          <p className="text-[11px] text-rose-700 font-medium">
            Failed Plant QA standards
          </p>
        </div>

        {/* Hold Portions */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-amber-700 text-xs font-bold">
            <span>Hold Portions</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-3xl font-black text-amber-950 font-mono">
            {metrics.holdPortions}
          </p>
          <p className="text-[11px] text-amber-700 font-medium">
            Under supervisory hold
          </p>
        </div>

        {/* Pending Portions */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-600 text-xs font-bold">
            <span>Pending Testing</span>
            <Clock className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-3xl font-black text-slate-900 font-mono">
            {metrics.pendingPortions}
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Awaiting lab evaluation
          </p>
        </div>
      </div>

      {/* 3. Search & Decision Filters */}
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

        {/* Decision Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Decision:</span>
          </span>

          <button
            type="button"
            onClick={() => setDecisionFilter('ALL')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'ALL'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({metrics.totalPortions} portions)
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('ACCEPTED')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'ACCEPTED'
                ? 'bg-emerald-800 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Accepted ({metrics.acceptedPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('REJECTED')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'REJECTED'
                ? 'bg-rose-800 text-white shadow-sm'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            Rejected ({metrics.rejectedPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('HOLD')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'HOLD'
                ? 'bg-amber-800 text-white shadow-sm'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Hold ({metrics.holdPortions})
          </button>

          <button
            type="button"
            onClick={() => setDecisionFilter('PENDING')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              decisionFilter === 'PENDING'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Pending ({metrics.pendingPortions})
          </button>
        </div>
      </div>

      {/* 4. Vehicle & Portion QA List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-16 text-center text-xs font-bold text-slate-500 bg-white rounded-2xl border border-[#EAE4D5] shadow-sm">
            Loading quality records...
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="py-16 px-4 rounded-2xl bg-white border border-dashed border-slate-200 text-center space-y-2 shadow-sm">
            <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">No Quality Records Found</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No quality records are available for the selected criteria or your assigned Plant Contractor.
            </p>
          </div>
        ) : (
          filteredVisits.map((v) => (
            <div
              key={v.visitId}
              className="p-5 sm:p-6 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-4"
            >
              {/* Vehicle Header Bar */}
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
                      <strong className="font-mono text-slate-700">{v.operationalDate || '—'}</strong> · Whole Vehicle Gross:{' '}
                      <strong className="font-mono text-slate-900">
                        {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                      </strong>
                    </p>
                  </div>
                </div>

                {/* Overall Summary Chip */}
                <div className="flex items-center space-x-2 self-start sm:self-auto">
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${
                      v.qaSummary.badgeType === 'ALL_ACCEPTED'
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : v.qaSummary.badgeType === 'ALL_REJECTED'
                        ? 'bg-rose-100 text-rose-900 border border-rose-300'
                        : v.qaSummary.badgeType === 'HAS_HOLD'
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-slate-100 text-slate-800 border border-slate-200'
                    }`}
                  >
                    {v.qaSummary.summaryText}
                  </span>
                </div>
              </div>

              {/* Portion QA Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider bg-slate-50/70">
                      <th className="py-2.5 px-3">Portion</th>
                      <th className="py-2.5 px-3">Portion Qty (Context)</th>
                      <th className="py-2.5 px-3">QA Decision</th>
                      <th className="py-2.5 px-3 text-right">Plant LR ({PLANT_LR_TEST_CODE})</th>
                      <th className="py-2.5 px-3 text-right">Plant Fat ({PLANT_FAT_TEST_CODE})</th>
                      <th className="py-2.5 px-3 text-right">SNF / TS</th>
                      <th className="py-2.5 px-3">Remarks / Reason</th>
                      <th className="py-2.5 px-3">Sampling Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {v.visiblePortions.map((p, idx) => {
                      const st = String(p.calculated_status || 'PENDING').toUpperCase();
                      return (
                        <tr key={p.portion_id || idx} className="hover:bg-slate-50/80 transition">
                          <td className="py-3 px-3 font-mono font-extrabold text-slate-900">
                            {p.portion_number}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600 text-[11px]">
                            {p.dispatch_liters_gross ? `${p.dispatch_liters_gross.toLocaleString()} L` : '—'}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                st === 'ACCEPTED'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : st === 'REJECTED'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : st === 'HOLD'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {st}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                            {p.sampling_lr != null ? p.sampling_lr.toFixed(1) : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                            {p.sampling_fat != null ? `${p.sampling_fat.toFixed(2)}%` : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-600 text-[11px]">
                            {p.computed_sampling_snf != null && p.computed_sampling_ts != null
                              ? `${p.computed_sampling_snf.toFixed(2)}% / ${p.computed_sampling_ts.toFixed(2)}%`
                              : '—'}
                          </td>
                          <td className="py-3 px-3 text-slate-600 text-xs">
                            {p.rejection_reasons || '—'}
                          </td>
                          <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                            {p.sampling_time_start || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
