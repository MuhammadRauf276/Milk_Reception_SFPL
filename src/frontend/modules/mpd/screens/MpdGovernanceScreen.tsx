'use client';

import React, { useState } from 'react';
import { ShieldAlert, UserCheck, Search } from 'lucide-react';
import type { GovernanceOverrideTelemetry, ZmccCenterTelemetry } from '../types';
import { InfoTip } from '@/components/ui/info-tip';
import { NO_DATA } from '../format';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatDateTime } from '@/lib/format';

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

  const columns: DataColumn<GovernanceOverrideTelemetry>[] = [
    {
      key: 'reference',
      header: 'Reference',
      label: 'Reference',
      primary: true,
      cell: (o) => (
        <div>
          <div className="tabular-nums font-semibold text-foreground">{o.reference}</div>
          <div className="text-muted-foreground text-xs tabular-nums">{o.id}</div>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      label: 'Source',
      cell: (o) => (
        <div>
          <div className="font-semibold text-foreground">{o.sourceName ?? NO_DATA}</div>
          <span className="inline-block px-2 py-0.5 mt-0.5 rounded text-xs tabular-nums font-semibold bg-muted text-secondary-foreground">{o.stage}</span>
        </div>
      ),
    },
    {
      key: 'parameter',
      header: 'Parameter',
      label: 'Parameter',
      cell: (o) => (
        <div>
          <div className="font-semibold text-rose-700">{o.failedParameter}</div>
          <div className="text-xs tabular-nums text-secondary-foreground">
            Value: <strong>{o.failedValue}</strong> (Limit: {o.toleranceLimit})
          </div>
        </div>
      ),
    },
    {
      key: 'justification',
      header: 'Justification',
      label: 'Justification',
      className: 'max-w-xs',
      cell: (o) => (
        <div>
          <div className="flex items-center gap-1 text-foreground text-xs">
            <span>Remarks</span>
            {o.managerJustification ? <InfoTip text={o.managerJustification} /> : <span>{NO_DATA}</span>}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            System {o.systemOutcome ?? NO_DATA} → final {o.finalDecision ?? NO_DATA}
          </div>
        </div>
      ),
    },
    {
      key: 'overruledBy',
      header: 'Overruled By',
      label: 'Overruled by',
      cell: (o) => (
        <div>
          <div className="text-foreground font-semibold">{o.overruledBy ?? NO_DATA}</div>
          <div className="text-muted-foreground text-xs tabular-nums">{formatDateTime(o.timestamp)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      align: 'center',
      cell: (o) => (
        <span
          className={`inline-block px-3 py-1 rounded-md text-xs font-semibold ${
            o.status === 'APPROVED'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : o.status === 'FLAGGED'
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}
        >
          {o.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (o) =>
        o.status === 'PENDING_AUDIT' ? (
          <div className="flex items-center justify-end gap-2">
            <button
              disabled={actionLoading === o.id}
              onClick={() => handleAction(o.id, 'APPROVED')}
              className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 min-h-11 min-w-11"
            >
              Approve
            </button>
            <button
              disabled={actionLoading === o.id}
              onClick={() => handleAction(o.id, 'FLAGGED')}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 min-h-11 min-w-11"
            >
              Flag
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground ">Audited</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-card border-border border rounded-2xl p-4 shadow-xs">
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
        <div className="bg-card border-border border rounded-2xl p-4 shadow-xs">
          <h3 className="text-xs font-semibold text-foreground">Incomplete unloads (30 days)</h3>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {zmccs.filter((z) => z.leftWithoutFullUnloadingCount > 0 || z.pendingCloseRequestCount > 0).map((z) => (
              <div key={z.id} className="bg-card border-border rounded-lg border p-3 text-xs">
                <div className="font-semibold text-foreground">{z.name}</div>
                <div className="tabular-nums text-secondary-foreground">
                  {z.leftWithoutFullUnloadingCount} left · {z.pendingCloseRequestCount} pending request(s)
                </div>
                <div className="tabular-nums text-muted-foreground">{z.acceptedNotReceivedLiters.toLocaleString()} L accepted, not received</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-2xl border">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border focus:outline-hidden focus:border-primary bg-subtle min-h-11"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStageFilter('ALL')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'ALL' ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground hover:bg-muted'
            }`}
          >
            All ({(overrides ?? []).length})
          </button>
          <button
            onClick={() => setStageFilter('ZMCC_GATE')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'ZMCC_GATE' ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground hover:bg-muted'
            }`}
          >
            ZMCC Gate
          </button>
          <button
            onClick={() => setStageFilter('PLANT_RECEPTION')}
            className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              stageFilter === 'PLANT_RECEPTION' ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground hover:bg-muted'
            }`}
          >
            Plant Reception
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-2"><h2 className="text-xs font-semibold text-foreground">Overrides Log</h2><InfoTip text="Audit records of all operational manager overrides and deviations." /></div>
          </div>
          <span className="text-xs tabular-nums font-medium text-muted-foreground">
            {filteredOverrides.length} record(s)
          </span>
        </div>

        <div className="p-3">
          <DataTable
            columns={columns}
            rows={paginate(filteredOverrides, Math.min(page, pageCount(filteredOverrides.length)))}
            getRowId={(o) => o.id}
            emptyTitle="No overrides found."
            tableFrom="lg"
            footer={<Pager page={Math.min(page, pageCount(filteredOverrides.length))} totalPages={pageCount(filteredOverrides.length)} total={filteredOverrides.length} onPageChange={setPage} />}
          />
        </div>
      </div>
    </div>
  );
};
