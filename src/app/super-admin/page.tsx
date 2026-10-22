'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Truck, Database, FlaskConical, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
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
    return <div className="p-8 text-xs tabular-nums font-semibold text-slate-600">Loading Super Admin Overview…</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2">
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration overview"
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
          hint={`${metrics?.activeLabTests ?? 0} active tests · ${metrics?.activeRules ?? 0} SOP rules`}
        />
      </div>

      {/* RECENT AUDIT LOG TABLE */}
      <div className="bg-white rounded-xl border border-border-strong shadow-xs p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Recent System Events & Audit Trail</h2>
        <div className="overflow-x-auto rounded-xl border border-border-strong">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-muted/60 border-b border-border-strong text-slate-700 uppercase font-semibold text-[10px] tracking-wider whitespace-nowrap">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-semibold text-foreground">
              {recentAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500 font-semibold">
                    No recent audit events recorded.
                  </td>
                </tr>
              ) : (
                recentAudit.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 tabular-nums text-slate-600 whitespace-nowrap">{item.timestamp}</td>
                    <td className="p-3 font-semibold text-foreground whitespace-nowrap">{item.user}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-primary tabular-nums text-[10px] font-semibold">
                        {item.action}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums text-slate-700 whitespace-nowrap">{item.entity}</td>
                    <td className="p-3 text-slate-600">{item.summary}</td>
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
