'use client';

import React, { useState } from 'react';
import { Building2, Building, CheckCircle2, Search } from 'lucide-react';
import type { ZmccCenterTelemetry, PlantContractorTelemetry } from '../types';
import { formatMetric, NO_DATA } from '../format';

interface MpdSourcesScreenProps {
  zmccs: ZmccCenterTelemetry[];
  contractors: PlantContractorTelemetry[];
}

export const MpdSourcesScreen: React.FC<MpdSourcesScreenProps> = ({ zmccs, contractors }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'ZMCC' | 'CONTRACTORS'>('ALL');

  const filteredZmccs = zmccs.filter(
    (z) => z.name.toLowerCase().includes(searchTerm.toLowerCase()) || z.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredContractors = contractors.filter(
    (c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-border">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search ZMCC chilling center or Plant contractor…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-hidden focus:border-primary bg-subtle"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSourceFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              sourceFilter === 'ALL' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Nodes ({zmccs.length + contractors.length})
          </button>
          <button
            onClick={() => setSourceFilter('ZMCC')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              sourceFilter === 'ZMCC' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            ZMCC Centers ({zmccs.length})
          </button>
          <button
            onClick={() => setSourceFilter('CONTRACTORS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              sourceFilter === 'CONTRACTORS' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Plant Contractors ({contractors.length})
          </button>
        </div>
      </div>

      {(sourceFilter === 'ALL' || sourceFilter === 'ZMCC') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-semibold text-foreground">
                ZMCC Chilling Centers (Intake & Silo Stocks)
              </h2>
            </div>
            <span className="text-xs tabular-nums font-medium text-slate-500">
              {filteredZmccs.length} centers active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredZmccs.map((z) => (
              <div
                key={z.id}
                className="bg-white border border-border rounded-xl p-4 shadow-xs hover:border-primary/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="tabular-nums text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                      {z.code}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{z.name}</h3>

                  <div className="mt-3 grid grid-cols-2 gap-2 bg-subtle p-2.5 rounded-lg border border-border">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Received today</div>
                      <div className="tabular-nums font-semibold text-slate-800 text-xs">
                        {z.intakeLiters.toLocaleString()} L
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Dispatch Fat / LR</div>
                      <div className="tabular-nums font-semibold text-slate-800 text-xs">
                        {formatMetric(z.avgFatPercent, '%')} | {formatMetric(z.avgLr)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600 font-medium">Tank stock</span>
                      <span className="tabular-nums font-semibold text-slate-800">
                        {z.siloStockLiters.toLocaleString()} L ({formatMetric(z.siloCapacityPercent, '%')})
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          (z.siloCapacityPercent ?? 0) > 85
                            ? 'bg-amber-500'
                            : (z.siloCapacityPercent ?? 0) > 40
                            ? 'bg-primary'
                            : 'bg-slate-300'
                        }`}
                        style={{ width: `${Math.min(z.siloCapacityPercent ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-slate-600">
                  <span>Dispatched Today:</span>
                  <span className="tabular-nums font-semibold text-primary">
                    {z.dispatchedLiters.toLocaleString()} L ({z.dispatchedTankerCount} tankers)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(sourceFilter === 'ALL' || sourceFilter === 'CONTRACTORS') && (
        <div className="bg-white border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-primary" />
              <h2 className="text-xs font-semibold text-foreground">
                Direct Plant Commercial Contractors
              </h2>
            </div>
            <span className="text-xs tabular-nums font-medium text-slate-500">
              {filteredContractors.length} active contractors
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-subtle border-b border-border text-slate-600 font-semibold">
                  <th className="py-3 px-4">Contractor Name / Code</th>
                  <th className="py-3 px-4 text-right">Delivered to Plant</th>
                  <th className="py-3 px-4 text-center">Plant QA (Fat / LR)</th>
                  <th className="py-3 px-4 text-center">QA Pass Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredContractors.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No direct contractors found.
                    </td>
                  </tr>
                ) : (
                  filteredContractors.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground">{c.name}</div>
                        <div className="text-slate-500 tabular-nums text-xs">{c.code}</div>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-foreground">
                        {c.deliveredLiters.toLocaleString()} L
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums">
                        <span className="font-semibold text-slate-800">{formatMetric(c.avgFatPercent, '%')}</span>
                        <span className="text-slate-400 mx-1">|</span>
                        <span className="font-semibold text-slate-800">{formatMetric(c.avgLr)}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {c.qualityPassRatePercent === null ? (
                          <span className="text-slate-400">{NO_DATA}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            {c.qualityPassRatePercent}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
