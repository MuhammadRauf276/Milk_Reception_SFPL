'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Edit2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { DataFilters, FilterToggle } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { PaginationBar } from '@/frontend/modules/super-admin/shared/PaginationBar';
import { useListPageSize } from '@/components/ui/pagination';
import {
  SourceCreateDrawer,
  SourceEditDrawer,
  SourceStatusDrawer,
  type Source,
} from '@/frontend/modules/super-admin/sources/SourceDrawers';

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'ZMCC', label: 'ZMCC' },
  { value: 'CONTRACTOR', label: 'Contractor' },
];
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; source: Source }
  | { kind: 'status'; source: Source; targetStatus: boolean }
  | null;

export default function SuperAdminProcurementSourcesPage() {
  const router = useRouter();
  const { currentUser, loadingUser } = useCurrentUser();
  const notAllowed = !loadingUser && !!currentUser && currentUser.role !== 'SUPER_ADMIN' && currentUser.role !== 'DATA_EXECUTIVE';
  React.useEffect(() => {
    if (notAllowed) router.replace('/super-admin/corrections');
  }, [notAllowed, router]);
  if (loadingUser || notAllowed) return null;
  return <ProcurementSourcesContent />;
}

function ProcurementSourcesContent() {
  const PAGE_SIZE = useListPageSize();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('ZMCC');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  useAutoClearMessage(successMsg, setSuccessMsg);

  const q = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ q, type, status, page }), [q, type, status, page]);

  const query = useQuery({
    queryKey: ['super-admin', 'procurement-sources', 'list', filters, PAGE_SIZE],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      if (type) params.set('type', type);
      if (status) params.set('status', status);
      return fetchJson<{ sources?: Source[]; pagination?: { page: number; totalPages: number; totalRecords: number } }>(
        `/api/super-admin/procurement-sources?${params}`,
        { signal, cache: 'no-store' }
      );
    },
    placeholderData: keepPreviousData,
  });

  const sources = query.data?.sources ?? [];
  const pagination = query.data?.pagination;
  const error = query.error ? getErrorMessage(query.error) || 'Network error loading procurement sources' : null;

  const handleSaved = (message: string) => {
    setSuccessMsg(message);
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['super-admin', 'procurement-sources'] });
  };
  const withReset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const columns: DataColumn<Source>[] = [
    { key: 'code', header: 'Code', label: 'Code', cell: (s) => <span className="whitespace-nowrap font-mono font-semibold tabular-nums text-foreground">{s.code}</span> },
    { key: 'name', header: 'Name', label: 'Name', primary: true, cell: (s) => <span className="font-semibold text-foreground">{s.name}</span> },
    {
      key: 'type',
      header: 'Source type',
      label: 'Source type',
      cell: (s) => <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{s.sourceType}</span>,
    },
    ...(type !== 'ZMCC'
      ? [
          {
            key: 'erp',
            header: 'ERP code',
            label: 'ERP code',
            cell: (s: Source) => <span className="whitespace-nowrap font-mono tabular-nums text-secondary-foreground">{s.sourceType === 'CONTRACTOR' ? s.erpCode || '—' : ''}</span>,
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (s) =>
        s.isActive ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Active</span>
        ) : (
          <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">Inactive</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => setDialog({ kind: 'edit', source: s })} aria-label={`Edit ${s.name}`} title={`Edit ${s.name}`}>
            <Edit2 />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'status', source: s, targetStatus: !s.isActive })} aria-label={`${s.isActive ? 'Deactivate' : 'Activate'} ${s.name}`}>
            {s.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {error && (
        <div className="flex items-center space-x-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-rose-800 animate-panel-in">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {successMsg && (
          <motion.div
            key="ok"
            variants={fadeSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            role="status"
            className="flex items-center space-x-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold text-foreground">Procurement sources</h2>
              <span className="rounded-md border border-border bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                {pagination?.totalRecords ?? sources.length}
              </span>
            </div>
            <Button aria-label="Add procurement source" onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              <span>Add source</span>
            </Button>
          </div>
          <DataFilters
            search={search}
            onSearchChange={(v) => withReset(() => setSearch(v))}
            searchPlaceholder="Search code or name"
          >
            <FilterToggle label="Source type" options={TYPE_OPTIONS} value={type} onChange={(v) => withReset(() => setType(v))} />
            <FilterToggle label="Status" options={STATUS_OPTIONS} value={status} onChange={(v) => withReset(() => setStatus(v))} />
          </DataFilters>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable paginate={false}
            columns={columns}
            rows={sources}
            getRowId={(s) => s.id}
            loading={query.isPending}
            stale={query.isPlaceholderData}
            emptyTitle="No procurement sources"
            tableFrom="md"
          />
        </div>
        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          totalRecords={pagination?.totalRecords ?? sources.length}
          noun="sources"
          disabled={query.isFetching}
          onPageChange={setPage}
        />
      </div>

      {dialog?.kind === 'create' && <SourceCreateDrawer onClose={() => setDialog(null)} onSaved={handleSaved} />}
      {dialog?.kind === 'edit' && <SourceEditDrawer key={dialog.source.id} source={dialog.source} onClose={() => setDialog(null)} onSaved={handleSaved} />}
      {dialog?.kind === 'status' && (
        <SourceStatusDrawer key={dialog.source.id} source={dialog.source} targetStatus={dialog.targetStatus} onClose={() => setDialog(null)} onSaved={handleSaved} />
      )}
    </div>
  );
}
