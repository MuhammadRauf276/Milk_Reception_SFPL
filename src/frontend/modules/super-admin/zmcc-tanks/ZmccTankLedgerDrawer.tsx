'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, History, Loader2, Milk, ShieldAlert } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import type { TankItem } from '@/frontend/modules/zmcc/master/masterTypes';

interface Props {
  tank: TankItem | null;
  onClose: () => void;
}

interface TransactionRow {
  id: string;
  transaction_type: string;
  quantity_liters: number;
  at_13ts_liters: number | null;
  reference_type: string | null;
  reference_id: string | null;
  operational_timestamp: string;
  notes: string | null;
  performer: {
    id: string;
    username: string;
    full_name: string | null;
    role: string;
  } | null;
}

interface TransactionsResponse {
  tank: {
    id: string;
    tank_code: string;
    tank_name: string;
    capacity_liters: number;
    current_physical_stock_gross_liters: number;
    current_commercial_stock_at_13ts: number | null;
    available_capacity: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  transactions: TransactionRow[];
}

export function ZmccTankLedgerDrawer({ tank, onClose }: Props) {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['super-admin', 'zmcc-tanks', tank?.id, 'transactions', page],
    enabled: !!tank,
    queryFn: ({ signal }) =>
      fetchJson<TransactionsResponse>(
        `/api/super-admin/zmcc-tanks/${tank!.id}/transactions?page=${page}&pageSize=20`,
        { signal }
      ),
  });

  if (!tank) return null;

  const data = query.data;
  const transactions = data?.transactions ?? [];
  const loading = query.isPending;
  const error = query.error ? getErrorMessage(query.error) : null;
  const pagination = data?.pagination;

  const isPositiveType = (type: string) =>
    type === 'RECEIPT' || type === 'ADJUSTMENT_IN';

  return (
    <Drawer
      open={!!tank}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent className="max-h-[90vh]">
        <div className="border-b border-border px-5 py-3 flex items-center justify-between">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5 text-primary shrink-0" />
            <span>Stock Ledger · {tank.tank_code} ({tank.tank_name})</span>
          </DrawerTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 px-2 text-xs">
            Close
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
          {/* Tank Summary Header */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-subtle p-3 rounded-xl border border-border text-center">
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">Total Capacity</span>
              <span className="font-bold text-foreground tabular-nums">
                {tank.capacity_liters.toLocaleString()} L
              </span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">Gross Stock</span>
              <span className="font-bold text-blue-700 tabular-nums">
                {(data?.tank.current_physical_stock_gross_liters ?? tank.current_stock).toLocaleString()} L
              </span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">Commercial @13% TS</span>
              <span className="font-bold text-primary tabular-nums">
                {data?.tank.current_commercial_stock_at_13ts !== null && data?.tank.current_commercial_stock_at_13ts !== undefined
                  ? `${Number(data.tank.current_commercial_stock_at_13ts).toLocaleString()} L`
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">Available Space</span>
              <span className="font-bold text-emerald-700 tabular-nums">
                {(data?.tank.available_capacity ?? tank.available_capacity).toLocaleString()} L
              </span>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 font-semibold text-rose-800">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center flex flex-col items-center justify-center text-muted-foreground space-y-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-xs">Loading ledger entries…</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground">
              <Milk className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No ledger transactions found for this tank.</p>
              <p className="text-[11px] text-slate-500 mt-1">Milk additions and plant dispatches will appear here.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="border-b border-border bg-muted/50 text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
                    <tr>
                      <th className="p-3">Date &amp; Time</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-right">Gross Liters</th>
                      <th className="p-3 text-right">@13% TS (L)</th>
                      <th className="p-3">Reference / Notes</th>
                      <th className="p-3">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {transactions.map((tx) => {
                      const isIn = isPositiveType(tx.transaction_type);
                      return (
                        <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3 tabular-nums font-medium text-foreground whitespace-nowrap">
                            {new Date(tx.operational_timestamp).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                isIn
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {isIn ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              <span>{tx.transaction_type}</span>
                            </span>
                          </td>
                          <td
                            className={`p-3 text-right tabular-nums font-bold whitespace-nowrap ${
                              isIn ? 'text-emerald-700' : 'text-blue-700'
                            }`}
                          >
                            {isIn ? '+' : '-'}
                            {tx.quantity_liters.toLocaleString('en-US', { minimumFractionDigits: 2 })} L
                          </td>
                          <td
                            className={`p-3 text-right tabular-nums font-semibold whitespace-nowrap ${
                              isIn ? 'text-emerald-600' : 'text-blue-600'
                            }`}
                          >
                            {tx.at_13ts_liters !== null
                              ? `${isIn ? '+' : '-'}${tx.at_13ts_liters.toLocaleString('en-US', { minimumFractionDigits: 2 })} L`
                              : '—'}
                          </td>
                          <td className="p-3 text-slate-600 max-w-[220px] truncate" title={tx.notes || tx.reference_id || ''}>
                            <span className="font-semibold text-foreground block">{tx.reference_type || 'Ledger Entry'}</span>
                            <span className="text-[11px] text-muted-foreground">{tx.notes || tx.reference_id || '—'}</span>
                          </td>
                          <td className="p-3 whitespace-nowrap text-muted-foreground">
                            {tx.performer ? (
                              <div>
                                <span className="font-medium text-foreground block">{tx.performer.full_name || tx.performer.username}</span>
                                <span className="text-[10px] uppercase text-slate-500">{tx.performer.role}</span>
                              </div>
                            ) : (
                              'System'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-2.5 bg-subtle text-xs">
                  <span className="text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
