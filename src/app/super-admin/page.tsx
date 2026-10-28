'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, Truck, Database, FlaskConical, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { InfoTip } from '@/components/ui/info-tip';
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
        <div className="flex items-center justify-between gap-1.5 max-w-xs">
          <span className="truncate text-xs font-semibold text-foreground">{brief}</span>
          <InfoTip text={<pre className="text-[10px] tabular-nums font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">{formattedJson}</pre>} label="Full record" />
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
      <div className="flex items-center justify-between gap-1.5 max-w-xs">
        <span className="truncate text-xs font-semibold text-foreground">{display}…</span>
        <InfoTip text={<div className="text-xs break-all max-h-40 overflow-y-auto">{summary}</div>} label="Full text" />
      </div>
    );
  }

  return <span className="text-xs font-semibold text-foreground">{summary}</span>;
}

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
    return <div className="p-8 text-xs tabular-nums font-semibold text-slate-600">Loading…</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-card border border-border rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        actions={
          <Link
            href="/super-admin/daily-report"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-primary-hover transition"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Daily Report</span>
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
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
      <div className="bg-card rounded-xl border border-border shadow-2xs p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            <InfoTip text="Live chronological event log across plant reception and field procurement." />
          </div>
          <Link href="/super-admin/audit" className="text-xs font-semibold text-primary hover:underline">
            View All
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase font-semibold text-[10px] tracking-wider whitespace-nowrap">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-semibold text-foreground">
              {recentAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground font-semibold">
                    No recent events.
                  </td>
                </tr>
              ) : (
                recentAudit.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                    <td className="p-3 tabular-nums text-muted-foreground whitespace-nowrap text-xs">
                      {item.timestamp ? item.timestamp.split('T')[1]?.slice(0, 8) || item.timestamp : '—'}
                    </td>
                    <td className="p-3 font-semibold text-foreground whitespace-nowrap">{item.user}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-muted text-foreground border border-border tabular-nums text-[10px] font-semibold">
                        {item.action}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums text-muted-foreground whitespace-nowrap">{item.entity}</td>
                    <td className="p-3">{renderAuditSummary(item.summary)}</td>
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
