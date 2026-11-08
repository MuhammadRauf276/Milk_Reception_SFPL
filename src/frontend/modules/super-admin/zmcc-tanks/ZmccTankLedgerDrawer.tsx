'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, History, ShieldAlert } from 'lucide-react';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
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

  const columns: DataColumn<TransactionRow>[] = [
    {
      key: 'when',
      header: 'Date and time',
      label: 'Date and time',
      primary: true,
      cell: (tx) => (
        <span className="tabular-nums font-medium text-foreground">
          {new Date(tx.operational_timestamp).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      label: 'Type',
      cell: (tx) => {
        const isIn = isPositiveType(tx.transaction_type);
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              isIn ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
            }`}
          >
            {isIn ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            <span>{tx.transaction_type}</span>
          </span>
        );
      },
    },
    {
      key: 'gross',
      header: 'Gross liters',
      label: 'Gross liters',
      align: 'right',
      cell: (tx) => {
        const isIn = isPositiveType(tx.transaction_type);
        return (
          <span className={`tabular-nums font-semibold ${isIn ? 'text-emerald-700' : 'text-blue-700'}`}>
            {isIn ? '+' : '-'}
            {tx.quantity_liters.toLocaleString('en-US', { minimumFractionDigits: 2 })} L
          </span>
        );
      },
    },
    {
      key: 'ts13',
      header: '@13% TS (L)',
      label: '@13% TS (L)',
      align: 'right',
      cell: (tx) => {
        const isIn = isPositiveType(tx.transaction_type);
        return (
          <span className={`tabular-nums font-semibold ${isIn ? 'text-emerald-600' : 'text-blue-600'}`}>
            {tx.at_13ts_liters !== null
              ? `${isIn ? '+' : '-'}${tx.at_13ts_liters.toLocaleString('en-US', { minimumFractionDigits: 2 })} L`
              : '—'}
          </span>
        );
      },
    },
    {
      key: 'reference',
      header: 'Reference / notes',
      label: 'Reference / notes',
      className: 'min-w-[10rem]',
      cell: (tx) => (
        <div className="text-secondary-foreground" title={tx.notes || tx.reference_id || ''}>
          <span className="font-semibold text-foreground block">{tx.reference_type || 'Ledger entry'}</span>
          <span className="text-xs text-muted-foreground">{tx.notes || tx.reference_id || '—'}</span>
        </div>
      ),
    },
    {
      key: 'by',
      header: 'Recorded by',
      label: 'Recorded by',
      cell: (tx) => (
        <span className="text-muted-foreground">
          {tx.performer ? (
            <div>
              <span className="font-medium text-foreground block">{tx.performer.full_name || tx.performer.username}</span>
              <span className="text-xs text-muted-foreground">{tx.performer.role}</span>
            </div>
          ) : (
            'System'
          )}
        </span>
      ),
    },
  ];
  return (
    <Drawer
      open={!!tank}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent className="max-h-[90vh]">
        <div className="border-b border-border px-4 sm:px-5 py-3 flex items-center justify-between gap-2">
          <DrawerTitle className="flex items-center gap-2 text-sm sm:text-base min-w-0">
            <History className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="min-w-0 break-words">Stock ledger · {tank.tank_code}</span>
          </DrawerTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0 text-xs">
            Close
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3.5 sm:py-4 space-y-4 text-xs">
          {/* Tank Summary Header */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 bg-subtle p-3 rounded-xl border border-border text-center">
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground font-medium block">Total capacity</span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {tank.capacity_liters.toLocaleString()} L
              </span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground font-medium block">Gross stock</span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {(data?.tank.current_physical_stock_gross_liters ?? tank.current_stock).toLocaleString()} L
              </span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground font-medium block">Commercial @13% TS</span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {data?.tank.current_commercial_stock_at_13ts !== null && data?.tank.current_commercial_stock_at_13ts !== undefined
                  ? `${Number(data.tank.current_commercial_stock_at_13ts).toLocaleString()} L`
                  : 'N/A'}
              </span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground font-medium block">Available space</span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
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

          <DataTable
            columns={columns}
            rows={transactions}
            getRowId={(tx) => tx.id}
            loading={loading}
            emptyTitle="No ledger entries for this tank"
            emptyDescription="Milk additions and plant dispatches will appear here."
            footer={
              pagination && pagination.totalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-subtle px-4 py-2.5 text-xs">
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
              ) : null
            }
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
