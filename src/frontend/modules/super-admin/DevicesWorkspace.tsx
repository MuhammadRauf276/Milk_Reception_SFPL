'use client';

import React, { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, Clock, KeyRound, Plus, ScrollText, Search, Smartphone, Undo2, UserPlus, Users } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { useDebouncedValue } from './shared/useDebouncedValue';
import { PaginationBar } from './shared/PaginationBar';
import { DeviceDrawer, formatTime, type DeviceDialog, type DeviceItem, type DeviceStatus } from './devices/DeviceDrawer';

const STATUS_VIEW: Record<DeviceStatus, { word: string; icon: React.ReactNode; cls: string }> = {
  ACTIVE: { word: 'Working', icon: <CheckCircle2 className="size-4" aria-hidden />, cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  PENDING: { word: 'Waiting', icon: <Clock className="size-4" aria-hidden />, cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  BLOCKED: { word: 'Blocked', icon: <Ban className="size-4" aria-hidden />, cls: 'bg-rose-100 text-rose-900 border-rose-300' },
  RELEASED: { word: 'Back in office', icon: <Undo2 className="size-4" aria-hidden />, cls: 'bg-slate-100 text-slate-800 border-slate-300' },
};

const STATUS_FILTERS: Array<{ value: '' | DeviceStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Working' },
  { value: 'PENDING', label: 'Waiting' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'RELEASED', label: 'Back in office' },
];

const BTN = 'min-h-11 px-4';
const PAGE_SIZE = 12;

function StatusPill({ status }: { status: DeviceStatus }) {
  const v = STATUS_VIEW[status] ?? STATUS_VIEW.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${v.cls}`}>
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

  const q = useDebouncedValue(search.trim(), 300);
  const filters = useMemo(() => ({ q, status, page }), [q, status, page]);

  const query = useQuery({
    queryKey: ['super-admin', 'devices', 'list', filters],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), options: '0' });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      return fetchJson<DevicesResponse>(`/api/devices?${params}`, { signal });
    },
    placeholderData: keepPreviousData,
  });

  const devices = query.data?.devices ?? [];
  const pagination = query.data?.pagination;
  const error = query.error ? getErrorMessage(query.error) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="inline-flex items-center">Phones<InfoTip text="Register field phones, give them to users, and see what each phone did." /></span>}
        actions={
          <Button className={BTN} onClick={() => setDialog({ kind: 'register' })}>
            <Plus aria-hidden /> Register phone
          </Button>
        }
      />

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search phones…"
            aria-label="Search phones"
            className="h-11 w-full rounded-xl border border-border-strong bg-card pl-9 pr-3 text-sm focus:outline-hidden focus:border-primary"
          />
        </div>
        <div role="group" aria-label="Status filter" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => {
                setStatus(f.value);
                setPage(1);
              }}
              className={`h-11 rounded-xl border px-4 text-xs font-semibold ${
                status === f.value ? 'border-primary bg-primary/10 text-primary' : 'border-border-strong bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-border bg-card p-3 text-sm text-rose-900">
          <AlertTriangle className="size-4" aria-hidden /> {error}
        </div>
      ) : null}

      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading phones…</p>
      ) : devices.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {q || status ? 'No phones match.' : 'No phones yet.'}
        </p>
      ) : (
        <ul className={`grid gap-4 lg:grid-cols-2 ${query.isPlaceholderData ? 'opacity-60' : ''}`}>
          {devices.map((d) => (
            <li key={d.id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <Smartphone className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{d.label || d.deviceUid}</span>
                  </div>
                  <div className="break-all text-xs text-muted-foreground">{d.deviceUid}</div>
                </div>
                <StatusPill status={d.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">User</dt>
                <dd>{d.assignedUserName ?? (d.isSharedStation ? 'Shared station' : 'Nobody')}</dd>
                <dt className="text-muted-foreground">ZMCC</dt>
                <dd>{d.procurementSourceName ?? '-'}</dd>
                <dt className="text-muted-foreground">Last seen</dt>
                <dd>{formatTime(d.lastSeenAt)}</dd>
                <dt className="text-muted-foreground">App version</dt>
                <dd>{d.lastAppVersion ?? '-'}</dd>
                <dt className="text-muted-foreground">Not sent yet</dt>
                <dd>{d.lastUnsentCount}</dd>
              </dl>
              {d.status === 'BLOCKED' && d.blockReason ? <p className="text-sm text-rose-900">Reason: {d.blockReason}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className={BTN} disabled={d.status === 'BLOCKED'} onClick={() => setDialog({ kind: 'assign', device: d })}>
                  <UserPlus aria-hidden /> Assign user
                </Button>
                <Button variant="outline" className={BTN} onClick={() => setDialog({ kind: 'release', device: d })}>
                  <Undo2 aria-hidden /> Release phone
                </Button>
                <Button variant="outline" className={BTN} disabled={d.status === 'BLOCKED'} onClick={() => setDialog({ kind: 'key', device: d })}>
                  <KeyRound aria-hidden /> Show key
                </Button>
                {d.isSharedStation ? (
                  <Button variant="outline" className={BTN} disabled={d.status !== 'ACTIVE'} onClick={() => setDialog({ kind: 'station', device: d })}>
                    <Users aria-hidden /> Station users
                  </Button>
                ) : null}
                <Button variant="outline" className={BTN} onClick={() => setDialog({ kind: 'diary', device: d })}>
                  <ScrollText aria-hidden /> Diary
                </Button>
                <Button variant="destructive" className={BTN} disabled={d.status === 'BLOCKED'} onClick={() => setDialog({ kind: 'block', device: d })}>
                  <Ban aria-hidden /> Block
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <PaginationBar
          page={pagination?.page ?? page}
          totalPages={pagination?.totalPages ?? 1}
          totalRecords={pagination?.totalRecords ?? devices.length}
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
