'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, ShieldAlert, CheckCircle2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { SiloDeactivateDrawer, SiloFormDrawer, type Silo } from '@/frontend/modules/super-admin/silos/SiloDrawers';

type Dialog = { kind: 'create' } | { kind: 'edit'; silo: Silo } | { kind: 'deactivate'; silo: Silo } | null;

export default function SuperAdminSilosPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  useAutoClearMessage(successMsg, setSuccessMsg);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['super-admin', 'silos'],
    queryFn: ({ signal }) => fetchJson<{ silos?: Silo[] }>('/api/super-admin/silos', { signal }),
  });
  const silos = query.data?.silos ?? [];
  const error = actionError || (query.error ? getErrorMessage(query.error) || 'Failed to load silos.' : null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['super-admin', 'silos'] });

  const activate = useMutation({
    mutationFn: (silo: Silo) =>
      fetchJson(`/api/super-admin/silos/${silo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      }),
    onSuccess: (_d, silo) => {
      setSuccessMsg(`Silo "${silo.siloCode}" reactivated successfully.`);
      void refresh();
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const handleSaved = (message: string) => {
    setSuccessMsg(message);
    setDialog(null);
    void refresh();
  };

  const columns: DataColumn<Silo>[] = [
    { key: 'code', header: 'Code', label: 'Code', cell: (s) => <span className="whitespace-nowrap font-mono font-semibold tabular-nums text-foreground">{s.siloCode}</span> },
    { key: 'name', header: 'Name', label: 'Name', primary: true, cell: (s) => <span className="font-semibold text-foreground">{s.siloName}</span> },
    { key: 'capacity', header: 'Capacity', label: 'Capacity', cell: (s) => <span className="font-mono tabular-nums text-muted-foreground">{s.capacityLiters.toLocaleString()} L</span> },
    {
      key: 'stock13',
      header: 'Stock @13% TS',
      label: 'Stock @13% TS',
      cell: (s) => (
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {s.currentStockAt13Ts !== null && s.currentStockAt13Ts !== undefined ? `${s.currentStockAt13Ts.toLocaleString()} L` : '—'}
          {s.compositeTsPercent !== null && s.compositeTsPercent !== undefined && (
            <span className="block text-xs font-normal text-muted-foreground">Avg TS: {s.compositeTsPercent}%</span>
          )}
        </span>
      ),
    },
    {
      key: 'physical',
      header: 'Physical stock',
      label: 'Physical stock',
      cell: (s) => {
        const fillPct = Math.min(100, Math.round((s.currentStockLiters / (s.capacityLiters || 1)) * 100));
        return (
          <div className="min-w-24 max-w-40 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs font-semibold text-foreground">
              <span className="font-mono tabular-nums">{s.currentStockLiters.toLocaleString()} L</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{fillPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${fillPct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'reserved',
      header: 'Reserved',
      label: 'Reserved',
      cell: (s) => <span className="font-mono tabular-nums text-muted-foreground">{s.activeReservationsLiters > 0 ? `${s.activeReservationsLiters.toLocaleString()} L` : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      cell: (s) =>
        s.isActive ? (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Active</span>
        ) : (
          <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-800">Inactive</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (s) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActionError(null);
              setDialog({ kind: 'edit', silo: s });
            }}
          >
            <Edit2 />
            Edit
          </Button>
          {s.isActive ? (
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'deactivate', silo: s })}>
              Deactivate
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActionError(null);
                setSuccessMsg(null);
                activate.mutate(s);
              }}
              disabled={activate.isPending}
            >
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Capacity, fill level and reservations</p>
        </div>
        <Button
          className="shrink-0"
          onClick={() => {
            setActionError(null);
            setDialog({ kind: 'create' });
          }}
        >
          <Plus />
          <span>Add silo</span>
        </Button>
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-rose-800 animate-panel-in">
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
            className="flex items-center space-x-2 rounded-2xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <DataTable
        columns={columns}
        rows={silos}
        getRowId={(s) => s.id}
        loading={query.isPending}
        emptyTitle="No silos found"
        tableFrom="lg"
      />

      {dialog?.kind === 'create' && <SiloFormDrawer silo={null} onClose={() => setDialog(null)} onSaved={handleSaved} />}
      {dialog?.kind === 'edit' && <SiloFormDrawer key={dialog.silo.id} silo={dialog.silo} onClose={() => setDialog(null)} onSaved={handleSaved} />}
      {dialog?.kind === 'deactivate' && <SiloDeactivateDrawer key={dialog.silo.id} silo={dialog.silo} onClose={() => setDialog(null)} onSaved={handleSaved} />}
    </div>
  );
}
