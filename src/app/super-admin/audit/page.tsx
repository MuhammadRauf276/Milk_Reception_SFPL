'use client';

import React, { useEffect, useState } from 'react';
import { History, Search, ShieldAlert, FileText } from 'lucide-react';

interface AuditLogItem {
  id: string;
  tableName: string;
  recordId: string | null;
  action: string;
  oldValues: any;
  newValues: any;
  user: string;
  createdAt: string;
}

export default function SuperAdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableNameFilter, setTableNameFilter] = useState('');

  async function loadLogs(tbl = '') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/audit?tableName=${encodeURIComponent(tbl)}`);
      const data = await res.json();
      if (res.ok) setLogs(data.auditLogs || []);
      else setError(data.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const handleFilterChange = (tbl: string) => {
    setTableNameFilter(tbl);
    loadLogs(tbl);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-[#111311]">System Audit & Immutable History Log</h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            Complete immutable audit trail of system configurations, user changes, and data updates in PostgreSQL.
          </p>
        </div>

        {/* TABLE FILTER */}
        <div className="flex items-center space-x-2 text-xs">
          <label className="font-bold text-slate-700">Filter Entity:</label>
          <select
            value={tableNameFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="p-2 rounded-xl border border-[#C4B9A3] bg-white font-semibold focus:outline-none focus:border-[#1E3A8A]"
          >
            <option value="">All Entities</option>
            <option value="users">users</option>
            <option value="procurement_source">procurement_source</option>
            <option value="silo">silo</option>
            <option value="lab_test">lab_test</option>
            <option value="lab_test_rule">lab_test_rule</option>
            <option value="vehicle_visit">vehicle_visit</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* AUDIT LOG TABLE */}
      <div className="bg-white rounded-xl border border-[#EAE4D5]/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FDFBF9] text-slate-600 border-b border-[#EAE4D5]">
              <tr>
                <th className="p-3 font-bold">Timestamp</th>
                <th className="p-3 font-bold">User</th>
                <th className="p-3 font-bold">Action</th>
                <th className="p-3 font-bold">Entity Table</th>
                <th className="p-3 font-bold">Old Values</th>
                <th className="p-3 font-bold">New Values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE4D5]/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400 font-mono">
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    No audit log entries recorded.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 font-bold text-[#111311]">{l.user}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-mono text-[10px] font-bold">
                        {l.action}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-slate-700">{l.tableName}</td>
                    <td className="p-3 font-mono text-[10px] text-slate-500 max-w-xs truncate">
                      {l.oldValues ? JSON.stringify(l.oldValues) : '-'}
                    </td>
                    <td className="p-3 font-mono text-[10px] text-slate-700 max-w-xs truncate">
                      {l.newValues ? JSON.stringify(l.newValues) : '-'}
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
