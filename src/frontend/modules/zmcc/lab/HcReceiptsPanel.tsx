'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Search } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { useToast } from '@/frontend/context/ToastContext';

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

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** HC vehicles unloaded into the tank and waiting for the paper raw milk receipt number, and those already given one. */
export function HcReceiptsPanel() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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
      await query.refetch();
    } catch (err) {
      toast.showError(getErrorMessage(err) || 'Could not save the receipt.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
        <input
          aria-label="Search HC receipts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search token, vehicle, HC or receipt number"
          className="min-h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm"
        />
      </div>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <h2 className="text-sm font-semibold text-foreground">Waiting for receipt number ({waiting.length})</h2>
        {query.isPending ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : query.error ? (
          <p role="alert" className="text-sm text-rose-700">
            {getErrorMessage(query.error) || 'Could not load HC receipts.'}
          </p>
        ) : waiting.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            No HC vehicle is waiting for a receipt number.
          </p>
        ) : (
          waiting.map((row) => (
            <div key={row.arrival_id} className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm font-semibold text-foreground">
                {row.vehicle_number} · {row.supplier_name}
              </p>
              <p className="text-xs text-slate-500">
                Token {row.token} · {row.supplier_code} · Unloaded {when(row.unloaded_at)}
                {row.net_weight_kg !== null && ` · ${row.net_weight_kg.toLocaleString()} kg`}
                {row.gross_liters !== null && ` · ${row.gross_liters.toLocaleString()} L`}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`hc-rmr-${row.arrival_id}`} className="mb-1 block text-xs font-semibold text-slate-900">
                    RMR Token (Paper Receipt No.)
                  </label>
                  <input
                    id={`hc-rmr-${row.arrival_id}`}
                    value={numbers[row.arrival_id] ?? ''}
                    onChange={(e) =>
                      setNumbers((prev) => ({ ...prev, [row.arrival_id]: e.target.value.replace(/[^0-9]/g, '') }))
                    }
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
                  {busyId === row.arrival_id ? 'Saving…' : 'Save Receipt'}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <h2 className="text-sm font-semibold text-foreground">Receipts already given ({issued.length})</h2>
        {issued.length === 0 ? (
          <p className="text-sm text-slate-500">None yet.</p>
        ) : (
          issued.map((row) => (
            <div key={row.arrival_id} className="rounded-xl border border-border p-3">
              <p className="text-sm font-semibold text-foreground">
                RMR {row.receipt_number} · {row.vehicle_number} · {row.supplier_name}
              </p>
              <p className="text-xs text-slate-500">
                Token {row.token} · By {row.issued_by ?? '—'} · {when(row.issued_at)}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
