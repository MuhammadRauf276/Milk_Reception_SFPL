'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, Search, ShieldAlert } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { PaginationBar } from '@/frontend/modules/super-admin/shared/PaginationBar';

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

interface AuditResponse {
  auditLogs?: AuditLogItem[];
  pagination?: { totalRecords: number; totalPages: number; page: number };
}

const PAGE_SIZE = 25;
const ENTITY_OPTIONS = ['', 'users', 'procurement_source', 'silo', 'lab_test', 'lab_test_rule', 'vehicle_visit'].map((v) => ({
  value: v,
  label: v || 'All entities',
}));

export default function SuperAdminAuditPage() {
  const [tableName, setTableName] = useState('');
  const [actionSearch, setActionSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const action = useDebouncedValue(actionSearch.trim(), 300);
  const filters = useMemo(() => ({ tableName, action, page }), [tableName, action, page]);

  const query = useQuery({
    queryKey: ['super-admin', 'audit', filters],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (tableName) params.set('tableName', tableName);
      if (action) params.set('action', action);
      return fetchJson<AuditResponse>(`/api/super-admin/audit?${params}`, { signal });
    },
    placeholderData: keepPreviousData,
  });

  const logs = query.data?.auditLogs ?? [];
  const pagination = query.data?.pagination;
  const error = query.error ? getErrorMessage(query.error) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">System Audit & Immutable History Log</h1>

      <div className="grid gap-2 sm:grid-cols-[1fr_16rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={actionSearch}
            onChange={(e) => {
              setActionSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search action (e.g. UPDATE)"
            aria-label="Search audit action"
            className="h-11 w-full rounded-xl border border-border-strong bg-white pl-9 pr-3 text-sm focus:outline-hidden focus:border-primary"
          />
        </div>
        <Combobox
          options={ENTITY_OPTIONS}
          value={tableName}
          onValueChange={(v) => {
            setTableName(v);
            setPage(1);
          }}
          searchPlaceholder="Filter entity"
        />
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 animate-panel-in">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border/80 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-subtle text-slate-600">
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
              {query.isPending ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center tabular-nums text-slate-400">
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
                logs.map((l) => {
                  const open = expanded === l.id;
                  const cellClass = open ? 'whitespace-pre-wrap break-all' : 'max-w-xs truncate';
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setExpanded(open ? null : l.id)}
                      className={`cursor-pointer align-top hover:bg-slate-50 ${query.isPlaceholderData ? 'opacity-60' : ''}`}
                    >
                      <td className="whitespace-nowrap p-3 text-[11px] tabular-nums text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : '-rotate-90'}`} aria-hidden="true" />
                          {new Date(l.createdAt).toLocaleString()}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-foreground">{l.user}</td>
                      <td className="p-3">
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-blue-900">{l.action}</span>
                      </td>
                      <td className="p-3 tabular-nums text-slate-700">{l.tableName}</td>
                      <td className={`p-3 text-[10px] tabular-nums text-slate-500 ${cellClass}`}>
                        {l.oldValues ? JSON.stringify(l.oldValues) : '-'}
                      </td>
                      <td className={`p-3 text-[10px] tabular-nums text-slate-700 ${cellClass}`}>
                        {l.newValues ? JSON.stringify(l.newValues) : '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          totalRecords={pagination?.totalRecords ?? logs.length}
          noun="audit entries"
          disabled={query.isFetching}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
