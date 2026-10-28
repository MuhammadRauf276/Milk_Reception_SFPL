'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Edit2, ShieldAlert, CheckCircle2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { useDebouncedValue } from '@/frontend/modules/super-admin/shared/useDebouncedValue';
import { PaginationBar } from '@/frontend/modules/super-admin/shared/PaginationBar';
import {
  SourceCreateDrawer,
  SourceEditDrawer,
  SourceStatusDrawer,
  type Source,
} from '@/frontend/modules/super-admin/sources/SourceDrawers';

const PAGE_SIZE = 25;
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

function Segmented({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-11 rounded-xl border px-3 text-xs font-semibold ${
            value === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border-strong bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('ZMCC');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const q = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ q, type, status, page }), [q, type, status, page]);

  const query = useQuery({
    queryKey: ['super-admin', 'procurement-sources', 'list', filters],
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

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden">
      {error && (
        <div className="flex items-center space-x-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-rose-800 animate-panel-in">
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
            className="flex items-center space-x-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-full overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold text-foreground">Procurement Sources</h2>
              <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-[11px] tabular-nums text-slate-600">
                {pagination?.totalRecords ?? sources.length}
              </span>
            </div>
            <Button className="h-11 px-4" aria-label="Add procurement source" onClick={() => setDialog({ kind: 'create' })}>
              <Plus />
              <span>Add source</span>
            </Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => withReset(() => setSearch(e.target.value))}
                placeholder="Search code or name"
                aria-label="Search procurement sources"
                className="h-11 w-full rounded-xl border border-border-strong bg-card pl-9 pr-3 text-sm focus:outline-hidden focus:border-primary"
              />
            </div>
            <Segmented label="Source type" options={TYPE_OPTIONS} value={type} onChange={(v) => withReset(() => setType(v))} />
            <Segmented label="Status" options={STATUS_OPTIONS} value={status} onChange={(v) => withReset(() => setStatus(v))} />
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead className="border-b border-border bg-subtle text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Code</th>
                <th className="p-3 font-semibold">Name</th>
                <th className="p-3 font-semibold">Source Type</th>
                {type !== 'ZMCC' && <th className="p-3 font-semibold">ERP Code</th>}
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {query.isPending ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center tabular-nums text-slate-400">
                    Loading procurement sources…
                  </td>
                </tr>
              ) : sources.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    No procurement sources configured.
                  </td>
                </tr>
              ) : (
                sources.map((s) => (
                  <tr key={s.id} className={`transition hover:bg-slate-50 ${query.isPlaceholderData ? 'opacity-60' : ''}`}>
                    <td className="p-3 font-semibold tabular-nums text-foreground">{s.code}</td>
                    <td className="p-3 font-semibold text-slate-800">{s.name}</td>
                    <td className="p-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                          s.sourceType === 'ZMCC' ? 'bg-blue-100 text-blue-900' : 'border border-slate-200 bg-slate-100 text-slate-800'
                        }`}
                      >
                        {s.sourceType}
                      </span>
                    </td>
                    {type !== 'ZMCC' && <td className="p-3 tabular-nums text-slate-700">{s.sourceType === 'CONTRACTOR' ? s.erpCode || '—' : ''}</td>}
                    <td className="p-3">
                      {s.isActive ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Active</span>
                      ) : (
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Inactive</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'edit', source: s })}
                          aria-label={`Edit ${s.name}`}
                          title={`Edit ${s.name}`}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'status', source: s, targetStatus: !s.isActive })}
                          aria-label={`${s.isActive ? 'Deactivate' : 'Activate'} ${s.name}`}
                          className={`flex min-h-[44px] items-center justify-center rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            s.isActive ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {s.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
