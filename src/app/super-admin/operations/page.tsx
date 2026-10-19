'use client';

import React, { useEffect, useState } from 'react';
import { Search, ShieldAlert, Truck } from 'lucide-react';

import { formatDispatchQuantity } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

interface Portion {
  id: string;
  portionNumber: number;
  contractorName: string;
  dispatchQuantityValue: number | null;
  dispatchQuantityUnit: string | null;
  dispatchQuantityBasis?: string | null;
  provisionalPhysicalLiters?: number | null;
  plantDecision: string | null;
  rejectionReason: string | null;
  unloadingLog: {
    siloCode: string;
    siloName: string;
    status: string;
    provisionalPhysicalLiters?: number | null;
  } | null;
}

interface Visit {
  id: string;
  visitNumber: string;
  vehicleNumber: string;
  tokenNumber: string | null;
  currentStatus: string;
  createdAt: string;
  vehicleDispatchQuantityValue?: number | null;
  vehicleDispatchQuantityUnit?: string | null;
  gateLog: {
    entryTimestamp: string | null;
    exitTimestamp: string | null;
  } | null;
  weightTicket: {
    grossWeightKg: number | null;
    grossTimestamp: string | null;
    tareWeightKg: number | null;
    tareTimestamp: string | null;
    netWeightKg: number | null;
  } | null;
  portions: Portion[];
}

export default function SuperAdminOperationsPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // The committed request; a new object re-runs the fetch even for identical values.
  const [request, setRequest] = useState({ query: '', page: 1 });

  useEffect(() => {
    let ignore = false;
    fetchJson<{ visits?: Visit[]; pagination?: { totalRecords: number; totalPages: number; page: number } }>(
      `/api/super-admin/operations?q=${encodeURIComponent(request.query)}&page=${request.page}&pageSize=${pageSize}`
    )
      .then(
        (data) => {
          if (ignore) return;
          setVisits(data.visits || []);
          if (data.pagination) {
            setTotalRecords(data.pagination.totalRecords);
            setTotalPages(data.pagination.totalPages);
            setPage(data.pagination.page);
          }
          setError(null);
        },
        (err) => {
          if (!ignore) setError(getErrorMessage(err));
        }
      )
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [request, pageSize]);

  const goToPage = (pageNum: number) => {
    setLoading(true);
    setRequest((current) => ({ ...current, page: pageNum }));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setRequest({ query: searchQuery, page: 1 });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Plant Operations Journey Explorer</h1>
        </div>

        {/* SEARCH FORM */}
        <form onSubmit={handleSearch} className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Vehicle / Visit #…"
              className="pl-9 pr-3 py-1.5 rounded-xl border border-border-strong text-xs bg-white focus:outline-hidden focus:border-primary w-64"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-hover transition"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* VISITS LIST */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-8 text-center text-xs tabular-nums font-semibold text-slate-400">
            Loading vehicle operation records…
          </div>
        ) : visits.length === 0 ? (
          <div className="p-8 bg-white rounded-xl border border-border text-center text-slate-400 text-xs font-medium">
            No vehicle visits found.
          </div>
        ) : (
          visits.map((v) => (
            <div key={v.id} className="bg-white rounded-xl border border-border/80 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-50 text-primary rounded-lg">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-sm flex items-center space-x-2">
                      <span>{v.vehicleNumber}</span>
                      <span className="tabular-nums text-xs text-slate-500 font-semibold">({v.visitNumber})</span>
                    </h3>
                    <div className="text-[11px] text-slate-500 font-medium">
                      Token: <span className="tabular-nums font-semibold">{v.tokenNumber || 'N/A'}</span> | Created:{' '}
                      <span className="tabular-nums">{new Date(v.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="px-2.5 py-1 rounded bg-primary text-white tabular-nums text-xs font-semibold">
                    {v.currentStatus}
                  </span>
                </div>
              </div>

              {/* TIMELINE MILESTONE SUMMARY */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-subtle p-3 rounded-lg border border-border/60">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">Gate Security</span>
                  <div className="font-semibold text-slate-700 mt-0.5">
                    Entry: {v.gateLog?.entryTimestamp ? new Date(v.gateLog.entryTimestamp).toLocaleTimeString() : 'Pending'}
                  </div>
                  <div className="font-semibold text-slate-700">
                    Exit: {v.gateLog?.exitTimestamp ? new Date(v.gateLog.exitTimestamp).toLocaleTimeString() : 'Pending'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">Weighbridge Tickets</span>
                  <div className="font-semibold text-slate-700 mt-0.5">
                    Gross: {v.weightTicket?.grossWeightKg ? `${v.weightTicket.grossWeightKg.toLocaleString()} kg` : 'Pending'}
                  </div>
                  <div className="font-semibold text-slate-700">
                    Tare: {v.weightTicket?.tareWeightKg ? `${v.weightTicket.tareWeightKg.toLocaleString()} kg` : 'Pending'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">Net Reception Volume</span>
                  <div className="tabular-nums font-semibold text-emerald-800 text-sm mt-0.5">
                    {v.weightTicket?.netWeightKg ? `${v.weightTicket.netWeightKg.toLocaleString()} kg Net` : 'Pending'}
                  </div>
                </div>
              </div>

              {/* PORTIONS BREAKDOWN */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700">Milk Portions ({v.portions.length})</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {v.portions.map((p) => (
                    <div key={p.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="flex justify-between items-center font-semibold text-slate-800">
                        <span>Portion #{p.portionNumber} ({p.contractorName})</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          p.plantDecision === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-900'
                            : p.plantDecision === 'REJECTED'
                            ? 'bg-rose-100 text-rose-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}>
                          {p.plantDecision || 'PENDING'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Dispatch Qty: <strong>{formatDispatchQuantity(p.dispatchQuantityValue, p.dispatchQuantityUnit)}</strong>
                      </div>
                      {p.unloadingLog && (
                        <div className="text-[11px] text-slate-600">
                          Silo: <strong>{p.unloadingLog.siloCode}</strong> ({p.unloadingLog.siloName})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* PAGINATION CONTROLS */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white px-4 py-3 border border-border rounded-xl text-xs font-semibold text-slate-700">
          <div>
            Showing page <span className="font-semibold text-primary">{page}</span> of{' '}
            <span className="font-semibold text-primary">{totalPages}</span> ({totalRecords.toLocaleString()} total visits)
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => goToPage(Math.max(1, page - 1))}
              className="px-3 py-1.5 rounded-lg border border-border-strong hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              className="px-3 py-1.5 rounded-lg border border-border-strong hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
