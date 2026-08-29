'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  ContractorVehicleVisit,
  ContractorHistoryMetrics,
} from './contractorManagerTypes';
import {
  buildContractorVehicleVisits,
  computeContractorHistoryMetrics,
} from './contractorManagerHelpers';
import {
  History,
  Calendar,
  Search,
  Filter,
  RefreshCw,
  Receipt,
  Scale,
  ArrowRightLeft,
  Truck,
  Building2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';

interface ContractorHistoryReportsProps {
  initialLogs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
}

export const ContractorHistoryReports: React.FC<ContractorHistoryReportsProps> = ({
  initialLogs,
  serverBusinessDate,
  assignedSourceName,
}) => {
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [logs, setLogs] = useState<MilkProcessLog[]>(initialLogs);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistoryLogs = useCallback(async (fDate?: string, tDate?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('dateBasis', 'reporting');
      if (fDate) params.set('fromDate', fDate);
      if (tDate) params.set('toDate', tDate);

      const res = await fetch(`/api/logs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch history logs');
      }
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load historical contractor records');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromDate && toDate && fromDate > toDate) {
      setError('From Date cannot be after To Date.');
      return;
    }
    fetchHistoryLogs(fromDate || undefined, toDate || undefined);
  };

  const handleResetFilter = () => {
    setFromDate('');
    setToDate('');
    setError(null);
    fetchHistoryLogs(undefined, undefined);
  };

  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorHistoryMetrics = useMemo(() => {
    return computeContractorHistoryMetrics(visits);
  }, [visits]);

  // Local vehicle search filter
  const filteredVisits = useMemo(() => {
    return visits.filter((v) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchVeh = v.vehicleNumber.toLowerCase().includes(q);
      const matchRec = v.receptionNumber.toLowerCase().includes(q);
      const matchTok = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
      return matchVeh || matchRec || matchTok;
    });
  }, [visits, searchQuery]);

  return (
    <div className="space-y-6">
      {/* 1. Header Scope Banner */}
      <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-900 text-white rounded-xl shadow-sm">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 leading-tight">
              {assignedSourceName} — History & Operational Reports
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Historical ledger evaluated by Reporting Business Date (Final Receipt date for completed receipts; Visit date for pending).
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-700 self-start sm:self-auto">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <span>Reporting Date Scoped</span>
        </div>
      </div>

      {/* 2. Date Filter Toolbar */}
      <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-4">
        <form onSubmit={handleApplyFilter} className="flex flex-wrap items-end gap-3">
          {/* From Date */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              From Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 min-h-[40px] text-xs font-mono font-bold bg-slate-50 border border-[#C4B9A3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
          </div>

          {/* To Date */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              To Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 min-h-[40px] text-xs font-mono font-bold bg-slate-50 border border-[#C4B9A3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
          </div>

          {/* Search Box */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Search Vehicle / Token
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-3 py-2 min-h-[40px] text-xs font-mono font-bold bg-slate-50 border border-[#C4B9A3] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-900"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 min-h-[40px] bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-bold shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center space-x-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Apply Filter</span>
            </button>

            <button
              type="button"
              onClick={handleResetFilter}
              disabled={loading}
              className="px-4 py-2 min-h-[40px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition active:scale-95 disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </form>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 3. Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Historical Visits */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span>Historical Visits</span>
            <Truck className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-3xl font-black text-slate-900 font-mono">
            {metrics.totalHistoryVisits}
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Dispatched: <strong className="text-slate-700 font-mono">{metrics.totalDispatchedGrossLiters.toLocaleString()} L</strong>
          </p>
        </div>

        {/* Completed Receipts */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-bold">
            <span>Final Receipts</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-950 font-mono">
            {metrics.totalCompletedReceipts}
          </p>
          <p className="text-[11px] text-emerald-700 font-medium">
            Posted Silo transactions
          </p>
        </div>

        {/* Total Received Liters */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-blue-800 text-xs font-bold">
            <span>Total Received Vol</span>
            <Scale className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-2xl font-black text-blue-950 font-mono truncate">
            {metrics.totalReceivedLiters.toLocaleString()} L
          </p>
          <p className="text-[11px] text-blue-700 font-medium">
            Authoritative physical volume
          </p>
        </div>

        {/* Net Liters Variance */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-700 text-xs font-bold">
            <span>Net Liters Variance</span>
            <ArrowRightLeft className="w-4 h-4 text-slate-600" />
          </div>
          <p
            className={`text-2xl font-black font-mono truncate ${
              metrics.netLitersVariance == null
                ? 'text-slate-500'
                : metrics.netLitersVariance < 0
                ? 'text-rose-700'
                : metrics.netLitersVariance > 0
                ? 'text-emerald-700'
                : 'text-slate-800'
            }`}
          >
            {metrics.netLitersVariance != null
              ? `${metrics.netLitersVariance > 0 ? '+' : ''}${metrics.netLitersVariance.toLocaleString()} L`
              : '—'}
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Received vs Dispatched (L)
          </p>
        </div>
      </div>

      {/* 4. Historical Ledger Table */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#F0EAE1] pb-3">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-blue-800" />
            <h3 className="text-sm font-extrabold text-slate-900">Historical Dispatches & Receipts</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono font-bold">
            {filteredVisits.length} {filteredVisits.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs font-bold text-slate-500 flex flex-col items-center justify-center space-y-2">
            <RefreshCw className="w-5 h-5 text-blue-700 animate-spin" />
            <span>Loading historical records...</span>
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="py-12 px-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
            <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">No Historical Records Found</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              No historical records are available for the selected date range and assigned Plant Contractor.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider bg-slate-50/70">
                  <th className="py-2.5 px-3">Vehicle</th>
                  <th className="py-2.5 px-3">Reception #</th>
                  <th className="py-2.5 px-3">Reporting Business Date</th>
                  <th className="py-2.5 px-3 text-right">Dispatch Gross</th>
                  <th className="py-2.5 px-3">QA Outcome</th>
                  <th className="py-2.5 px-3">Lifecycle / Receipt</th>
                  <th className="py-2.5 px-3 text-right">Authoritative Received</th>
                  <th className="py-2.5 px-3 text-right">Variance (L)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredVisits.map((v) => (
                  <tr key={v.visitId} className="hover:bg-slate-50/80 transition">
                    <td className="py-3.5 px-3 font-mono font-extrabold text-slate-900">
                      {v.vehicleNumber}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-600 text-[11px]">
                      {v.receptionNumber}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-800 text-[11px]">
                      <div>
                        <span className="font-bold">{v.reportingBusinessDate || '—'}</span>
                        <span className="block text-[9px] text-slate-500 font-normal">
                          {v.finalReceiptExists ? 'Receipt Business Date' : 'Visit Business Date'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900">
                      {v.grossLiters != null ? `${v.grossLiters.toLocaleString()} L` : '—'}
                    </td>
                    <td className="py-3.5 px-3">
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
                    <td className="py-3.5 px-3">
                      {v.finalReceiptExists ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Final Receipt
                        </span>
                      ) : v.secondWeightTimestamp ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          Receipt Pending
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {v.journeyStageLabel}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-black">
                      {v.finalReceiptExists && v.authoritativeFinalLiters != null ? (
                        <span className="text-emerald-700">
                          {v.authoritativeFinalLiters.toLocaleString()} L
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">Pending</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold">
                      {v.litersVariance != null ? (
                        <span
                          className={
                            v.litersVariance < 0
                              ? 'text-rose-700'
                              : v.litersVariance > 0
                              ? 'text-emerald-700'
                              : 'text-slate-700'
                          }
                        >
                          {v.litersVariance > 0 ? '+' : ''}
                          {v.litersVariance.toLocaleString()} L
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">—</span>
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
