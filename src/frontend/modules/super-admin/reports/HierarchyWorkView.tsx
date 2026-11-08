'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, UserCheck, Loader2 } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { DataFilters } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';

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

const columns: DataColumn<HierarchyWorkItem>[] = [
  { key: 'when', header: 'Timestamp', label: 'Timestamp', cell: (r) => <span className="tabular-nums text-muted-foreground">{r.timestamp}</span> },
  {
    key: 'user',
    header: 'Actual user',
    label: 'Actual user',
    primary: true,
    cell: (r) => (
      <div className="min-w-0 font-semibold text-foreground">
        {r.actualUserName}
        <span className="block text-xs font-normal text-muted-foreground">{r.actualUserRoleLabel}</span>
      </div>
    ),
  },
  {
    key: 'acting',
    header: 'Acting as (lower role)',
    label: 'Acting as (lower role)',
    cell: (r) => <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{r.performedRoleLabel}</span>,
  },
  { key: 'action', header: 'Action taken', label: 'Action taken', cell: (r) => <span className="font-semibold text-foreground">{r.actionTaken}</span> },
  { key: 'station', header: 'Station', label: 'Station', cell: (r) => <span className="text-secondary-foreground">{r.station}</span> },
  { key: 'reference', header: 'Reference #', label: 'Reference #', cell: (r) => <span className="break-all font-mono tabular-nums text-secondary-foreground">{r.referenceNumber}</span> },
  { key: 'reason', header: 'Reason / context', label: 'Reason / context', cell: (r) => <span className="text-secondary-foreground">{r.reason}</span> },
];

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
    <div className="min-w-0 space-y-4">
      {/* Top Banner / Info Card */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <div className="flex min-w-0 items-start gap-3">
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Work done for lower roles</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-secondary-foreground">
              Audit trail of senior accounts (Super Admin, QA Head, ZMCC Manager) acting for lower roles
              when an operator was absent or a case was escalated.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <Loader2 className={isFetching ? 'animate-spin' : 'text-muted-foreground'} />
            Refresh
          </Button>
          <Button onClick={exportCsv} disabled={filteredRecords.length === 0}>
            <Download />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-2xl border border-border bg-card p-3 shadow-2xs">
        <DataFilters search={searchQuery} onSearchChange={setSearchQuery} searchPlaceholder="Search by user, token, station or note">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Lower role"
            className="min-h-11 min-w-0 max-w-full rounded-lg border border-input bg-card px-3 text-sm text-secondary-foreground focus:border-primary focus:outline-hidden"
          >
            <option value="">All lower roles</option>
            <option value="QA_OFFICER">Plant QA Officer (QAE)</option>
            <option value="QA_HEAD">QA Head / AVP Reception Lab</option>
            <option value="ZMCC_LAB_ATTENDANT">ZMCC Lab Attendant</option>
            <option value="MOT">Mobile Tester</option>
            <option value="WEIGHBRIDGE_OPERATOR">Weighbridge Operator</option>
            <option value="SECURITY_GUARD">Security Gate Officer</option>
          </select>
        </DataFilters>
      </div>

      <DataTable
        columns={columns}
        rows={filteredRecords}
        getRowId={(r) => r.id}
        loading={isLoading}
        error={error ? getErrorMessage(error) || 'Failed to load hierarchy work records' : null}
        onRetry={() => void refetch()}
        emptyTitle="No cross-role actions"
        emptyDescription="Nothing was recorded for this filter."
        tableFrom="lg"
      />
    </div>
  );
}
