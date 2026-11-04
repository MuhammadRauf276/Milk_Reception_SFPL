'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Download, Filter, Search, ShieldAlert, UserCheck, Loader2 } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { canSeeTestPolicies } from '@/lib/test-policy-access';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

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

export default function HierarchyWorkPage() {
  const { currentUser } = useCurrentUser();
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
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {canSeeTestPolicies(currentUser?.role) && (
            <Link
              href="/super-admin/test-policies"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Lab Policies</span>
            </Link>
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-900">Work Done for Lower Roles</h1>
            <p className="text-xs text-slate-500">
              Cross-role activity log: when senior users or Super Admins work in subordinate workspaces
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Info Card */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 text-xs text-sky-900">
        <div className="flex items-start gap-2.5">
          <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <div className="space-y-0.5">
            <span className="font-semibold">Executive Transparency & Audit Trail:</span>
            <p className="text-sky-800">
              This report records all instances where a higher-ranking account (such as Super Admin, QA Head, or Plant Manager)
              stepped in to perform operational actions on behalf of a subordinate role (e.g. during operator absence or operational escalation).
              Junior field staff only see clean status records (&quot;Accepted&quot; / &quot;Rejected&quot;); confidential override context is strictly limited to executive management.
            </p>
          </div>
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
            <option value="QA_LAB_ATTENDANT">QA Lab Attendant</option>
            <option value="ZMCC_INSPECTOR">ZMCC Inspector</option>
            <option value="MOT_SHOP_OPERATOR">Mobile Tester Shop Operator</option>
          </select>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{getErrorMessage(error) || 'Failed to load report records.'}</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-100/80 text-slate-700">
              <tr>
                <th className="p-3 font-bold">Date & Time</th>
                <th className="p-3 font-bold">Actual User</th>
                <th className="p-3 font-bold">Workspace Used</th>
                <th className="p-3 font-bold">Action Taken</th>
                <th className="p-3 font-bold">Station</th>
                <th className="p-3 font-bold">Reference #</th>
                <th className="p-3 font-bold">Reason / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    Loading cross-role activity records…
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No cross-role activities recorded matching the selected filter.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-slate-50/80">
                    <td className="p-3 font-mono text-[11px] tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{r.actualUserName}</div>
                      <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        {r.actualUserRoleLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                        {r.performedRoleLabel}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-800">
                      {r.actionTaken}
                    </td>
                    <td className="p-3 text-slate-600">
                      {r.station}
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-900">
                      {r.referenceNumber}
                    </td>
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
