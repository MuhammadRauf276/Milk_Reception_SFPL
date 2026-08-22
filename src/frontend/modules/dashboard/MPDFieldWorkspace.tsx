'use client';

import React, { useState, useEffect } from 'react';
import { User } from '@core/types';
import { ChevronLeft, ChevronRight, RefreshCw, Radio } from 'lucide-react';
import { DynamicDispatchForm } from '@modules/forms/DynamicDispatchForm';

interface DispatchRecord {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string | null;
  current_status: string;
  portion_count: number;
  total_declared_kg: number;
  zonal_contractor_name: string;
  zonal_contractor_dispatch_time: string | null;
  has_gate_entry: boolean;
  portions: Array<{
    id: string;
    portion_number: number;
    declared_quantity_kg: number;
    plant_decision: string;
    current_status: string;
  }>;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}

interface MPDFieldWorkspaceProps {
  logs?: any[];
  currentUser: User | null;
  onSaveDispatch?: (data: any) => Promise<void>;
  onRefresh?: () => void;
}

export const MPDFieldWorkspace: React.FC<MPDFieldWorkspaceProps> = ({
  currentUser,
  onRefresh,
}) => {
  const [dbDispatches, setDbDispatches] = useState<DispatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Date Filter State
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'custom'>('7d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  // Server-side Pagination State
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 20,
    totalRecords: 0,
    totalPages: 1,
  });

  const fetchDbDispatches = async (targetPage = page, range = dateRange, fDate = fromDate, tDate = toDate) => {
    setIsLoading(true);
    setDateError(null);

    let queryUrl = `/api/dispatches?range=${range}&page=${targetPage}&pageSize=20`;

    if (range === 'custom') {
      if (fDate && tDate && fDate > tDate) {
        setDateError('From Date cannot be after To Date');
        setIsLoading(false);
        return;
      }
      if (fDate) queryUrl += `&fromDate=${fDate}`;
      if (tDate) queryUrl += `&toDate=${tDate}`;
    }

    try {
      const res = await fetch(queryUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch dispatches');

      if (data.dispatches) {
        setDbDispatches(data.dispatches);
      }
      if (data.pagination) {
        setPagination(data.pagination);
      }
    } catch (err: any) {
      console.error('Failed to fetch dispatches', err);
      setDateError(err.message || 'Failed to fetch dispatches');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDbDispatches(1, dateRange);
  }, [dateRange]);

  const handleRangeChange = (newRange: 'today' | '7d' | '30d' | 'custom') => {
    setDateRange(newRange);
    setPage(1);
  };

  const handleApplyCustomDate = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateError('From Date cannot be after To Date');
      return;
    }
    setPage(1);
    fetchDbDispatches(1, 'custom', fromDate, toDate);
  };

  const handleClearCustomDate = () => {
    setFromDate('');
    setToDate('');
    setDateError(null);
    setDateRange('7d');
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    setPage(newPage);
    fetchDbDispatches(newPage, dateRange);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Two-Column Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN (5/12): RECENT DISPATCHES */}
        <div className="lg:col-span-5 space-y-4">
          {/* Header & Date Controls */}
          <div className="p-4 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-extrabold text-[#111311]">Recent Dispatches</h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-600" />
                  Live
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-slate-600 bg-[#F4EFE3] px-2 py-0.5 rounded border border-[#C4B9A3]">
                {pagination.totalRecords} records
              </span>
            </div>

            {/* Quick Date Window Filter Buttons */}
            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-bold">
              <button
                type="button"
                onClick={() => handleRangeChange('today')}
                className={`py-1.5 rounded-lg text-[11px] font-black transition ${
                  dateRange === 'today'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-amber-100/50'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('7d')}
                className={`py-1.5 rounded-lg text-[11px] font-black transition ${
                  dateRange === '7d'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-amber-100/50'
                }`}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('30d')}
                className={`py-1.5 rounded-lg text-[11px] font-black transition ${
                  dateRange === '30d'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-amber-100/50'
                }`}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('custom')}
                className={`py-1.5 rounded-lg text-[11px] font-black transition ${
                  dateRange === 'custom'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-amber-100/50'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Date Controls */}
            {dateRange === 'custom' && (
              <div className="pt-2 border-t border-[#C4B9A3] space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-[#334155] mb-1">From Date</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#C4B9A3] bg-[#F4EFE3] font-mono text-xs text-[#111311]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#334155] mb-1">To Date</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#C4B9A3] bg-[#F4EFE3] font-mono text-xs text-[#111311]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClearCustomDate}
                    className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCustomDate}
                    className="px-3 py-1 bg-[#1E40AF] text-white font-bold text-xs rounded-lg shadow-sm hover:bg-blue-800"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}

            {dateError && (
              <p className="text-xs font-bold text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200">
                {dateError}
              </p>
            )}
          </div>

          {/* Records List */}
          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading dispatches...
              </div>
            ) : dbDispatches.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-[#EFE9D9] text-xs font-bold text-slate-500">
                No dispatches found for this period.
              </div>
            ) : (
              dbDispatches.map((log) => (
                <div
                  key={`mpd-dispatch-${String(log.id)}`}
                  className="p-4 rounded-xl border bg-[#EFE9D9] text-[#111311] border-[#C4B9A3] shadow-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-black font-mono text-base tracking-tight text-[#111311]">
                        {log.vehicle_number}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#F4EFE3] border border-[#C4B9A3] font-mono">
                        {log.portion_count} Portion{log.portion_count > 1 ? 's' : ''}
                      </span>
                    </div>

                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono">
                      Dispatched
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold text-[#334155]">
                    <span>Date: {log.operational_date || 'Today'}</span>
                    <span>{log.zonal_contractor_name}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-[#F4EFE3] border border-[#C4B9A3] text-[10.5px] font-mono font-bold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[9px]">Total Quantity</span>
                      <span>{log.total_declared_kg.toLocaleString()} {(log as any).declared_quantity_unit === 'LITER' ? 'L' : 'KG'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9px]">Date</span>
                      <span>{log.operational_date || 'Today'}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Server-side Pagination Footer */}
          {pagination.totalPages > 1 && (
            <div className="p-3 rounded-xl bg-[#EFE9D9] border border-[#C4B9A3] flex items-center justify-between text-xs font-bold">
              <button
                type="button"
                disabled={page <= 1 || isLoading}
                onClick={() => handlePageChange(page - 1)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#F4EFE3] border border-[#C4B9A3] text-[#111311] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-100/50"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <span className="font-mono text-slate-700">
                Page {pagination.page} of {pagination.totalPages}
              </span>

              <button
                type="button"
                disabled={page >= pagination.totalPages || isLoading}
                onClick={() => handlePageChange(page + 1)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#F4EFE3] border border-[#C4B9A3] text-[#111311] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-100/50"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (7/12): NEW DISPATCH FORM */}
        <div className="lg:col-span-7">
          <DynamicDispatchForm currentUser={currentUser} onSuccess={() => fetchDbDispatches(1, dateRange)} />
        </div>
      </div>
    </div>
  );
};
