'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { formatDateTime } from '@/lib/format';

interface WarningItem {
  id: string;
  procurementSourceId: string;
  procurementSource: {
    code: string;
    name: string;
    sourceType: string;
  };
  visitId: string | null;
  portionId: string | null;
  labTest: { code: string; name: string } | null;
  reason: string;
  status: string;
  createdAt: string;
  createdBy: string;
  acknowledgedBy: string | null;
}

interface MonthlySummaryItem {
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  sourceType: string;
  activeWarningCount: number;
}

const columns: DataColumn<WarningItem>[] = [
  { key: 'when', header: 'Timestamp', label: 'Timestamp', cell: (w) => <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(w.createdAt)}</span> },
  {
    key: 'source',
    header: 'Procurement source',
    label: 'Procurement source',
    primary: true,
    cell: (w) => (
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{w.procurementSource.name}</div>
        <div className="break-all font-mono text-xs text-muted-foreground">{w.procurementSource.code}</div>
      </div>
    ),
  },
  { key: 'test', header: 'Lab test', label: 'Lab test', cell: (w) => <span className="text-secondary-foreground">{w.labTest?.name || '-'}</span> },
  { key: 'reason', header: 'Reason', label: 'Reason', cell: (w) => <span className="text-foreground">{w.reason}</span> },
  { key: 'by', header: 'Created by', label: 'Created by', cell: (w) => <span className="text-secondary-foreground">{w.createdBy}</span> },
  { key: 'status', header: 'Status', label: 'Status', cell: (w) => <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{w.status}</span> },
];

export default function SuperAdminQaWarningsPage() {
  const query = useQuery({
    queryKey: ['super-admin', 'qa-warnings'],
    queryFn: ({ signal }) =>
      fetchJson<{ warnings?: WarningItem[]; monthlySummary?: MonthlySummaryItem[] }>('/api/super-admin/qa-warnings', { signal }),
  });
  const warnings = query.data?.warnings ?? [];
  const summary = query.data?.monthlySummary ?? [];
  const loading = query.isPending;
  const error = query.error ? getErrorMessage(query.error) : null;

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* MONTHLY SUMMARY PER SOURCE */}
      <div className="min-w-0 space-y-3 rounded-2xl border border-border/80 bg-card p-5 shadow-2xs">
        <h2 className="text-sm font-semibold text-foreground">Monthly warnings</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 text-xs">
          {summary.map((s) => (
            <div key={s.sourceId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0">
                <div className="font-semibold text-foreground">{s.sourceName}</div>
                <div className="break-all font-mono text-xs text-muted-foreground">{s.sourceCode} ({s.sourceType})</div>
              </div>
              <div className="rounded bg-amber-100 px-3 py-1 text-sm font-semibold tabular-nums text-amber-900">
                {s.activeWarningCount} warnings
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WARNING EVENT RECORDS */}
      <div className="min-w-0 space-y-2 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span>Warning log</span>
        </h2>

        <DataTable
          columns={columns}
          rows={warnings}
          getRowId={(w) => w.id}
          loading={loading}
          error={error}
          onRetry={() => void query.refetch()}
          emptyTitle="No warnings"
          tableFrom="lg"
        />
      </div>
    </div>
  );
}
