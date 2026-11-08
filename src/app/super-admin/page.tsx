'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, Truck, Database, FlaskConical, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { InfoTip } from '@/components/ui/info-tip';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/empty-state';
import { SkeletonStats, SkeletonTable } from '@/components/ui/loaders';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';

interface OverviewMetrics {
  totalUsers: number;
  activeUsers: number;
  totalSources: number;
  activeZmccs: number;
  activeContractors: number;
  totalSilos: number;
  activeSilos: number;
  totalLabTests: number;
  activeLabTests: number;
  activeRules: number;
  pendingInventoryCount: number;
}

interface AuditItem {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  entity: string;
  summary: string;
}

function renderAuditSummary(summary: string) {
  if (!summary) return <span className="text-muted-foreground">—</span>;

  try {
    const raw = summary.trim();
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      const parts: string[] = [];
      if (parsed.visit_id) parts.push(`Visit #${parsed.visit_id}`);
      if (parsed.silo_id) parts.push(`Silo #${parsed.silo_id}`);
      if (parsed.portion_id) parts.push(`Portion #${parsed.portion_id}`);
      if (parsed.net_weight_kg) parts.push(`${Number(parsed.net_weight_kg).toLocaleString()} kg`);
      if (parsed.liters) parts.push(`${Number(parsed.liters).toLocaleString()} L`);
      if (parsed.token_number) parts.push(parsed.token_number);

      const brief = parts.slice(0, 2).join(' · ') || 'System record';
      const formattedJson = JSON.stringify(parsed, null, 2);
      return (
        <div className="flex max-w-xs items-center justify-between gap-1.5">
          <span className="min-w-0 break-words text-xs font-medium text-foreground">{brief}</span>
          <InfoTip text={<pre className="text-xs tabular-nums font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{formattedJson}</pre>} label="Full record" />
        </div>
      );
    }
  } catch {}

  // If longer than 25 chars or more than 4 words, truncate cleanly and provide InfoTip
  if (summary.length > 25 || summary.split(/\s+/).length > 4) {
    const cleanText = summary.replace(/[{}"_]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanText.split(' ').filter(Boolean);
    const display = words.slice(0, 3).join(' ') || summary.slice(0, 20);
    return (
      <div className="flex max-w-xs items-center justify-between gap-1.5">
        <span className="min-w-0 break-words text-xs font-medium text-foreground">{display}…</span>
        <InfoTip text={<div className="text-xs break-all max-h-40 overflow-y-auto">{summary}</div>} label="Full text" />
      </div>
    );
  }

  return <span className="text-xs font-semibold text-foreground">{summary}</span>;
}

const auditColumns: DataColumn<AuditItem>[] = [
  {
    key: 'time',
    header: 'Time',
    label: 'Time',
    cell: (item) => <span className="text-xs tabular-nums text-muted-foreground">{item.timestamp ? item.timestamp.split('T')[1]?.slice(0, 8) || item.timestamp : '—'}</span>,
  },
  { key: 'user', header: 'User', label: 'User', primary: true, cell: (item) => <span className="font-semibold text-foreground">{item.user}</span> },
  {
    key: 'action',
    header: 'Action',
    label: 'Action',
    cell: (item) => <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{item.action}</span>,
  },
  { key: 'entity', header: 'Entity', label: 'Entity', cell: (item) => <span className="text-muted-foreground">{item.entity}</span> },
  { key: 'summary', header: 'Summary', label: 'Summary', cell: (item) => renderAuditSummary(item.summary) },
];

export default function SuperAdminOverviewPage() {
  const query = useQuery({
    queryKey: ['super-admin', 'overview'],
    queryFn: ({ signal }) =>
      fetchJson<{ metrics: OverviewMetrics; recentAudit?: AuditItem[] }>('/api/super-admin/overview', { signal }),
  });
  const metrics = query.data?.metrics ?? null;
  const recentAudit = query.data?.recentAudit ?? [];
  const loading = query.isPending;
  const error = query.error ? getErrorMessage(query.error) || 'Failed to load overview data.' : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonStats count={4} />
        <SkeletonTable rows={6} />
      </div>
    );
  }

  if (error) {
    return <ErrorState description={error} onRetry={() => void query.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        actions={
          <Button asChild>
            <Link href="/super-admin/daily-report">
              <FileSpreadsheet />
              Daily report
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 stagger-children">
        <StatCard
          label="User accounts"
          icon={Users}
          value={metrics?.totalUsers ?? '—'}
          hint={`${metrics?.activeUsers ?? 0} active`}
        />
        <StatCard
          label="Procurement sources"
          icon={Truck}
          value={metrics?.totalSources ?? '—'}
          hint={`${metrics?.activeZmccs ?? 0} ZMCCs · ${metrics?.activeContractors ?? 0} contractors`}
        />
        <StatCard
          label="Silo tanks"
          icon={Database}
          value={metrics?.totalSilos ?? '—'}
          hint={`${metrics?.activeSilos ?? 0} active`}
        />
        <StatCard
          label="Lab tests"
          icon={FlaskConical}
          value={metrics?.totalLabTests ?? '—'}
          hint={`${metrics?.activeLabTests ?? 0} active · ${metrics?.activeRules ?? 0} rules`}
        />
      </div>

      {/* RECENT AUDIT LOG TABLE */}
      <div className="bg-card rounded-2xl border border-border shadow-2xs p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
            <InfoTip text="Live chronological event log across plant reception and field procurement." />
          </div>
          <Link href="/super-admin/audit" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        </div>
        <DataTable
          columns={auditColumns}
          rows={recentAudit}
          getRowId={(item) => item.id}
          emptyTitle="No recent events"
          tableFrom="lg"
        />
      </div>
    </div>
  );
}
