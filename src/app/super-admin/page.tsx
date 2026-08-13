'use client';

import React, { useEffect, useState } from 'react';
import { Users, Truck, Database, FlaskConical, BookOpen, Clock, AlertCircle } from 'lucide-react';

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
        <p className="text-xs font-medium text-slate-500 mt-1">
          Real-time enterprise metric monitoring across database models and administration layers.
        </p>
      </div>

      {/* METRIC CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-[#EAE4D5]/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">User Accounts</span>
            <Users className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-2xl font-black text-[#111311]">{metrics?.totalUsers}</div>
          <div className="text-[11px] font-semibold text-emerald-700">{metrics?.activeUsers} Active Accounts</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE4D5]/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Procurement Sources</span>
            <Truck className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-2xl font-black text-[#111311]">{metrics?.totalSources}</div>
          <div className="text-[11px] font-semibold text-slate-600">
            {metrics?.activeZmccs} ZMCCs | {metrics?.activeContractors} Contractors
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE4D5]/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Silo Tanks</span>
            <Database className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-2xl font-black text-[#111311]">{metrics?.totalSilos}</div>
          <div className="text-[11px] font-semibold text-emerald-700">{metrics?.activeSilos} Active Storage Silos</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE4D5]/80 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Lab Tests & Rules</span>
            <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="text-2xl font-black text-[#111311]">{metrics?.totalLabTests}</div>
          <div className="text-[11px] font-semibold text-slate-600">
            {metrics?.activeLabTests} Active Tests | {metrics?.activeRules} Active SOP Rules
          </div>
        </div>
      </div>

      {/* PENDING FINALIZATIONS BANNER */}
      <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between text-xs font-bold text-amber-900">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            Pending Inventory Finalizations (Vehicles in <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">TARE_WEIGHED</code> status):
          </span>
        </div>
        <span className="font-mono text-sm font-black px-2.5 py-1 bg-amber-200 text-amber-950 rounded-lg">
          {metrics?.pendingInventoryCount} Vehicles
        </span>
      </div>

      {/* RECENT AUDIT LOG ACTIVITY */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-extrabold text-[#111311] flex items-center space-x-2">
          <BookOpen className="w-4 h-4 text-[#1E3A8A]" />
          <span>Recent Administrative Audit Activity</span>
        </h2>

        {recentAudit.length === 0 ? (
          <p className="text-xs text-slate-400 font-medium py-4">No recent audit activity found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
                <tr>
                  <th className="p-2.5 font-bold">Timestamp</th>
                  <th className="p-2.5 font-bold">User</th>
                  <th className="p-2.5 font-bold">Action</th>
                  <th className="p-2.5 font-bold">Entity</th>
                  <th className="p-2.5 font-bold">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
                {recentAudit.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono text-[11px] text-slate-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 font-bold text-[#111311]">{log.user}</td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1E3A8A] font-mono text-[10px] font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-2.5 font-mono text-slate-600">{log.entity}</td>
                    <td className="p-2.5 text-slate-500 truncate max-w-xs">{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
