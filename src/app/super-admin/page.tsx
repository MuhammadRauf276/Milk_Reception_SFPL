'use client';

import React, { useEffect, useState } from 'react';
import { Users, Truck, Database, FlaskConical, AlertCircle } from 'lucide-react';

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
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOverview() {
      try {
        const res = await fetch('/api/super-admin/overview');
        const data = await res.json();
        if (res.ok) {
          setMetrics(data.metrics);
          setRecentAudit(data.recentAudit || []);
        } else {
          setError(data.error || 'Failed to load overview data.');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchOverview();
  }, []);

  if (loading) {
    return <div className="p-8 text-xs font-mono font-bold text-slate-600">Loading Super Admin Overview...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-[#111311]">System Architecture & Master Overview</h1>
        <p className="text-xs font-semibold text-slate-500 mt-1">
          Real-time enterprise metric monitoring across database models and administration layers.
        </p>
      </div>

      {/* METRIC CARDS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-[#C4B9A3] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-black uppercase text-slate-600">User Accounts</span>
            <Users className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-3xl font-black font-mono text-[#111311]">{metrics?.totalUsers ?? '—'}</div>
          <div className="text-[11px] font-bold text-emerald-700">{metrics?.activeUsers ?? 0} Active Accounts</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#C4B9A3] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-black uppercase text-slate-600">Procurement Sources</span>
            <Truck className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-3xl font-black font-mono text-[#111311]">{metrics?.totalSources ?? '—'}</div>
          <div className="text-[11px] font-bold text-slate-600">
            {metrics?.activeZmccs ?? 0} ZMCCs | {metrics?.activeContractors ?? 0} Contractors
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#C4B9A3] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-black uppercase text-slate-600">Silo Tanks</span>
            <Database className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-3xl font-black font-mono text-[#111311]">{metrics?.totalSilos ?? '—'}</div>
          <div className="text-[11px] font-bold text-emerald-700">{metrics?.activeSilos ?? 0} Active Storage Silos</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#C4B9A3] shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-black uppercase text-slate-600">Lab Tests & Rules</span>
            <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-3xl font-black font-mono text-[#111311]">{metrics?.totalLabTests ?? '—'}</div>
          <div className="text-[11px] font-bold text-slate-600">
            {metrics?.activeLabTests ?? 0} Active Tests | {metrics?.activeRules ?? 0} Active SOP Rules
          </div>
        </div>
      </div>

      {/* RECENT AUDIT LOG TABLE */}
      <div className="bg-white rounded-2xl border border-[#C4B9A3] shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-black text-[#111311]">Recent System Events & Audit Trail</h2>
        <div className="overflow-x-auto rounded-xl border border-[#C4B9A3]">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-[#EFE9D9]/60 border-b border-[#C4B9A3] text-slate-700 uppercase font-black text-[10px] tracking-wider whitespace-nowrap">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">User</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5] font-semibold text-[#111311]">
              {recentAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500 font-bold">
                    No recent audit events recorded.
                  </td>
                </tr>
              ) : (
                recentAudit.map((item) => (
                  <tr key={item.id} className="hover:bg-[#EFE9D9]/30 transition-colors">
                    <td className="p-3 font-mono text-slate-600 whitespace-nowrap">{item.timestamp}</td>
                    <td className="p-3 font-bold text-[#111311] whitespace-nowrap">{item.user}</td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-[#1E3A8A] font-mono text-[10px] font-black">
                        {item.action}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-700 whitespace-nowrap">{item.entity}</td>
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
