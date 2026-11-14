'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import React, { useMemo, useState } from 'react';
import { History, Plus, Truck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@core/types';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataFilters, type ActiveFilter } from '@/components/ui/data-filters';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { Pagination, usePagedRows } from '@/components/ui/pagination';
import { fetchJson } from '@/lib/query/fetchJson';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import { getErrorMessage } from '@/lib/errors';
import { MotSheet } from './MotSheet';
import { VehicleSheet } from './workspace/VehicleSheet';
import { TransferSheet } from './workspace/TransferSheet';
import { sendJson } from './workspace/mutationUtils';
import type { MotVehicleItem, ZmccSource } from './workspace/types';
import { formatDateTime } from '@/lib/format';

const FLEET_KEY = ['mot', 'fleet'] as const;

type FleetStatus = 'FREE' | 'COLLECTING' | 'RETURNING' | 'AT_ZMCC_WAITING_UNLOAD' | 'INACTIVE';

interface FleetRow {
  id: string;
  vehicle_number: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  is_active: boolean;
  status: FleetStatus;
  arrival_token: string | null;
  last_journey: {
    journey_number: string;
    status: string;
    operational_date: string;
    started_at: string;
    ended_at: string | null;
    route_name: string | null;
    mot_name: string | null;
  } | null;
  transfers: Array<{ at: string; from_zmcc: string | null; to_zmcc: string | null; by: string | null }>;
}

const STATUS_META: Record<FleetStatus, { label: string; tone: string }> = {
  FREE: { label: 'Free', tone: 'bg-emerald-100 text-emerald-800' },
  COLLECTING: { label: 'Collecting', tone: 'bg-amber-100 text-amber-800' },
  RETURNING: { label: 'Returning', tone: 'bg-blue-100 text-blue-800' },
  AT_ZMCC_WAITING_UNLOAD: { label: 'Waiting unload', tone: 'bg-amber-100 text-amber-800' },
  INACTIVE: { label: 'Inactive', tone: 'bg-muted text-secondary-foreground' },
};

const fmt = (iso: string | null) =>
  iso ? formatDateTime(iso) : '-';

/** Whole fleet for the Data Executive and Super Admin: register, edit, switch off and move vehicles. */
export function FleetWorkspace({ currentUser }: { currentUser: User | null }) {
  void currentUser;
  const queryClient = useQueryClient();
  const [zmccFilter, setZmccFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useAutoClearMessage(message, setMessage);
  const [vehicleSheet, setVehicleSheet] = useState<{ editing: MotVehicleItem | null } | null>(null);
  const [transferVehicle, setTransferVehicle] = useState<MotVehicleItem | null>(null);
  const [historyRow, setHistoryRow] = useState<FleetRow | null>(null);

  const sourcesQuery = useQuery({
    queryKey: stationQueryKeys.zmcc.sources(),
    queryFn: ({ signal }) => fetchJson<{ zmccs?: ZmccSource[] }>('/api/zmcc/sources', { signal }),
    staleTime: 10 * 60_000,
  });
  const sources = useMemo(() => (sourcesQuery.data?.zmccs || []).filter((s) => s.is_active), [sourcesQuery.data]);

  const fleetQuery = useQuery({
    queryKey: [...FLEET_KEY, zmccFilter],
    queryFn: ({ signal }) =>
      fetchJson<{ vehicles?: FleetRow[] }>(
        `/api/mot/fleet${zmccFilter ? `?zmcc_id=${encodeURIComponent(zmccFilter)}` : ''}`,
        { signal }
      ),
  });
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (fleetQuery.data?.vehicles ?? []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.vehicle_number.toLowerCase().includes(q) ||
        r.zmcc_name.toLowerCase().includes(q) ||
        r.zmcc_code.toLowerCase().includes(q) ||
        (r.arrival_token ?? '').toLowerCase().includes(q) ||
        (r.last_journey?.journey_number ?? '').toLowerCase().includes(q) ||
        (r.last_journey?.route_name ?? '').toLowerCase().includes(q) ||
        (r.last_journey?.mot_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [fleetQuery.data, statusFilter, search]);

  const paged = usePagedRows(rows, (r) => r.id);

  const activeFilters: ActiveFilter[] = [];
  if (search.trim()) activeFilters.push({ key: 'search', label: `Search: ${search.trim()}`, onClear: () => setSearch('') });
  if (zmccFilter) {
    const label = sources.find((s) => s.id === zmccFilter)?.name ?? zmccFilter;
    activeFilters.push({ key: 'zmcc', label: `ZMCC: ${label}`, onClear: () => setZmccFilter('') });
  }
  if (statusFilter) {
    const label = STATUS_META[statusFilter as FleetStatus]?.label ?? statusFilter;
    activeFilters.push({ key: 'status', label: `Status: ${label}`, onClear: () => setStatusFilter('') });
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: FLEET_KEY });

  const toItem = (r: FleetRow): MotVehicleItem => ({
    id: r.id,
    vehicle_number: r.vehicle_number,
    zmcc_id: r.zmcc_id,
    zmcc: { id: r.zmcc_id, code: r.zmcc_code, name: r.zmcc_name },
    is_active: r.is_active,
    has_active_journey: r.status === 'COLLECTING' || r.status === 'RETURNING',
    creator_name: '',
    updater_name: null,
    created_at: '',
  });

  const toggleMutation = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) =>
      sendJson(`/api/zmcc/mot/vehicles/${v.id}`, 'PATCH', { is_active: v.is_active }, 'Request failed'),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const done = (msg: string, close: () => void) => {
    setMessage(msg);
    close();
    refresh();
  };

  const columns: DataColumn<FleetRow>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      label: 'Vehicle',
      primary: true,
      cell: (r) => <span className="font-semibold tabular-nums text-primary">{r.vehicle_number}</span>,
    },
    {
      key: 'zmcc',
      header: 'ZMCC',
      label: 'ZMCC',
      cardAlways: true,
      cell: (r) => <span className="font-medium text-secondary-foreground">{r.zmcc_name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cardAlways: true,
      cell: (r) => {
        const st = STATUS_META[r.status];
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
            {r.arrival_token ? (
              <span className="text-xs tabular-nums text-muted-foreground">{r.arrival_token}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'last_journey',
      header: 'Last journey',
      label: 'Last journey',
      cell: (r) => (
        <span className="text-secondary-foreground">
          {r.last_journey ? (
            <>
              <span className="font-semibold tabular-nums" title={r.last_journey.route_name ?? undefined}>
                #{r.last_journey.journey_number}
              </span>
              <span className="block text-xs text-muted-foreground">{fmt(r.last_journey.started_at)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No journey yet</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (r) => {
        const busy = r.status === 'COLLECTING' || r.status === 'RETURNING' || r.status === 'AT_ZMCC_WAITING_UNLOAD';
        const isToggling = toggleMutation.isPending && toggleMutation.variables?.id === r.id;
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setTransferVehicle(toItem(r))} disabled={busy} title={busy ? 'The vehicle must be free to move it' : 'Move vehicle to another ZMCC'}>
              Transfer
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setVehicleSheet({ editing: toItem(r) })}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setHistoryRow(r)}>
              <History aria-hidden />
              History{r.transfers.length > 0 ? ` (${r.transfers.length})` : ''}
            </Button>
            <Button
              variant={r.is_active ? 'destructive' : 'secondary'}
              size="sm"
              loading={isToggling}
              loadingText={r.is_active ? 'Deactivating…' : 'Activating…'}
              disabled={r.is_active && (r.status === 'COLLECTING' || r.status === 'RETURNING')}
              onClick={() => toggleMutation.mutate({ id: r.id, is_active: !r.is_active })}
            >
              {r.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        );
      },
    },
  ];
  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {error ? (
        <div className="bg-card border-border rounded-2xl border p-3 text-xs font-semibold text-rose-800">{error}</div>
      ) : null}
      {message ? (
        <div className="bg-card border-border rounded-2xl border p-3 text-xs font-semibold text-emerald-800">
          {message}
        </div>
      ) : null}
      {fleetQuery.error ? (
        <div className="bg-card border-border rounded-2xl border p-3 text-xs font-semibold text-rose-800">
          {getErrorMessage(fleetQuery.error)}
        </div>
      ) : null}

      <div className="w-full min-w-0 max-w-full rounded-2xl border border-border/80 bg-card shadow-2xs">
        <div className="space-y-3 border-b border-border p-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="rounded-lg bg-primary p-2 text-white shrink-0">
                <Truck className="h-4 w-4" aria-hidden />
              </div>
              <h1 className="text-base font-semibold text-foreground sm:text-lg">Fleet</h1>
              <span className="rounded-md border border-border bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                {rows.length}
              </span>
            </div>
            <Button onClick={() => setVehicleSheet({ editing: null })}>
              <Plus aria-hidden />
              Add Vehicle
            </Button>
          </div>

          <DataFilters
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search vehicle, ZMCC, or journey"
            active={activeFilters}
          >
            <div className="min-w-[min(100%,14rem)] flex-1 sm:max-w-60">
              <Combobox
                className="min-h-[44px]"
                value={zmccFilter}
                onValueChange={setZmccFilter}
                placeholder="All ZMCCs"
                searchPlaceholder="Search ZMCC"
                options={[
                  { value: '', label: 'All ZMCCs' },
                  ...sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}`, keywords: `${s.code} ${s.name}` })),
                ]}
              />
            </div>
            <div className="min-w-[min(100%,12rem)] flex-1 sm:max-w-52">
              <Combobox
                className="min-h-[44px]"
                value={statusFilter}
                onValueChange={setStatusFilter}
                placeholder="Any status"
                searchPlaceholder="Search status"
                options={[
                  { value: '', label: 'Any status' },
                  ...(Object.keys(STATUS_META) as FleetStatus[]).map((k) => ({ value: k, label: STATUS_META[k].label })),
                ]}
              />
            </div>
          </DataFilters>
        </div>

        <div className="p-3 sm:p-4">
          <DataTable
            paginate={false}
            columns={columns}
            rows={paged.pageRows}
            getRowId={(r) => r.id}
            loading={fleetQuery.isLoading}
            stale={fleetQuery.isFetching && !fleetQuery.isLoading}
            emptyTitle="No vehicles found."
            tableFrom="lg"
          />
        </div>

        <Pagination
          page={paged.page}
          totalPages={paged.totalPages}
          totalRecords={paged.totalRecords}
          pageSize={paged.pageSize}
          noun="vehicles"
          disabled={fleetQuery.isFetching}
          onPageChange={paged.setPage}
          className="border-t border-border bg-card"
        />
      </div>

      {vehicleSheet && (
        <VehicleSheet
          editing={vehicleSheet.editing}
          defaultZmccId={zmccFilter || null}
          isCentralRole
          sources={sources}
          onClose={() => setVehicleSheet(null)}
          onDone={(m) => done(m, () => setVehicleSheet(null))}
        />
      )}

      {transferVehicle && (
        <TransferSheet
          vehicle={transferVehicle}
          sources={sources}
          onClose={() => setTransferVehicle(null)}
          onDone={(m) => done(m, () => setTransferVehicle(null))}
        />
      )}

      {historyRow && (
        <MotSheet
          title={`Vehicle ${historyRow.vehicle_number}`}
          subtitle="Where this vehicle has been moved"
          onClose={() => setHistoryRow(null)}
        >
          {historyRow.transfers.length === 0 ? (
            <p className="text-xs font-semibold text-muted-foreground">
              This vehicle has never been moved. ZMCC: {historyRow.zmcc_name}.
            </p>
          ) : (
            <ul className="space-y-2">
              {historyRow.transfers.map((t, i) => (
                <li key={`${t.at}-${i}`} className="bg-card border-border rounded-lg border p-3 text-xs">
                  <p className="font-semibold text-foreground">
                    {t.from_zmcc ?? 'Unknown'} to {t.to_zmcc ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmt(t.at)}
                    {t.by ? ` · by ${t.by}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </MotSheet>
      )}
    </div>
  );
}
