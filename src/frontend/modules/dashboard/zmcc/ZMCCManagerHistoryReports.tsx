'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { MilkProcessLog } from '@backend/core/types';
import {
  HistoryLifecycleFilter,
  HistoryQAFilter,
  HistoryReceiptFilter,
} from './zmccManagerTypes';
import {
  buildVehicleVisitGroups,
  deriveHistoryTransactionItems,
  filterHistoryTransactionItems,
  generateHistoryCsv,
} from './zmccManagerHelpers';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import {
  History,
  Search,
  RefreshCw,
  AlertTriangle,
  Download,
  Printer,
  ExternalLink,
  FileSpreadsheet,
} from 'lucide-react';

interface ZMCCManagerHistoryReportsProps {
  logs: MilkProcessLog[];
  assignedSourceName: string;
  onInspectDetails: (log: MilkProcessLog) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  currentFromDate?: string;
  currentToDate?: string;
  onDateFilterChange?: (from: string | null, to: string | null) => void;
}

export const ZMCCManagerHistoryReports: React.FC<ZMCCManagerHistoryReportsProps> = ({
  logs,
  assignedSourceName,
  onInspectDetails,
  isLoading = false,
  error = null,
  onRetry,
  currentFromDate = '',
  currentToDate = '',
  onDateFilterChange,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lifecycleFilter, setLifecycleFilter] = useState<HistoryLifecycleFilter>('ALL');
  const [qaFilter, setQaFilter] = useState<HistoryQAFilter>('ALL');
  const [receiptFilter, setReceiptFilter] = useState<HistoryReceiptFilter>('ALL');

  // Build groups and derive history items
  const groups = useMemo(() => buildVehicleVisitGroups(logs), [logs]);
  const items = useMemo(() => deriveHistoryTransactionItems(groups), [groups]);

  // Filter items by search, lifecycle, QA, receipt, and Business Date range
  const filteredItems = useMemo(
    () =>
      filterHistoryTransactionItems(
        items,
        searchQuery,
        lifecycleFilter,
        qaFilter,
        receiptFilter,
        currentFromDate,
        currentToDate
      ),
    [items, searchQuery, lifecycleFilter, qaFilter, receiptFilter, currentFromDate, currentToDate]
  );

  // Client-side CSV export handler
  const handleExportCsv = useCallback(() => {
    if (filteredItems.length === 0) return;
    const csvData = generateHistoryCsv(filteredItems, assignedSourceName);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `zmcc_history_${assignedSourceName.replace(/\s+/g, '_').toLowerCase()}_${
      currentFromDate || 'all'
    }_to_${currentToDate || 'all'}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredItems, assignedSourceName, currentFromDate, currentToDate]);

  // Client-side Print handler
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="space-y-6">
      {/* 1. Header & Quick Actions */}
      <div className="p-5 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#EAE4D5]/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A]">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-[#111311]">
                Historical Dispatch & Milestone Archive: {assignedSourceName}
              </h2>
              <p className="text-xs text-[#475569]">
                Complete audit trail of all dispatches, weighbridge transactions, and silo receipts for your assigned ZMCC.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportCsv}
              disabled={isLoading || error != null || filteredItems.length === 0}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-bold text-[#1E3A8A] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] transition-all disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={handlePrint}
              disabled={isLoading || error != null || filteredItems.length === 0}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-bold text-slate-700 hover:bg-slate-100 transition-all disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print View</span>
            </button>

            {onRetry && (
              <button
                onClick={onRetry}
                disabled={isLoading}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-xs font-bold text-[#111311] hover:bg-[#F4F0E6]/60 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1E3A8A] ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Record Count Badge */}
        <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
          <span>
            {isLoading || error != null ? (
              <span>—</span>
            ) : (
              <>
                Showing <strong>{filteredItems.length}</strong> of <strong>{items.length}</strong> historical transactions
              </>
            )}
          </span>
          {!isLoading && !error && (currentFromDate || currentToDate) ? (
            <span className="text-[11px] font-bold text-[#1E3A8A]">
              Filtered by Business Date: {currentFromDate || 'Start'} to {currentToDate || 'End'}
            </span>
          ) : null}
        </div>
      </div>

      {/* 2. Filters & Search Bar */}
      <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#EAE4D5]/80 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicle #, token #, silo, date..."
              className="w-full pl-9 pr-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311] focus:ring-2 focus:ring-[#1E3A8A] outline-none"
            />
          </div>

          {/* Business Date Range Filter */}
          {onDateFilterChange && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-bold text-slate-600 text-[11px]">Business Date From:</span>
              <input
                type="date"
                value={currentFromDate}
                onChange={(e) => onDateFilterChange(e.target.value || null, currentToDate || null)}
                className="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]"
              />
              <span className="font-bold text-slate-600 text-[11px]">To:</span>
              <input
                type="date"
                value={currentToDate}
                onChange={(e) => onDateFilterChange(currentFromDate || null, e.target.value || null)}
                className="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-[#FDFBF9] border border-[#EAE4D5]/80 text-[#111311]"
              />
              {(currentFromDate || currentToDate) && (
                <button
                  onClick={() => onDateFilterChange(null, null)}
                  className="px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 rounded"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Filter Dropdowns / Chips */}
        <div className="flex items-center gap-3 overflow-x-auto pt-2 border-t border-[#EAE4D5]/60 text-xs flex-wrap">
          {/* Lifecycle Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Stage:</span>
            <select
              value={lifecycleFilter}
              onChange={(e) => setLifecycleFilter(e.target.value as HistoryLifecycleFilter)}
              className="px-2 py-1 text-xs font-bold rounded bg-[#F8FAFC] border border-slate-200 text-slate-700 outline-none"
            >
              <option value="ALL">All Stages</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="IN_PLANT">In Plant</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Has Rejection</option>
              <option value="HOLD">Has Hold</option>
            </select>
          </div>

          {/* QA Decision Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase">QA Decision:</span>
            <select
              value={qaFilter}
              onChange={(e) => setQaFilter(e.target.value as HistoryQAFilter)}
              className="px-2 py-1 text-xs font-bold rounded bg-[#F8FAFC] border border-slate-200 text-slate-700 outline-none"
            >
              <option value="ALL">All QA</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="REJECTED">Rejected</option>
              <option value="HOLD">Hold</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          {/* Receipt Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Receipt:</span>
            <select
              value={receiptFilter}
              onChange={(e) => setReceiptFilter(e.target.value as HistoryReceiptFilter)}
              className="px-2 py-1 text-xs font-bold rounded bg-[#F8FAFC] border border-slate-200 text-slate-700 outline-none"
            >
              <option value="ALL">All Receipts</option>
              <option value="FINAL_RECEIPT_EXISTS">Final Receipt Exists</option>
              <option value="RECEIPT_PENDING">Receipt Pending</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button onClick={onRetry} className="underline hover:text-red-950">
              Retry
            </button>
          )}
        </div>
      )}

      {/* 4. Loading State */}
      {isLoading && (
        <div className="p-8 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 text-xs text-slate-500 font-bold flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#1E3A8A]" />
          <span>Loading historical transactions...</span>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredItems.length === 0 && (
        <div className="p-12 text-center bg-[#FFFFFF] rounded-xl border border-[#EAE4D5]/80 space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-extrabold text-slate-800">No historical records found</h3>
          <p className="text-xs text-slate-500">
            No dispatch or receipt transactions match your current search and filters.
          </p>
        </div>
      )}

      {/* 6. Historical Transactions Table */}
      {!isLoading && !error && filteredItems.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[#EAE4D5]/80 bg-[#FFFFFF] shadow-sm">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#F8FAFC] text-[10px] font-sans font-black uppercase tracking-wider text-slate-600 border-b border-[#EAE4D5]/80">
              <tr>
                <th className="py-2.5 px-3">Business Date</th>
                <th className="py-2.5 px-3">Vehicle #</th>
                <th className="py-2.5 px-3">Token #</th>
                <th className="py-2.5 px-3 font-sans">Current Stage</th>
                <th className="py-2.5 px-3 font-sans">Portion QA</th>
                <th className="py-2.5 px-3">Dispatch Gross</th>
                <th className="py-2.5 px-3">First Weight (Loaded Vehicle)</th>
                <th className="py-2.5 px-3">Second Weight (After Unloading)</th>
                <th className="py-2.5 px-3">Net Milk Weight</th>
                <th className="py-2.5 px-3">Physical Received</th>
                <th className="py-2.5 px-3">Silo</th>
                <th className="py-2.5 px-3 font-sans">Final Receipt Date/Time</th>
                <th className="py-2.5 px-3 text-right font-sans">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/40 text-xs">
              {filteredItems.map((item) => (
                <tr key={item.visitId} className="hover:bg-[#FDFBF9] transition-colors">
                  <td className="py-2.5 px-3 font-bold text-slate-800 whitespace-nowrap">
                    {item.businessDate}
                  </td>
                  <td className="py-2.5 px-3 font-extrabold text-[#111311] whitespace-nowrap">
                    {item.vehicleNumber}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                    {item.tokenNumber || '—'}
                  </td>
                  <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        item.isComplete
                          ? 'bg-emerald-100 text-emerald-800'
                          : item.hasRejection
                          ? 'bg-red-100 text-red-800'
                          : item.hasHold
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {item.lifecycleStageLabel}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-sans text-[11px] whitespace-nowrap">
                    <span className="font-semibold text-slate-700">
                      {item.portionQASummaryText || `${item.portionCount} portions`}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                    {item.dispatchGrossLiters != null ? `${item.dispatchGrossLiters.toLocaleString()} L` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                    {item.firstWeightKg != null ? `${item.firstWeightKg.toLocaleString()} kg` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                    {item.secondWeightKg != null ? `${item.secondWeightKg.toLocaleString()} kg` : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-[#1E3A8A] whitespace-nowrap">
                    {item.netMilkWeightKg != null ? `${item.netMilkWeightKg.toLocaleString()} kg` : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-[#166534] whitespace-nowrap">
                    {item.physicalReceivedLiters != null ? `${item.physicalReceivedLiters.toLocaleString()} L` : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-800 whitespace-nowrap">
                    {item.destinationSilo || '—'}
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-600 whitespace-nowrap">
                    {item.finalReceiptTimestamp ? formatOperationalDatetime(item.finalReceiptTimestamp) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap font-sans">
                    <button
                      onClick={() => onInspectDetails(item.group.primaryLog)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-bold text-[#1E3A8A] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] transition-all"
                    >
                      <span>View</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
