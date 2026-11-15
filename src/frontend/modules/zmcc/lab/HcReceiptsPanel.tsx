'use client';

import { formatDateTime } from '@/lib/format';
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Search } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { useToast } from '@/frontend/context/ToastContext';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { InfoTip } from '@/components/ui/info-tip';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';

interface ReceiptRow {
  session_id: string;
  arrival_id: string;
  token: string;
  vehicle_number: string;
  supplier_code: string;
  supplier_name: string;
  unloaded_at: string | null;
  net_weight_kg: number | null;
  gross_liters: number | null;
  receipt_number?: string;
  issued_by?: string | null;
  issued_at?: string;
}

interface ReceiptWork {
  waiting: ReceiptRow[];
  issued: ReceiptRow[];
}

type OpenRow = { row: ReceiptRow; kind: 'waiting' | 'issued' };

const when = (iso?: string | null) => (iso ? formatDateTime(iso) : '—');

/** HC vehicles unloaded into the tank and waiting for the paper raw milk receipt number, and those already given one. */
export function HcReceiptsPanel() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenRow | null>(null);

  const query = useQuery({
    queryKey: ['zmcc', 'lab', 'hc-receipts'],
    queryFn: ({ signal }) => fetchJson<ReceiptWork>('/api/zmcc/lab/hc-receipts', { signal }),
    refetchInterval: 30_000,
  });

  const matches = (r: ReceiptRow) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [r.token, r.vehicle_number, r.supplier_code, r.supplier_name, r.receipt_number ?? ''].some((v) =>
      v.toLowerCase().includes(s)
    );
  };
  const waiting = useMemo(() => (query.data?.waiting ?? []).filter(matches), [query.data, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const issued = useMemo(() => (query.data?.issued ?? []).filter(matches), [query.data, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async (row: ReceiptRow) => {
    const number = (numbers[row.arrival_id] ?? '').trim();
    if (!number) {
      toast.showError('Enter the receipt number.');
      return;
    }
    setBusyId(row.arrival_id);
    try {
      await fetchJson(`/api/zmcc/hc-arrivals/${row.arrival_id}/rmr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_number: number, idempotency_key: `local-rmr-${row.session_id}-${Date.now()}` }),
      });
      toast.showSuccess(`Receipt ${number} saved for ${row.vehicle_number}.`);
      setOpen(null);
      await query.refetch();
    } catch (err) {
      toast.showError(getErrorMessage(err) || 'Could not save the receipt.');
    } finally {
      setBusyId(null);
    }
  };

  const inspectColumn = (kind: OpenRow['kind']): DataColumn<ReceiptRow> => ({
    key: 'actions',
    header: '',
    label: 'Inspect',
    actions: true,
    align: 'right',
    cell: (row) => (
      <Button type="button" variant="outline" size="sm" className="min-h-11 gap-1.5 text-xs font-semibold" onClick={() => setOpen({ row, kind })}>
        <Eye aria-hidden />
        Inspect
      </Button>
    ),
  });

  const waitingColumns = useMemo<DataColumn<ReceiptRow>[]>(
    () => [
      { key: 'vehicle', header: 'Vehicle', label: 'Vehicle', primary: true, cell: (r) => <span className="font-semibold">{r.vehicle_number}</span> },
      { key: 'supplier', header: 'Supplier', label: 'Supplier', cell: (r) => r.supplier_name },
      { key: 'token', header: 'Token', label: 'Token', cell: (r) => r.token },
      { key: 'unloaded', header: 'Unloaded', label: 'Unloaded', cardAlways: true, cell: (r) => <span className="tabular-nums whitespace-nowrap">{when(r.unloaded_at)}</span> },
      {
        key: 'net',
        header: 'Net kg',
        label: 'Net kg',
        align: 'right',
        cell: (r) => <span className="tabular-nums">{r.net_weight_kg !== null ? r.net_weight_kg.toLocaleString() : '—'}</span>,
      },
      inspectColumn('waiting'),
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const issuedColumns = useMemo<DataColumn<ReceiptRow>[]>(
    () => [
      { key: 'rmr', header: 'RMR', label: 'RMR', primary: true, cell: (r) => <span className="font-semibold tabular-nums">{r.receipt_number}</span> },
      { key: 'vehicle', header: 'Vehicle', label: 'Vehicle', cardAlways: true, cell: (r) => r.vehicle_number },
      { key: 'supplier', header: 'Supplier', label: 'Supplier', cell: (r) => r.supplier_name },
      { key: 'by', header: 'By', label: 'By', cell: (r) => r.issued_by ?? '—' },
      { key: 'at', header: 'Given', label: 'Given', cardAlways: true, cell: (r) => <span className="tabular-nums whitespace-nowrap">{when(r.issued_at)}</span> },
      inspectColumn('issued'),
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const loadError = query.error ? getErrorMessage(query.error) || 'Could not load HC receipts.' : null;
  const row = open?.row ?? null;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input
          aria-label="Search HC receipts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search token, vehicle, HC or receipt number"
          className="min-h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm"
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-foreground">Waiting for receipt number ({waiting.length})</h2>
          <InfoTip label="About waiting receipts" className="-my-2" text="HC vehicles unloaded into the tank that still need the paper receipt number." />
        </div>
        <DataTable
          columns={waitingColumns}
          rows={waiting}
          getRowId={(r) => r.arrival_id}
          loading={query.isPending}
          error={loadError}
          onRetry={() => void query.refetch()}
          noun="receipts"
          emptyTitle="Nothing waiting"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Receipts already given ({issued.length})</h2>
        <DataTable
          columns={issuedColumns}
          rows={issued}
          getRowId={(r) => r.arrival_id}
          loading={query.isPending}
          noun="receipts"
          emptyTitle="None yet"
        />
      </section>

      <ZmccDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={row ? (open?.kind === 'issued' ? `RMR ${row.receipt_number}` : row.vehicle_number) : 'Receipt'}
        subtitle={row ? `${row.vehicle_number} · ${row.supplier_name}` : undefined}
      >
        {row && open && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">Token</dt>
                <dd className="font-medium">{row.token}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Supplier</dt>
                <dd className="font-medium break-words">
                  {row.supplier_name} · {row.supplier_code}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Unloaded</dt>
                <dd className="font-medium tabular-nums">{when(row.unloaded_at)}</dd>
              </div>
              {row.net_weight_kg !== null && (
                <div>
                  <dt className="text-xs text-muted-foreground">Net</dt>
                  <dd className="font-medium tabular-nums">{row.net_weight_kg.toLocaleString()} kg</dd>
                </div>
              )}
              {row.gross_liters !== null && (
                <div>
                  <dt className="text-xs text-muted-foreground">Litres</dt>
                  <dd className="font-medium tabular-nums">{row.gross_liters.toLocaleString()} L</dd>
                </div>
              )}
              {open.kind === 'issued' && (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">RMR</dt>
                    <dd className="font-medium tabular-nums">{row.receipt_number}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Given by</dt>
                    <dd className="font-medium break-words">{row.issued_by ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Given at</dt>
                    <dd className="font-medium tabular-nums">{when(row.issued_at)}</dd>
                  </div>
                </>
              )}
            </dl>

            {open.kind === 'waiting' && (
              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`hc-rmr-${row.arrival_id}`} className="mb-1 flex items-center gap-1 text-xs font-semibold text-foreground">
                    RMR number
                    <InfoTip label="About the RMR number" className="-my-2" text="The number printed on the paper raw milk receipt." />
                  </label>
                  <input
                    id={`hc-rmr-${row.arrival_id}`}
                    value={numbers[row.arrival_id] ?? ''}
                    onChange={(e) => setNumbers((prev) => ({ ...prev, [row.arrival_id]: e.target.value.replace(/[^0-9]/g, '') }))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 004821"
                    className="min-h-11 w-full rounded-lg border border-border bg-subtle px-3 text-sm tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  disabled={busyId === row.arrival_id || !numbers[row.arrival_id]}
                  onClick={() => issue(row)}
                  className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busyId === row.arrival_id ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
        )}
      </ZmccDrawer>
    </div>
  );
}
