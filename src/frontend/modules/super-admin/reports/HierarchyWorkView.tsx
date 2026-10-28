'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Filter, Search, ShieldAlert, UserCheck, Loader2 } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';

interface HierarchyWorkItem {
  id: string;
  timestamp: string;
  actualUserId: string;
  actualUserName: string;
  actualUserRole: string;
  actualUserRoleLabel: string;
  performedRole: string;
  performedRoleLabel: string;
  actionTaken: string;
  station: string;
  referenceNumber: string;
  reason: string;
}

interface ApiResponse {
  records: HierarchyWorkItem[];
  count: number;
}

export function HierarchyWorkView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ['super-admin', 'hierarchy-work', roleFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (roleFilter) sp.set('performedRole', roleFilter);
      sp.set('limit', '100');
      return fetchJson<ApiResponse>(`/api/super-admin/hierarchy-work?${sp.toString()}`, {
        cache: 'no-store',
      });
    },
  });

  const records = data?.records ?? [];

  const filteredRecords = records.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.actualUserName.toLowerCase().includes(q) ||
      r.actualUserRoleLabel.toLowerCase().includes(q) ||
      r.performedRoleLabel.toLowerCase().includes(q) ||
      r.referenceNumber.toLowerCase().includes(q) ||
      r.station.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q)
    );
  });

  const exportCsv = () => {
    if (filteredRecords.length === 0) return;
    const headers = [
      'Timestamp',
      'Actual User',
      'Actual Role',
      'Lower Role Used',
      'Action Taken',
      'Station',
      'Reference #',
      'Reason',
    ];
    const rows = filteredRecords.map((r) => [
      `"${r.timestamp}"`,
      `"${r.actualUserName}"`,
      `"${r.actualUserRoleLabel}"`,
      `"${r.performedRoleLabel}"`,
      `"${r.actionTaken}"`,
      `"${r.station}"`,
      `"${r.referenceNumber}"`,
      `"${r.reason.replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `work-done-for-lower-roles-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner / Info Card */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-sky-200 bg-sky-50/70 p-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-sky-950">Work Done for Lower Roles (Executive Audit Log)</h2>
            <p className="mt-0.5 text-xs text-sky-800 leading-relaxed">
              Transparent audit trail tracking when senior accounts (Super Admin, QA Head, ZMCC Manager) stepped in to perform
              actions on behalf of subordinate roles during operator absence or escalation.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Loader2 className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredRecords.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white shadow-2xs transition hover:bg-primary-hover disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by user name, tanker token, station, or note…"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs focus:border-primary focus:bg-white focus:outline-hidden"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 focus:border-primary focus:bg-white focus:outline-hidden"
          >
            <option value="">All Lower Roles</option>
            <option value="QA_OFFICER">Plant QA Officer (QAE)</option>
            <option value="QA_HEAD">QA Head / AVP Reception Lab</option>
            <option value="ZMCC_LAB_ATTENDANT">ZMCC Lab Attendant</option>
            <option value="MOT">Mobile Tester (MOT)</option>
            <option value="WEIGHBRIDGE_OPERATOR">Weighbridge Operator</option>
            <option value="SECURITY_GUARD">Security Gate Officer</option>
          </select>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{getErrorMessage(error) || 'Failed to load hierarchy work records'}</span>
        </div>
      )}

      {/* Records Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-medium text-slate-800">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Actual User</th>
                <th className="p-3">Acting As (Subordinate)</th>
                <th className="p-3">Action Taken</th>
                <th className="p-3">Station</th>
                <th className="p-3">Reference #</th>
                <th className="p-3">Reason / Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Loading cross-role activity records…
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No cross-role actions recorded for this filter.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition">
                    <td className="p-3 tabular-nums text-slate-500 whitespace-nowrap">{r.timestamp}</td>
                    <td className="p-3 font-semibold text-slate-900 whitespace-nowrap">
                      {r.actualUserName}
                      <span className="block text-[10px] text-slate-400 font-normal">{r.actualUserRoleLabel}</span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                        {r.performedRoleLabel}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-800 whitespace-nowrap">{r.actionTaken}</td>
                    <td className="p-3 text-slate-600 whitespace-nowrap">{r.station}</td>
                    <td className="p-3 tabular-nums font-mono text-slate-700 whitespace-nowrap">{r.referenceNumber}</td>
                    <td className="p-3 text-slate-600 max-w-xs truncate" title={r.reason}>
                      {r.reason}
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
}
