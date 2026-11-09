'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import React, { useMemo, useState } from 'react';
import { History, Plus, Truck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@core/types';
import { Combobox } from '@/components/ui/combobox';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { fetchJson } from '@/lib/query/fetchJson';
import { stationQueryKeys } from '@/lib/query/stationQueryKeys';
import { getErrorMessage } from '@/lib/errors';
import { Pager, paginate, pageCount } from '@/frontend/modules/dashboard/components/Pager';
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
  const [page, setPage] = useState(1);
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
  const rows = useMemo(
    () => (fleetQuery.data?.vehicles ?? []).filter((r) => !statusFilter || r.status === statusFilter),
    [fleetQuery.data, statusFilter]
  );
  const totalPages = pageCount(rows.length);
  const currentPage = Math.min(page, totalPages);
  const pageRows = paginate(rows, currentPage);

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
      cell: (r) => <span className="font-medium text-secondary-foreground">{r.zmcc_name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (r) => {
        const st = STATUS_META[r.status];
        return (
          <>
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
            {r.arrival_token ? (
              <span className="ml-2 text-xs tabular-nums text-muted-foreground">{r.arrival_token}</span>
            ) : null}
          </>
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
        return (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setHistoryRow(r)}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-muted px-3 font-semibold text-foreground hover:bg-border"
            >
              <History className="h-3.5 w-3.5" />
              History{r.transfers.length > 0 ? ` (${r.transfers.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setTransferVehicle(toItem(r))}
              disabled={busy}
              title={busy ? 'The vehicle must be free to move it' : 'Move vehicle to another ZMCC'}
              className="min-h-[44px] rounded-lg bg-blue-50 px-3 font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              Transfer
            </button>
            <button
              type="button"
              onClick={() => setVehicleSheet({ editing: toItem(r) })}
              className="min-h-[44px] rounded-lg bg-muted px-3 font-semibold text-foreground hover:bg-border"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => toggleMutation.mutate({ id: r.id, is_active: !r.is_active })}
              disabled={r.is_active && (r.status === 'COLLECTING' || r.status === 'RETURNING')}
              className={`min-h-[44px] rounded-lg px-3 font-semibold ${
                r.is_active
                  ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {r.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        );
      },
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary p-3 text-white">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground sm:text-lg">Fleet</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setVehicleSheet({ editing: null })}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Vehicle
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        <Combobox
          className="min-h-[44px] sm:min-w-[220px]"
          value={zmccFilter}
          onValueChange={(v) => {
            setZmccFilter(v);
            setPage(1);
          }}
          placeholder="All ZMCCs"
          searchPlaceholder="Search ZMCC"
          options={[
            { value: '', label: 'All ZMCCs' },
            ...sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}`, keywords: `${s.code} ${s.name}` })),
          ]}
        />
        <Combobox
          className="min-h-[44px] sm:min-w-[220px]"
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          placeholder="Any status"
          searchPlaceholder="Search status"
          options={[
            { value: '', label: 'Any status' },
            ...(Object.keys(STATUS_META) as FleetStatus[]).map((k) => ({ value: k, label: STATUS_META[k].label })),
          ]}
        />
      </div>

      {error ? (
        <div className="bg-card border-border rounded-xl border p-3 text-xs font-semibold text-rose-800">{error}</div>
      ) : null}
      {message ? (
        <div className="bg-card border-border rounded-xl border p-3 text-xs font-semibold text-emerald-800">
          {message}
        </div>
      ) : null}
      {fleetQuery.error ? (
        <div className="bg-card border-border rounded-xl border p-3 text-xs font-semibold text-rose-800">
          {getErrorMessage(fleetQuery.error)}
        </div>
      ) : null}

      <DataTable paginate={false}
        columns={columns}
        rows={pageRows}
        getRowId={(r) => r.id}
        loading={fleetQuery.isLoading}
        emptyTitle="No vehicles found."
      />
      <Pager page={currentPage} totalPages={totalPages} total={rows.length} onPageChange={setPage} />

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
