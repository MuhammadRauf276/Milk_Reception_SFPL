'use client';

import React, { useEffect, useState } from 'react';
import { Activity, Search, ShieldAlert, Truck, ChevronRight } from 'lucide-react';

import { formatDispatchQuantity } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

interface Portion {
  id: string;
  portionNumber: number;
  contractorName: string;
  dispatchQuantityValue: number | null;
  dispatchQuantityUnit: string | null;
  dispatchQuantityBasis?: string | null;
  dispatchMeasurementMethod?: string | null;
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

  async function loadVisits(query = '') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/operations?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (res.ok) setVisits(data.visits || []);
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVisits();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadVisits(searchQuery);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#111311]">Plant Operations Journey Explorer</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Complete end-to-end multi-portion vehicle milestone inspection. (Read-Only Visibility)
          </p>
        </div>

        {/* SEARCH FORM */}
        <form onSubmit={handleSearch} className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Vehicle / Visit #..."
              className="pl-9 pr-3 py-1.5 rounded-xl border border-[#C4B9A3] text-xs bg-white focus:outline-none focus:border-[#1E3A8A] w-64"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-[#1E3A8A] text-white rounded-xl text-xs font-bold hover:bg-blue-900 transition"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* VISITS LIST */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-8 text-center text-xs font-mono font-bold text-slate-400">
            Loading vehicle operation records...
          </div>
        ) : visits.length === 0 ? (
          <div className="p-8 bg-white rounded-xl border border-[#EAE4D5] text-center text-slate-400 text-xs font-medium">
            No vehicle visits found.
          </div>
        ) : (
          visits.map((v) => (
            <div key={v.id} className="bg-white rounded-xl border border-[#EAE4D5]/80 p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#EAE4D5]/60 pb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-50 text-[#1E3A8A] rounded-lg">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-[#111311] text-sm flex items-center space-x-2">
                      <span>{v.vehicleNumber}</span>
                      <span className="font-mono text-xs text-slate-500 font-semibold">({v.visitNumber})</span>
                    </h3>
                    <div className="text-[11px] text-slate-500 font-medium">
                      Token: <span className="font-mono font-bold">{v.tokenNumber || 'N/A'}</span> | Created:{' '}
                      <span className="font-mono">{new Date(v.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="px-2.5 py-1 rounded bg-[#1E3A8A] text-white font-mono text-xs font-black">
                    {v.currentStatus}
                  </span>
                </div>
              </div>

              {/* TIMELINE MILESTONE SUMMARY */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-[#FDFBF9] p-3 rounded-lg border border-[#EAE4D5]/60">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Gate Security</span>
                  <div className="font-semibold text-slate-700 mt-0.5">
                    Entry: {v.gateLog?.entryTimestamp ? new Date(v.gateLog.entryTimestamp).toLocaleTimeString() : 'Pending'}
                  </div>
                  <div className="font-semibold text-slate-700">
                    Exit: {v.gateLog?.exitTimestamp ? new Date(v.gateLog.exitTimestamp).toLocaleTimeString() : 'Pending'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Weighbridge Tickets</span>
                  <div className="font-semibold text-slate-700 mt-0.5">
                    Gross: {v.weightTicket?.grossWeightKg ? `${v.weightTicket.grossWeightKg.toLocaleString()} kg` : 'Pending'}
                  </div>
                  <div className="font-semibold text-slate-700">
                    Tare: {v.weightTicket?.tareWeightKg ? `${v.weightTicket.tareWeightKg.toLocaleString()} kg` : 'Pending'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Net Reception Volume</span>
                  <div className="font-mono font-bold text-emerald-800 text-sm mt-0.5">
                    {v.weightTicket?.netWeightKg ? `${v.weightTicket.netWeightKg.toLocaleString()} kg Net` : 'Pending'}
                  </div>
                </div>
              </div>

              {/* PORTIONS BREAKDOWN */}
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-700">Chamber Portions ({v.portions.length})</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {v.portions.map((p) => (
                    <div key={p.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="flex justify-between items-center font-bold text-slate-800">
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
    </div>
  );
}
