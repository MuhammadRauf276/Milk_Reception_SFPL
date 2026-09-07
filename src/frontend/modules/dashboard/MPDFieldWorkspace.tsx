'use client';

import React, { useState, useEffect } from 'react';
import { User } from '@core/types';
import { ChevronLeft, ChevronRight, RefreshCw, Radio, Calendar, Truck } from 'lucide-react';
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
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  zonal_contractor_name: string;
  zonal_contractor_dispatch_time: string | null;
  has_gate_entry: boolean;
  portions: Array<{
    id: string;
    portion_number: number;
    dispatch_quantity_value?: number | null;
    dispatch_quantity_unit?: string | null;
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
  const [activeTab, setActiveTab] = useState<'new' | 'recent'>('new');
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
    <div className="max-w-7xl mx-auto space-y-6 w-full overflow-x-hidden">
      {/* Top-Level Dispatch Workspace Tabs */}
      <div className="flex items-center space-x-2 border-b border-[#C4B9A3] pb-3" role="tablist">
        <button
          type="button"
          role="tab"
          id="tab-new-dispatch"
          aria-selected={activeTab === 'new'}
          aria-controls="panel-new-dispatch"
          onClick={() => setActiveTab('new')}
          className={`h-11 px-5 rounded-xl text-xs font-black transition flex items-center space-x-2 ${
            activeTab === 'new'
              ? 'bg-[#1E40AF] text-white shadow-sm ring-2 ring-[#1E40AF]/20'
              : 'bg-white text-slate-700 hover:bg-[#F4EFE3] border border-[#C4B9A3]'
          }`}
        >
          <span>New Dispatch</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-recent-dispatches"
          aria-selected={activeTab === 'recent'}
          aria-controls="panel-recent-dispatches"
          onClick={() => setActiveTab('recent')}
          className={`h-11 px-5 rounded-xl text-xs font-black transition flex items-center space-x-2 ${
            activeTab === 'recent'
              ? 'bg-[#1E40AF] text-white shadow-sm ring-2 ring-[#1E40AF]/20'
              : 'bg-white text-slate-700 hover:bg-[#F4EFE3] border border-[#C4B9A3]'
          }`}
        >
          <span>Recent Dispatches</span>
          {pagination.totalRecords > 0 && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                activeTab === 'recent' ? 'bg-blue-900 text-white' : 'bg-[#F4EFE3] text-slate-700 border border-[#C4B9A3]'
              }`}
            >
              {pagination.totalRecords}
            </span>
          )}
        </button>
      </div>

      {/* Tab Panels: New Dispatch Panel (state preserved when hidden) */}
      <div
        id="panel-new-dispatch"
        role="tabpanel"
        aria-labelledby="tab-new-dispatch"
        className={activeTab === 'new' ? 'block' : 'hidden'}
      >
        <DynamicDispatchForm currentUser={currentUser} onSuccess={() => fetchDbDispatches(1, dateRange)} />
      </div>

      {/* Tab Panels: Recent Dispatches Panel */}
      <div
        id="panel-recent-dispatches"
        role="tabpanel"
        aria-labelledby="tab-recent-dispatches"
        className={activeTab === 'recent' ? 'block' : 'hidden'}
      >
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Header & Date Controls */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-extrabold text-[#111311]">Recent Dispatches</h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-600" />
                  Live
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-slate-600 bg-[#F4EFE3] px-2.5 py-1 rounded-lg border border-[#C4B9A3]">
                {pagination.totalRecords} records
              </span>
            </div>

            {/* Quick Date Window Filter Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-xs font-bold">
              <button
                type="button"
                onClick={() => handleRangeChange('today')}
                className={`h-9 rounded-lg text-xs font-black transition ${
                  dateRange === 'today'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-white/60'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('7d')}
                className={`h-9 rounded-lg text-xs font-black transition ${
                  dateRange === '7d'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-white/60'
                }`}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('30d')}
                className={`h-9 rounded-lg text-xs font-black transition ${
                  dateRange === '30d'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-white/60'
                }`}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('custom')}
                className={`h-9 rounded-lg text-xs font-black transition ${
                  dateRange === 'custom'
                    ? 'bg-[#1E40AF] text-white shadow-sm'
                    : 'text-[#334155] hover:bg-white/60'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Date Controls */}
            {dateRange === 'custom' && (
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600">From Date</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl border border-[#C4B9A3] bg-white font-mono text-xs text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600">To Date</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl border border-[#C4B9A3] bg-white font-mono text-xs text-[#111311] focus:ring-2 focus:ring-[#1E40AF] outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClearCustomDate}
                    className="h-10 px-3.5 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCustomDate}
                    className="h-10 px-4 bg-[#1E40AF] text-white font-bold text-xs rounded-xl shadow-sm hover:bg-blue-800 transition"
                  >
                    Apply Filter
                  </button>
                </div>
              </div>
            )}

            {dateError && (
              <p className="text-xs font-bold text-rose-700 bg-rose-50 p-3 rounded-xl border border-rose-200">
                {dateError}
              </p>
            )}
          </div>

          {/* Records List */}
          <div className="space-y-3 max-h-[580px] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="p-10 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-white text-xs font-bold text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
                Loading dispatches...
              </div>
            ) : dbDispatches.length === 0 ? (
              <div className="p-10 text-center border border-dashed border-[#C4B9A3] rounded-2xl bg-white text-xs font-bold text-slate-500">
                No dispatches found for this period.
              </div>
            ) : (
              dbDispatches.map((log) => (
                <div
                  key={`mpd-dispatch-${String(log.id)}`}
                  className="p-4 sm:p-5 rounded-2xl border bg-white text-[#111311] border-[#C4B9A3] shadow-sm space-y-3 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-[#F4EFE3] text-[#1E40AF]">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-black font-mono text-base tracking-tight text-[#111311]">
                          {log.vehicle_number}
                        </span>
                        <div className="flex items-center space-x-1.5 mt-0.5">
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-[#F4EFE3] border border-[#C4B9A3] font-mono">
                            {log.portion_count} Portion{log.portion_count > 1 ? 's' : ''}
                          </span>
                          <span className="text-[11px] font-medium text-slate-600">
                            {log.zonal_contractor_name}
                          </span>
                        </div>
                      </div>
                    </div>

                    <span className="px-3 py-1 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono">
                      Dispatched
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[#F4EFE3]/70 border border-[#C4B9A3] text-xs font-mono font-bold">
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Vehicle Quantity</span>
                      <span className="text-slate-900 font-black text-sm">
                        {log.vehicle_dispatch_quantity_value != null && log.vehicle_dispatch_quantity_unit
                          ? `${Number(log.vehicle_dispatch_quantity_value).toLocaleString()} ${log.vehicle_dispatch_quantity_unit}`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block text-[9.5px]">Operational Date</span>
                      <span className="text-slate-900 font-black text-sm">
                        {log.operational_date || 'Today'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Server-side Pagination Footer */}
          {pagination.totalPages > 1 && (
            <div className="p-3.5 rounded-2xl bg-white border border-[#C4B9A3] shadow-sm flex items-center justify-between text-xs font-bold">
              <button
                type="button"
                disabled={page <= 1 || isLoading}
                onClick={() => handlePageChange(page - 1)}
                className="h-10 flex items-center space-x-1 px-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-[#111311] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-100/50 transition"
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
                className="h-10 flex items-center space-x-1 px-3.5 rounded-xl bg-[#F4EFE3] border border-[#C4B9A3] text-[#111311] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-100/50 transition"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
