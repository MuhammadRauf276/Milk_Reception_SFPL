'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Download, UserCheck, Loader2 } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { canSeeTestPolicies } from '@/lib/test-policy-access';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { DataFilters } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatDateTime } from '@/lib/format';

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
  { key: 'when', header: 'Date and time', label: 'Date and time', primary: true, cell: (r) => <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(r.timestamp)}</span> },
  {
    key: 'user',
    header: 'Actual user',
    label: 'Actual user',
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{r.actualUserName}</div>
        <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs font-medium text-secondary-foreground">{r.actualUserRoleLabel}</span>
      </div>
    ),
  },
  {
    key: 'workspace',
    header: 'Workspace used',
    label: 'Workspace used',
    cell: (r) => <span className="inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{r.performedRoleLabel}</span>,
  },
  { key: 'action', header: 'Action taken', label: 'Action taken', cell: (r) => <span className="font-semibold text-foreground">{r.actionTaken}</span> },
  { key: 'station', header: 'Station', label: 'Station', cell: (r) => <span className="text-secondary-foreground">{r.station}</span> },
  { key: 'reference', header: 'Reference #', label: 'Reference #', cell: (r) => <span className="break-all font-mono font-semibold text-foreground">{r.referenceNumber}</span> },
  { key: 'reason', header: 'Reason / notes', label: 'Reason / notes', cell: (r) => <span className="text-secondary-foreground">{r.reason}</span> },
];

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
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {canSeeTestPolicies(currentUser?.role) && (
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/test-policies">
                <ArrowLeft />
                Back to Lab Policies
              </Link>
            </Button>
          )}
          <p className="min-w-0 text-sm text-muted-foreground">
            Senior accounts acting for lower roles
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

      <div className="rounded-2xl border border-border bg-card p-4 text-xs text-secondary-foreground">
        <div className="flex min-w-0 items-start gap-2">
          <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <span className="font-semibold text-foreground">Audit trail</span>
            <p>
              Times a senior account acted for a lower role. Only senior management sees this.
            </p>
          </div>
        </div>
      </div>

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
            <option value="QA_LAB_ATTENDANT">QA Lab Attendant</option>
            <option value="ZMCC_INSPECTOR">ZMCC Inspector</option>
            <option value="MOT_SHOP_OPERATOR">Mobile Tester Shop Operator</option>
          </select>
        </DataFilters>
      </div>

      <DataTable
        columns={columns}
        rows={filteredRecords}
        getRowId={(r) => r.id}
        loading={isLoading}
        error={error ? getErrorMessage(error) || 'Failed to load report records.' : null}
        onRetry={() => void refetch()}
        emptyTitle="No cross-role activity"
        emptyDescription="Nothing matches the selected filter."
        tableFrom="lg"
      />
    </div>
  );
}
