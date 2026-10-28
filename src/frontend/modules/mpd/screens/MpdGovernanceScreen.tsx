'use client';

import React, { useState } from 'react';
import { ShieldAlert, UserCheck, Search } from 'lucide-react';
import type { GovernanceOverrideTelemetry, ZmccCenterTelemetry } from '../types';
import { InfoTip } from '@/components/ui/info-tip';
import { NO_DATA } from '../format';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';

interface MpdGovernanceScreenProps {
  overrides: GovernanceOverrideTelemetry[];
  /** Per-ZMCC exit-outcome counts (left / closed without full unloading). */
  zmccs?: ZmccCenterTelemetry[];
  onAuditAction?: (id: string, action: 'APPROVED' | 'FLAGGED', remarks?: string) => Promise<void>;
}

export const MpdGovernanceScreen: React.FC<MpdGovernanceScreenProps> = ({
  overrides = [],
  zmccs = [],
  onAuditAction,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<'ALL' | 'ZMCC_GATE' | 'PLANT_RECEPTION'>('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filteredOverrides = (overrides ?? []).filter((o) => {
    const matchesSearch = [o.reference, o.sourceName, o.overruledBy, o.failedParameter].some((field) =>
      (field ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    );
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
      <div className="bg-card border-border border rounded-xl p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-foreground">
              Governance
            </h2>
          </div>
        </div>
      </div>

      {zmccs.some((z) => z.leftWithoutFullUnloadingCount > 0 || z.pendingCloseRequestCount > 0) && (
        <div className="bg-card border-border border rounded-xl p-4 shadow-xs">
          <h3 className="text-xs font-semibold text-foreground">Incomplete unloads (30 days)</h3>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {zmccs.filter((z) => z.leftWithoutFullUnloadingCount > 0 || z.pendingCloseRequestCount > 0).map((z) => (
              <div key={z.id} className="bg-card border-border rounded-lg border p-2.5 text-xs">
                <div className="font-semibold text-foreground">{z.name}</div>
                <div className="tabular-nums text-slate-600">
                  {z.leftWithoutFullUnloadingCount} left · {z.pendingCloseRequestCount} pending request(s)
                </div>
                <div className="tabular-nums text-slate-500">{z.acceptedNotReceivedLiters.toLocaleString()} L accepted, not received</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-hidden focus:border-primary bg-subtle min-h-11"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStageFilter('ALL')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'ALL' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({(overrides ?? []).length})
          </button>
          <button
            onClick={() => setStageFilter('ZMCC_GATE')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'ZMCC_GATE' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            ZMCC Gate
          </button>
          <button
            onClick={() => setStageFilter('PLANT_RECEPTION')}
            className={`px-3 py-1.5 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'PLANT_RECEPTION' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Plant Reception
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-primary" />
            <div className="flex items-center gap-1.5"><h2 className="text-xs font-semibold text-foreground">Overrides Log</h2><InfoTip text="Audit records of all operational manager overrides and deviations." /></div>
          </div>
          <span className="text-xs tabular-nums font-medium text-slate-500">
            {filteredOverrides.length} record(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-subtle border-b border-border text-slate-600 font-semibold">
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Parameter</th>
                <th className="py-3 px-4">Justification</th>
                <th className="py-3 px-4">Overruled By</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredOverrides.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No overrides found.
                  </td>
                </tr>
              ) : (
                paginate(filteredOverrides, Math.min(page, pageCount(filteredOverrides.length))).map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="tabular-nums font-semibold text-foreground">{o.reference}</div>
                      <div className="text-slate-500 text-xs tabular-nums">{o.id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{o.sourceName ?? NO_DATA}</div>
                      <span className="inline-block px-2 py-0.5 mt-0.5 rounded text-xs tabular-nums font-semibold bg-slate-100 text-slate-700">
                        {o.stage}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-rose-700">{o.failedParameter}</div>
                      <div className="text-xs tabular-nums text-slate-600">
                        Value: <strong>{o.failedValue}</strong> (Limit: {o.toleranceLimit})
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <div className="flex items-center gap-1 text-slate-800 text-xs">
                        <span>Remarks</span>
                        {o.managerJustification ? <InfoTip text={o.managerJustification} /> : <span>{NO_DATA}</span>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        System {o.systemOutcome ?? NO_DATA} → final {o.finalDecision ?? NO_DATA}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-800 font-semibold">{o.overruledBy ?? NO_DATA}</div>
                      <div className="text-slate-500 text-xs tabular-nums">
                        {new Date(o.timestamp).toLocaleString()}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
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
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 min-h-11 min-w-11"
                          >
                            Approve
                          </button>
                          <button
                            disabled={actionLoading === o.id}
                            onClick={() => handleAction(o.id, 'FLAGGED')}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 min-h-11 min-w-11"
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
<Pager page={Math.min(page, pageCount(filteredOverrides.length))} totalPages={pageCount(filteredOverrides.length)} total={filteredOverrides.length} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
};
