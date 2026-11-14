'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, Clock, KeyRound, Plus, ScrollText, Smartphone, Undo2, UserPlus, Users } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { Button } from '@/components/ui/button';
import { DataFilters, FilterToggle, type ActiveFilter } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { useDebouncedValue } from './shared/useDebouncedValue';
import { PaginationBar } from './shared/PaginationBar';
import { useListPageSize } from '@/components/ui/pagination';
import { DeviceDrawer, formatTime, type DeviceDialog, type DeviceItem, type DeviceStatus } from './devices/DeviceDrawer';

const STATUS_VIEW: Record<DeviceStatus, { word: string; icon: React.ReactNode; cls: string }> = {
  ACTIVE: { word: 'Working', icon: <CheckCircle2 className="size-4" aria-hidden />, cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  PENDING: { word: 'Waiting', icon: <Clock className="size-4" aria-hidden />, cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  BLOCKED: { word: 'Blocked', icon: <Ban className="size-4" aria-hidden />, cls: 'bg-rose-100 text-rose-900 border-rose-300' },
  RELEASED: { word: 'Back in office', icon: <Undo2 className="size-4" aria-hidden />, cls: 'bg-muted text-foreground border-border-strong' },
};

const STATUS_FILTERS: Array<{ value: '' | DeviceStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Working' },
  { value: 'PENDING', label: 'Waiting' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'RELEASED', label: 'Back in office' },
];

function StatusPill({ status }: { status: DeviceStatus }) {
  const v = STATUS_VIEW[status] ?? STATUS_VIEW.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium ${v.cls}`}>
      {v.icon}
      {v.word}
    </span>
  );
}

interface DevicesResponse {
  devices: DeviceItem[];
  pagination?: { page: number; totalPages: number; totalRecords: number };
}

export function DevicesWorkspace() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | DeviceStatus>('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DeviceDialog | null>(null);
  const pageSize = useListPageSize(25);

  const q = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ q, status, page, pageSize }), [q, status, page, pageSize]);

  const query = useQuery({
    queryKey: ['super-admin', 'devices', 'list', filters],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), options: '0' });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      return fetchJson<DevicesResponse>(`/api/devices?${params}`, { signal });
    },
    placeholderData: keepPreviousData,
  });

  const devices = query.data?.devices ?? [];
  const pagination = query.data?.pagination;
  const error = query.error ? getErrorMessage(query.error) : null;

  const activeFilters: ActiveFilter[] = [];
  if (search) activeFilters.push({ key: 'q', label: `Search: ${search}`, onClear: () => { setSearch(''); setPage(1); } });
  if (status) {
    const label = STATUS_FILTERS.find((f) => f.value === status)?.label ?? status;
    activeFilters.push({ key: 'status', label: `Status: ${label}`, onClear: () => { setStatus(''); setPage(1); } });
  }

  const columns: DataColumn<DeviceItem>[] = [
    {
      key: 'phone',
      header: 'Phone',
      label: 'Phone',
      primary: true,
      cell: (d) => (
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words">{d.label || d.deviceUid}</span>
          </div>
          <div className="break-all font-mono text-xs text-muted-foreground">{d.deviceUid}</div>
          {d.status === 'BLOCKED' && d.blockReason ? (
            <p className="text-xs font-medium text-rose-800">Reason: {d.blockReason}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cardAlways: true,
      cell: (d) => <StatusPill status={d.status} />,
    },
    {
      key: 'user',
      header: 'Assigned user',
      label: 'Assigned user',
      cardAlways: true,
      cell: (d) => (
        <span className="text-foreground">
          {d.assignedUserName ?? (d.isSharedStation ? 'Shared station' : 'Nobody')}
        </span>
      ),
    },
    {
      key: 'zmcc',
      header: 'ZMCC',
      label: 'ZMCC',
      cell: (d) => <span className="text-secondary-foreground">{d.procurementSourceName ?? '—'}</span>,
    },
    {
      key: 'activity',
      header: 'Last seen',
      label: 'Last seen',
      cell: (d) => (
        <div className="space-y-0.5 text-xs text-secondary-foreground">
          <div>{formatTime(d.lastSeenAt)}</div>
          <div className="tabular-nums text-muted-foreground">
            {d.lastAppVersion ? `v${d.lastAppVersion}` : '—'} · {d.lastUnsentCount} unsent
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (d) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="outline" size="sm" disabled={d.status === 'BLOCKED'} onClick={() => setDialog({ kind: 'assign', device: d })}>
            <UserPlus aria-hidden /> Assign user
          </Button>
          <Button variant="secondary" size="sm" disabled={d.status === 'BLOCKED'} onClick={() => setDialog({ kind: 'key', device: d })}>
            <KeyRound aria-hidden /> Show key
          </Button>
          {d.isSharedStation ? (
            <Button variant="secondary" size="sm" disabled={d.status !== 'ACTIVE'} onClick={() => setDialog({ kind: 'station', device: d })}>
              <Users aria-hidden /> Station users
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'diary', device: d })}>
            <ScrollText aria-hidden /> Diary
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'release', device: d })}>
            <Undo2 aria-hidden /> Release
          </Button>
          <Button variant="destructive" size="sm" disabled={d.status === 'BLOCKED'} onClick={() => setDialog({ kind: 'block', device: d })}>
            <Ban aria-hidden /> Block
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-sm text-rose-900">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {error}
        </div>
      ) : null}

      <div className="w-full min-w-0 max-w-full rounded-2xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Phones</h2>
                <InfoTip text="Register field phones, give them to users, and see what each phone did." />
              </div>
              <span className="rounded-md border border-border bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                {pagination?.totalRecords ?? devices.length}
              </span>
            </div>
            <Button onClick={() => setDialog({ kind: 'register' })}>
              <Plus aria-hidden /> Register phone
            </Button>
          </div>
          <DataFilters
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            searchPlaceholder="Search phones…"
            active={activeFilters}
          >
            <FilterToggle
              label="Status filter"
              options={STATUS_FILTERS}
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            />
          </DataFilters>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            paginate={false}
            columns={columns}
            rows={devices}
            getRowId={(d) => d.id}
            loading={query.isPending}
            stale={query.isPlaceholderData}
            emptyTitle={q || status ? 'No phones match.' : 'No phones yet.'}
            tableFrom="lg"
          />
        </div>

        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          totalRecords={pagination?.totalRecords ?? devices.length}
          pageSize={pageSize}
          noun="phones"
          disabled={query.isFetching}
          onPageChange={setPage}
        />
      </div>

      {dialog ? (
        <DeviceDrawer
          key={'device' in dialog ? `${dialog.kind}-${dialog.device.id}` : dialog.kind === 'shown-key' ? `key-${dialog.deviceUid}` : dialog.kind}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onShowKey={(deviceUid, syncKey) => setDialog({ kind: 'shown-key', deviceUid, syncKey })}
        />
      ) : null}
    </div>
  );
}
