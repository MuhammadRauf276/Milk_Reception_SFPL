'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTip } from '@/components/ui/info-tip';
import { ErrorPopup } from '@/components/ui/error-popup';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { datetimeLocalToIso, formatOperationalDatetime, toDatetimeLocalInput } from '@/lib/datetime-utils';
import { serverNow } from '@/lib/serverClock';
import { FormDrawer, DrawerActions, fieldInputClass, fieldLabelClass } from '@/frontend/modules/super-admin/shared/FormDrawer';
import type { ZmccSource } from '@/frontend/modules/zmcc/master/masterTypes';

interface OutageWindowRow {
  id: string;
  starts_at: string;
  ends_at: string;
  catch_up_until: string;
  closed_at: string | null;
  status: 'OPEN' | 'CLOSED' | 'ENDED';
  reason: string;
  all_stations: boolean;
  stations: string[];
  opened_by: string | null;
  closed_by: string | null;
  late_entries: number;
}

interface LateEntryRow {
  id: string;
  step: string;
  station: string;
  record_table: string;
  record_id: string | null;
  happened_at: string | null;
  entered_at: string;
  entered_by: string | null;
}

const PLANT_STATIONS = [
  { key: 'GATE', label: 'Plant gate' },
  { key: 'WEIGHBRIDGE', label: 'Weighbridge' },
  { key: 'QA', label: 'Plant QA' },
  { key: 'PRODUCTION', label: 'Production' },
] as const;

const CATCH_UP_CHOICES = [
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '48 hours' },
  { hours: 72, label: '3 days' },
  { hours: 120, label: '5 days' },
  { hours: 168, label: '7 days' },
];

const QUERY_KEY = ['super-admin', 'outage-windows'];

function statusBadge(status: OutageWindowRow['status']) {
  if (status === 'OPEN') return <Badge variant="warning">Catch-up open</Badge>;
  if (status === 'CLOSED') return <Badge variant="secondary">Closed</Badge>;
  return <Badge variant="outline">Ended</Badge>;
}

export function OutageWindowsPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = useState(false);
  const [inspect, setInspect] = useState<OutageWindowRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => fetchJson<{ windows: OutageWindowRow[] }>('/api/super-admin/outage-windows', { signal }),
  });

  const close = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/super-admin/outage-windows/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err) => setError(getErrorMessage(err) || 'Could not close the window.'),
  });

  const onClose = async (row: OutageWindowRow) => {
    const ok = await confirmAction({
      title: 'Close catch-up now?',
      description: 'Times older than 3 days are refused again for these stations. Entries already made stay listed.',
      confirmLabel: 'Close catch-up',
      destructive: true,
    });
    if (ok) close.mutate(row.id);
  };

  const columns: DataColumn<OutageWindowRow>[] = [
    {
      key: 'outage',
      header: 'Outage',
      primary: true,
      cell: (r) => (
        <span className="tabular-nums">
          {formatOperationalDatetime(r.starts_at)} – {formatOperationalDatetime(r.ends_at)}
        </span>
      ),
    },
    { key: 'stations', header: 'Stations', cell: (r) => <span className="break-words">{r.stations.join(', ')}</span> },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="break-words">{r.reason}</span> },
    {
      key: 'until',
      header: 'Catch-up until',
      cell: (r) => <span className="tabular-nums">{formatOperationalDatetime(r.closed_at ?? r.catch_up_until)}</span>,
    },
    { key: 'status', header: 'Status', cell: (r) => statusBadge(r.status) },
    { key: 'late', header: 'Late entries', align: 'right', cell: (r) => (
        <span className="tabular-nums">
          {r.late_entries}
          <span className="md:hidden"> late</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="min-h-11 text-xs" onClick={() => setInspect(r)}>
            Inspect
          </Button>
          {canEdit && r.status === 'OPEN' ? (
            <Button variant="ghost" size="sm" className="min-h-11 text-xs" disabled={close.isPending} onClick={() => void onClose(r)}>
              Close
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold text-foreground">Outage windows</h1>
          <InfoTip
            label="About outage windows"
            text="Anyone can enter a time up to 3 days earlier than now. After the site was down longer, open a window: for its stations and hours, older times are allowed until the catch-up deadline. Each such entry is listed as entered late."
          />
        </div>
        {canEdit ? (
          <Button className="min-h-11 gap-1.5 text-xs" onClick={() => setOpenForm(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Open window
          </Button>
        ) : null}
      </div>

      <ErrorPopup message={error} onClear={() => setError(null)} />

      <DataTable
        columns={columns}
        rows={list.data?.windows ?? []}
        getRowId={(r) => r.id}
        loading={list.isLoading}
        error={list.error ? getErrorMessage(list.error) || 'Could not load outage windows.' : null}
        onRetry={() => void list.refetch()}
        emptyTitle="No outage windows"
        noun="window"
        paginate
      />

      {canEdit ? (
        <OpenWindowDrawer
          open={openForm}
          onClose={() => setOpenForm(false)}
          onSaved={() => {
            setOpenForm(false);
            void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          }}
        />
      ) : null}

      <LateEntriesDrawer window={inspect} onClose={() => setInspect(null)} />
    </div>
  );
}

function OpenWindowDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [allStations, setAllStations] = useState(false);
  const [plant, setPlant] = useState<string[]>([]);
  const [zmccs, setZmccs] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [catchUp, setCatchUp] = useState(48);
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['zmcc', 'sources'],
    queryFn: ({ signal }) => fetchJson<{ zmccs?: ZmccSource[] }>('/api/zmcc/sources', { signal }),
    enabled: open,
  });
  const zmccList = useMemo(() => (sources.data?.zmccs ?? []).filter((z) => z.is_active), [sources.data]);

  const reset = () => {
    setFrom('');
    setTo('');
    setAllStations(false);
    setPlant([]);
    setZmccs([]);
    setReason('');
    setCatchUp(48);
    setError(null);
  };

  const save = useMutation({
    mutationFn: () =>
      fetchJson('/api/super-admin/outage-windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          starts_at: datetimeLocalToIso(from),
          ends_at: datetimeLocalToIso(to),
          all_stations: allStations,
          plant_stations: allStations ? [] : plant,
          zmcc_ids: allStations ? [] : zmccs,
          reason,
          catch_up_hours: catchUp,
        }),
      }),
    onSuccess: () => {
      reset();
      onSaved();
    },
    onError: (err) => setError(getErrorMessage(err) || 'Could not open the window.'),
  });

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const nowInput = toDatetimeLocalInput(serverNow());

  return (
    <FormDrawer
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Open outage window"
      busy={save.isPending}
      error={error}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={fieldLabelClass}>Down from *</label>
            <input type="datetime-local" required value={from} max={nowInput} onChange={(e) => setFrom(e.target.value)} className={fieldInputClass} />
          </div>
          <div>
            <label className={fieldLabelClass}>Down until *</label>
            <input type="datetime-local" required value={to} min={from || undefined} max={nowInput} onChange={(e) => setTo(e.target.value)} className={fieldInputClass} />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className={fieldLabelClass}>Stations *</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={allStations} onChange={(e) => setAllStations(e.target.checked)} />
            <span className="font-semibold">All stations</span>
          </label>
          {!allStations ? (
            <>
              <div className="grid grid-cols-2 gap-x-3">
                {PLANT_STATIONS.map((s) => (
                  <label key={s.key} className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" className="h-4 w-4" checked={plant.includes(s.key)} onChange={() => toggle(plant, setPlant, s.key)} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border px-3 py-1 scrollbar-thin">
                {sources.isLoading ? <p className="py-2 text-muted-foreground">Loading ZMCCs…</p> : null}
                {zmccList.map((z) => (
                  <label key={z.id} className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" className="h-4 w-4" checked={zmccs.includes(z.id)} onChange={() => toggle(zmccs, setZmccs, z.id)} />
                    <span className="min-w-0 break-words">{z.name}</span>
                    <span className="text-muted-foreground">{z.code}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </fieldset>

        <div>
          <label className={fieldLabelClass}>Reason *</label>
          <textarea
            required
            minLength={5}
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Internet down at Hasilpur"
            className={fieldInputClass}
          />
        </div>

        <div>
          <label className={`${fieldLabelClass} flex items-center gap-1`}>
            Catch-up time
            <InfoTip label="About catch-up time" text="How long after the outage ended users may still enter its times. Default 48 hours, up to 7 days. You can close it early." />
          </label>
          <select value={catchUp} onChange={(e) => setCatchUp(Number(e.target.value))} className={fieldInputClass}>
            {CATCH_UP_CHOICES.map((c) => (
              <option key={c.hours} value={c.hours}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <DrawerActions busy={save.isPending} onCancel={() => { reset(); onClose(); }} submitLabel="Open window" busyLabel="Opening…" />
      </form>
    </FormDrawer>
  );
}

function LateEntriesDrawer({ window: w, onClose }: { window: OutageWindowRow | null; onClose: () => void }) {
  const entries = useQuery({
    queryKey: [...QUERY_KEY, w?.id, 'late'],
    queryFn: ({ signal }) => fetchJson<{ entries: LateEntryRow[] }>(`/api/super-admin/outage-windows/${w!.id}/late-entries`, { signal }),
    enabled: !!w,
  });

  const columns: DataColumn<LateEntryRow>[] = [
    { key: 'step', header: 'Entry', primary: true, cell: (r) => r.step },
    { key: 'station', header: 'Station', cell: (r) => r.station },
    { key: 'happened', header: 'Happened', cell: (r) => <span className="tabular-nums">{r.happened_at ? formatOperationalDatetime(r.happened_at) : '—'}</span> },
    { key: 'entered', header: 'Entered', cell: (r) => <span className="tabular-nums">{formatOperationalDatetime(r.entered_at)}</span> },
    { key: 'by', header: 'By', cell: (r) => r.entered_by ?? '—' },
  ];

  return (
    <Drawer open={!!w} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="max-h-[90dvh]">
        <div className="border-b border-border pl-5 pr-14 py-3">
          <DrawerTitle className="text-base">Entered late (outage)</DrawerTitle>
          {w ? (
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {formatOperationalDatetime(w.starts_at)} – {formatOperationalDatetime(w.ends_at)} · {w.stations.join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 text-xs sm:px-5">
          {w ? (
            <div className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
              <p><span className="text-muted-foreground">Reason: </span>{w.reason}</p>
              <p><span className="text-muted-foreground">Opened by: </span>{w.opened_by ?? '—'}</p>
              <p><span className="text-muted-foreground">Catch-up until: </span><span className="tabular-nums">{formatOperationalDatetime(w.catch_up_until)}</span></p>
              {w.closed_at ? (
                <p><span className="text-muted-foreground">Closed early: </span><span className="tabular-nums">{formatOperationalDatetime(w.closed_at)}</span>{w.closed_by ? ` by ${w.closed_by}` : ''}</p>
              ) : null}
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={entries.data?.entries ?? []}
            getRowId={(r) => r.id}
            loading={entries.isLoading}
            error={entries.error ? getErrorMessage(entries.error) || 'Could not load late entries.' : null}
            onRetry={() => void entries.refetch()}
            emptyTitle="No late entries yet"
            noun="entry"
            paginate
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
