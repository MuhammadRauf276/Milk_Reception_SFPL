'use client';

import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';

interface AuditLogItem {
  id: string;
  tableName: string;
  recordId: string | null;
  action: string;
  oldValues: unknown;
  newValues: unknown;
  user: string;
  createdAt: string;
}

export default function SuperAdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableNameFilter, setTableNameFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // The committed request; a new object re-runs the fetch even for identical values.
  const [request, setRequest] = useState({ tableName: '', page: 1 });

  useEffect(() => {
    let ignore = false;
    fetchJson<{ auditLogs?: AuditLogItem[]; pagination?: { totalRecords: number; totalPages: number; page: number } }>(
      `/api/super-admin/audit?tableName=${encodeURIComponent(request.tableName)}&page=${request.page}&pageSize=${pageSize}`
    )
      .then(
        (data) => {
          if (ignore) return;
          setLogs(data.auditLogs || []);
          if (data.pagination) {
            setTotalRecords(data.pagination.totalRecords);
            setTotalPages(data.pagination.totalPages);
            setPage(data.pagination.page);
          }
          setError(null);
        },
        (err) => {
          if (!ignore) setError(getErrorMessage(err));
        }
      )
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [request, pageSize]);

  const goToPage = (pageNum: number) => {
    setLoading(true);
    setRequest((current) => ({ ...current, page: pageNum }));
  };

  const handleFilterChange = (tbl: string) => {
    setTableNameFilter(tbl);
    setLoading(true);
    setRequest({ tableName: tbl, page: 1 });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Audit & Immutable History Log</h1>
        </div>

        {/* TABLE FILTER */}
        <div className="flex items-center space-x-2 text-xs">
          <label className="font-semibold text-slate-700">Filter Entity:</label>
          <select
            value={tableNameFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="p-2 rounded-xl border border-border-strong bg-white font-semibold focus:outline-hidden focus:border-primary"
          >
            <option value="">All entities</option>
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
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold flex items-center space-x-2 animate-panel-in">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* AUDIT LOG TABLE */}
      <div className="bg-white rounded-xl border border-border/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-subtle text-slate-600 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Timestamp</th>
                <th className="p-3 font-semibold">User</th>
                <th className="p-3 font-semibold">Action</th>
                <th className="p-3 font-semibold">Entity Table</th>
                <th className="p-3 font-semibold">Old Values</th>
                <th className="p-3 font-semibold">New Values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400 tabular-nums">
                    Loading audit trail…
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
                    <td className="p-3 tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3 font-semibold text-foreground">{l.user}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 tabular-nums text-[10px] font-semibold">
                        {l.action}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums text-slate-700">{l.tableName}</td>
                    <td className="p-3 tabular-nums text-[10px] text-slate-500 max-w-xs truncate">
                      {l.oldValues ? JSON.stringify(l.oldValues) : '-'}
                    </td>
                    <td className="p-3 tabular-nums text-[10px] text-slate-700 max-w-xs truncate">
                      {l.newValues ? JSON.stringify(l.newValues) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PAGINATION CONTROLS */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white px-4 py-3 border border-border rounded-xl text-xs font-semibold text-slate-700">
          <div>
            Showing page <span className="font-semibold text-primary">{page}</span> of{' '}
            <span className="font-semibold text-primary">{totalPages}</span> ({totalRecords.toLocaleString()} total audit entries)
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => goToPage(Math.max(1, page - 1))}
              className="px-3 py-1.5 rounded-lg border border-border-strong hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              className="px-3 py-1.5 rounded-lg border border-border-strong hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
