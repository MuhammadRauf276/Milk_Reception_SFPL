'use client';

import { InfoTip } from '@/components/ui/info-tip';
import React, { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { DataFilters, type ActiveFilter } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { formatDateTime } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { useListPageSize } from '@/components/ui/pagination';

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

const ENTITY_OPTIONS = ['', 'users', 'procurement_source', 'silo', 'lab_test', 'lab_test_rule', 'vehicle_visit'].map((v) => ({
  value: v,
  label: v || 'All entities',
}));

const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : 'None');

function ValueBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-card p-2 font-mono text-xs text-foreground">{pretty(value)}</pre>
    </div>
  );
}

export default function SuperAdminAuditPage() {
  const PAGE_SIZE = useListPageSize();
  const [tableName, setTableName] = useState('');
  const [actionSearch, setActionSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const action = useDebouncedValue(actionSearch.trim(), 300);

  const [page, setPage] = useState(1);
  // A new filter starts again at page 1.
  const filterKey = `${tableName}|${action}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const query = useQuery({
    queryKey: ['super-admin', 'audit', { tableName, action, page, PAGE_SIZE }],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (tableName) params.set('tableName', tableName);
      if (action) params.set('action', action);
      return fetchJson<AuditResponse>(`/api/super-admin/audit?${params}`, { signal });
    },
  });

  const logs = useMemo(() => query.data?.auditLogs ?? [], [query.data]);
  const total = query.data?.pagination?.totalRecords;
  const totalPages = query.data?.pagination?.totalPages ?? 1;

  const columns: DataColumn<AuditLogItem>[] = [
    {
      key: 'time',
      header: 'Time',
      label: 'Time',
      primary: true,
      cell: (l) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded === l.id ? 'rotate-180' : '-rotate-90'}`} aria-hidden="true" />
          {formatDateTime(l.createdAt)}
        </span>
      ),
    },
    { key: 'user', header: 'User', label: 'User', cell: (l) => l.user },
    { key: 'action', header: 'Action', label: 'Action', cardAlways: true, cell: (l) => <span className="font-mono text-xs">{l.action}</span> },
    { key: 'entity', header: 'Entity', label: 'Entity', cardAlways: true, cell: (l) => <span className="font-mono text-xs">{l.tableName}</span> },
  ];

  const active: ActiveFilter[] = [
    ...(tableName ? [{ key: 'entity', label: `Entity: ${tableName}`, onClear: () => setTableName('') }] : []),
    ...(actionSearch ? [{ key: 'action', label: `Action: ${actionSearch}`, onClear: () => setActionSearch('') }] : []),
  ];

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">Audit log</h1>
        <InfoTip text="Permanent record of data changes." />
        {typeof total === 'number' ? <span className="text-sm tabular-nums text-muted-foreground">{total.toLocaleString()} entries</span> : null}
      </div>

      <DataFilters search={actionSearch} onSearchChange={setActionSearch} searchPlaceholder="Search action" active={active}>
        <div className="min-w-[min(100%,14rem)] flex-1 sm:max-w-64">
          <Combobox options={ENTITY_OPTIONS} value={tableName} onValueChange={setTableName} searchPlaceholder="Filter entity" />
        </div>
      </DataFilters>

      <DataTable
        columns={columns}
        rows={logs}
        getRowId={(l) => l.id}
        loading={query.isPending}
        error={query.error ? getErrorMessage(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No audit records"
        emptyDescription={active.length ? 'Try removing a filter.' : undefined}
        onRowClick={(l) => setExpanded((cur) => (cur === l.id ? null : l.id))}
        renderExpanded={(l) =>
          expanded === l.id ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <ValueBlock title="Before" value={l.oldValues} />
              <ValueBlock title="After" value={l.newValues} />
            </div>
          ) : null
        }
        stale={query.isPlaceholderData}
        footer={
          logs.length ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalRecords={total ?? logs.length}
              pageSize={PAGE_SIZE}
              noun="entries"
              disabled={query.isFetching}
              onPageChange={(next) => {
                setPage(next);
                window.scrollTo({ top: 0 });
              }}
            />
          ) : null
        }
      />
    </div>
  );
}
