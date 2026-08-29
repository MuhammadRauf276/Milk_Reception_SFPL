'use client';

import React, { useState, useMemo } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  ContractorVehicleVisit,
  ContractorReceiptsMetrics,
} from './contractorManagerTypes';
import {
  buildContractorVehicleVisits,
  computeContractorReceiptsMetrics,
} from './contractorManagerHelpers';
import {
  Receipt,
  CheckCircle2,
  Clock,
  Scale,
  ArrowRightLeft,
  Search,
  Filter,
  ShieldCheck,
  Building2,
  FileSpreadsheet,
  AlertCircle,
  Truck,
  Factory,
} from 'lucide-react';

interface ContractorReceiptsReconciliationProps {
  logs: MilkProcessLog[];
  serverBusinessDate: string;
  assignedSourceName: string;
  isLoading?: boolean;
  error?: string | null;
}

type ReceiptFilterType = 'ALL' | 'FINAL_RECEIPT' | 'RECEIPT_PENDING' | 'BEFORE_RECEIPT';

export const ContractorReceiptsReconciliation: React.FC<ContractorReceiptsReconciliationProps> = ({
  logs,
  serverBusinessDate,
  assignedSourceName,
  isLoading = false,
  error = null,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilterType>('ALL');

  const visits = useMemo(() => {
    return buildContractorVehicleVisits(logs);
  }, [logs]);

  const metrics: ContractorReceiptsMetrics = useMemo(() => {
    return computeContractorReceiptsMetrics(visits);
  }, [visits]);

  // Filtered visits
  const filteredVisits = useMemo(() => {
    return visits.filter((v) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchVeh = v.vehicleNumber.toLowerCase().includes(q);
        const matchRec = v.receptionNumber.toLowerCase().includes(q);
        const matchTok = v.tokenNumber ? v.tokenNumber.toLowerCase().includes(q) : false;
        if (!matchVeh && !matchRec && !matchTok) return false;
      }

      // 2. Receipt Status Filter
      if (receiptFilter === 'ALL') return true;
      if (receiptFilter === 'FINAL_RECEIPT') return v.finalReceiptExists;
      if (receiptFilter === 'RECEIPT_PENDING')
        return Boolean(v.secondWeightTimestamp && !v.finalReceiptExists);
      if (receiptFilter === 'BEFORE_RECEIPT')
        return !v.finalReceiptExists && !v.secondWeightTimestamp;

      return true;
    });
  }, [visits, searchQuery, receiptFilter]);

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
        <h4 className="text-sm font-bold text-rose-900">Failed to Load Receipts & Reconciliation</h4>
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
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 leading-tight">
              {assignedSourceName} — Receipts & Reconciliation
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Authoritative Silo receipts and volumetric reconciliation for Business Date:{' '}
              <strong className="text-slate-700 font-mono">{serverBusinessDate || 'Live'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-700 self-start sm:self-auto">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <span>Silo Transaction Authority</span>
        </div>
      </div>

      {/* 2. Four Summary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Authoritative Final Receipts */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-emerald-700 text-xs font-bold">
            <span>Final Receipts</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-950 font-mono">
            {metrics.totalReceiptsCount}
          </p>
          <p className="text-[11px] text-emerald-700 font-medium">
            Posted Silo transactions
          </p>
        </div>

        {/* Receipt Pending */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-purple-700 text-xs font-bold">
            <span>Receipt Pending</span>
            <Clock className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-3xl font-black text-purple-950 font-mono">
            {metrics.receiptPendingCount}
          </p>
          <p className="text-[11px] text-purple-700 font-medium">
            2nd weight done · Awaiting Silo
          </p>
        </div>

        {/* Received Liters */}
        <div className="p-5 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-blue-800 text-xs font-bold">
            <span>Total Received Vol</span>
            <Scale className="w-4 h-4 text-blue-700" />
          </div>
          <p className="text-2xl font-black text-blue-950 font-mono truncate">
            {metrics.totalAuthoritativeReceivedLiters.toLocaleString()} L
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
              metrics.totalLitersVariance == null
                ? 'text-slate-500'
                : metrics.totalLitersVariance < 0
                ? 'text-rose-700'
                : metrics.totalLitersVariance > 0
                ? 'text-emerald-700'
                : 'text-slate-800'
            }`}
          >
            {metrics.totalLitersVariance != null
              ? `${metrics.totalLitersVariance > 0 ? '+' : ''}${metrics.totalLitersVariance.toLocaleString()} L`
              : '—'}
          </p>
          <p className="text-[11px] text-slate-500 font-medium">
            Received vs Dispatched (L)
          </p>
        </div>
      </div>

      {/* 3. Search & Filter Controls */}
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

        {/* Receipt Status Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Status:</span>
          </span>

          <button
            type="button"
            onClick={() => setReceiptFilter('ALL')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'ALL'
                ? 'bg-blue-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All ({visits.length})
          </button>

          <button
            type="button"
            onClick={() => setReceiptFilter('FINAL_RECEIPT')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'FINAL_RECEIPT'
                ? 'bg-emerald-800 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Final Receipt ({metrics.totalReceiptsCount})
          </button>

          <button
            type="button"
            onClick={() => setReceiptFilter('RECEIPT_PENDING')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'RECEIPT_PENDING'
                ? 'bg-purple-900 text-white shadow-sm'
                : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
            }`}
          >
            Receipt Pending ({metrics.receiptPendingCount})
          </button>

          <button
            type="button"
            onClick={() => setReceiptFilter('BEFORE_RECEIPT')}
            className={`px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-bold whitespace-nowrap transition shrink-0 ${
              receiptFilter === 'BEFORE_RECEIPT'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Before Receipt ({visits.filter((v) => !v.finalReceiptExists && !v.secondWeightTimestamp).length})
          </button>
        </div>
      </div>

      {/* 4. Receipts & Reconciliation Table */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-[#EAE4D5] shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[#F0EAE1] pb-3">
          <div className="flex items-center space-x-2">
            <Receipt className="w-4 h-4 text-blue-800" />
            <h3 className="text-sm font-extrabold text-slate-900">Vehicle Receipts Ledger</h3>
          </div>
          <span className="text-xs text-slate-500 font-mono font-bold">
            {filteredVisits.length} {filteredVisits.length === 1 ? 'vehicle' : 'vehicles'}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs font-bold text-slate-500">
            Loading receipt records...
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="py-12 px-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center space-y-2">
            <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">No Receipt Records</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              No receipt records are available for your assigned Plant Contractor.
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
                  <th className="py-2.5 px-3 text-right">Dispatch Gross</th>
                  <th className="py-2.5 px-3 text-right">Scale Net (kg)</th>
                  <th className="py-2.5 px-3">Destination Silo</th>
                  <th className="py-2.5 px-3">Receipt Status</th>
                  <th className="py-2.5 px-3 text-right">Authoritative Received</th>
                  <th className="py-2.5 px-3 text-right">Liters Variance</th>
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
                    <td className="py-3.5 px-3 text-slate-600 font-mono text-[11px]">
                      {v.operationalDate || '—'}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900">
                      {v.grossLiters ? `${v.grossLiters.toLocaleString()} L` : '—'}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono text-slate-700 text-[11px]">
                      {v.netWeightKg != null ? `${v.netWeightKg.toLocaleString()} kg` : '—'}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-700 text-[11px]">
                      {v.siloStorageId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 font-bold">
                          <Factory className="w-3 h-3 text-blue-700" />
                          <span>{v.siloStorageId}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3.5 px-3">
                      {v.finalReceiptExists ? (
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Final Receipt
                          </span>
                          {v.finalReceiptTransactionId && (
                            <span className="block text-[9px] font-mono text-slate-400 mt-0.5">
                              Tx #{v.finalReceiptTransactionId}
                            </span>
                          )}
                        </div>
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
