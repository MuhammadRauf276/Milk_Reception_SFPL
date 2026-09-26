'use client';

import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, AlertTriangle, UserCheck, Search, Filter } from 'lucide-react';
import type { GovernanceOverrideTelemetry } from '../types';

interface MpdGovernanceScreenProps {
  overrides: GovernanceOverrideTelemetry[];
  onAuditAction?: (id: string, action: 'APPROVED' | 'FLAGGED', remarks?: string) => Promise<void>;
}

export const MpdGovernanceScreen: React.FC<MpdGovernanceScreenProps> = ({ overrides, onAuditAction }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<'ALL' | 'ZMCC_GATE' | 'PLANT_RECEPTION'>('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const filteredOverrides = overrides.filter((o) => {
    const matchesSearch =
      o.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.sourceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.overruledBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.failedParameter.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStage = stageFilter === 'ALL' || o.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  const handleAction = async (id: string, action: 'APPROVED' | 'FLAGGED') => {
    if (!onAuditAction) return;
    setActionLoading(id);
    try {
      await onAuditAction(id, action);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Governance Banner */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-[#111311] uppercase tracking-wider">
              Executive Governance & Exception Audit Desk
            </h2>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              When ground laboratory tests fail, ground managers (ZMCC Managers at chilling centers or Plant QA Managers at Plant reception) may exercise an operational tolerance override with mandatory justification. All overrides are aggregated here for MPD Head and QA Head executive compliance audit.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-[#EAE4D5]">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search vehicle, source, manager, or parameter..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[#EAE4D5] focus:outline-none focus:border-[#1E3A8A] bg-[#FDFBF9]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStageFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'ALL' ? 'bg-[#1E3A8A] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Overrides ({overrides.length})
          </button>
          <button
            onClick={() => setStageFilter('ZMCC_GATE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'ZMCC_GATE' ? 'bg-[#1E3A8A] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            ZMCC Gate
          </button>
          <button
            onClick={() => setStageFilter('PLANT_RECEPTION')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'PLANT_RECEPTION' ? 'bg-[#1E3A8A] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Plant Reception
          </button>
        </div>
      </div>

      {/* Overrides Table */}
      <div className="bg-white border border-[#EAE4D5] rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#EAE4D5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-[#1E3A8A]" />
            <h2 className="text-xs font-bold text-[#111311] uppercase tracking-wider">
              Operational Override Records Log
            </h2>
          </div>
          <span className="text-xs font-mono font-medium text-slate-500">
            {filteredOverrides.length} record(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#FDFBF9] border-b border-[#EAE4D5] text-slate-600 font-bold">
                <th className="py-3 px-4">Ref / Vehicle</th>
                <th className="py-3 px-4">Source & Stage</th>
                <th className="py-3 px-4">Parameter & Breach</th>
                <th className="py-3 px-4">Manager Justification</th>
                <th className="py-3 px-4">Overruled By</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Audit Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]">
              {filteredOverrides.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No governance overrides requiring audit.
                  </td>
                </tr>
              ) : (
                filteredOverrides.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-[#111311]">{o.reference}</div>
                      <div className="text-slate-500 text-xs font-mono">{o.id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{o.sourceName}</div>
                      <span className="inline-block px-2 py-0.5 mt-0.5 rounded text-xs font-mono font-bold bg-slate-100 text-slate-700">
                        {o.stage}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-rose-700">{o.failedParameter}</div>
                      <div className="text-xs font-mono text-slate-600">
                        Value: <strong>{o.failedValue}</strong> (Limit: {o.toleranceLimit})
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <div className="text-slate-800 text-xs italic bg-[#FDFBF9] p-2 rounded border border-[#EAE4D5]">
                        "{o.managerJustification}"
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-800 font-semibold">{o.overruledBy}</div>
                      <div className="text-slate-500 text-xs font-mono">
                        {new Date(o.timestamp).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                          o.status === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : o.status === 'FLAGGED'
                            ? 'bg-rose-50 text-rose-800 border border-rose-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {o.status === 'PENDING_AUDIT' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            disabled={actionLoading === o.id}
                            onClick={() => handleAction(o.id, 'APPROVED')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={actionLoading === o.id}
                            onClick={() => handleAction(o.id, 'FLAGGED')}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                          >
                            Flag
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 italic">Audited</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
