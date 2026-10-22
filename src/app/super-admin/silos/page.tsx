'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, ShieldAlert, CheckCircle2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { SiloDeactivateDrawer, SiloFormDrawer, type Silo } from '@/frontend/modules/super-admin/silos/SiloDrawers';

type Dialog = { kind: 'create' } | { kind: 'edit'; silo: Silo } | { kind: 'deactivate'; silo: Silo } | null;

export default function SuperAdminSilosPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h1 className="text-xl font-semibold text-foreground">Silo Storage</h1>
        <Button
          className="h-11 shrink-0 px-4"
          onClick={() => {
            setActionError(null);
            setDialog({ kind: 'create' });
          }}
        >
          <Plus />
          <span>Add Silo</span>
        </Button>
      </div>

      {error && (
        <div className="flex items-center space-x-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 animate-panel-in">
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
            className="flex items-center space-x-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-full overflow-hidden rounded-xl border border-border/80 bg-white shadow-xs">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead className="border-b border-border bg-subtle text-slate-600">
              <tr>
                <th className="p-3 font-semibold">Code</th>
                <th className="p-3 font-semibold">Name</th>
                <th className="p-3 font-semibold">Total Capacity</th>
                <th className="p-3 font-semibold">Current Stock</th>
                <th className="p-3 font-semibold">Active Reservations</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-medium">
              {query.isPending ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center tabular-nums text-slate-400">
                    Loading silo storage records…
                  </td>
                </tr>
              ) : silos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400">
                    No silos configured.
                  </td>
                </tr>
              ) : (
                silos.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-3 font-semibold tabular-nums text-foreground">{s.siloCode}</td>
                    <td className="p-3 font-semibold text-slate-800">{s.siloName}</td>
                    <td className="p-3 font-semibold tabular-nums text-blue-900">{s.capacityLiters.toLocaleString()} L</td>
                    <td className="p-3 font-semibold tabular-nums text-emerald-800">{s.currentStockLiters.toLocaleString()} L</td>
                    <td className="p-3 font-semibold tabular-nums text-amber-800">{s.activeReservationsLiters.toLocaleString()} L</td>
                    <td className="p-3">
                      {s.isActive ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Active</span>
                      ) : (
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Inactive</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setDialog({ kind: 'edit', silo: s });
                          }}
                          className="flex min-h-[44px] items-center space-x-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
                          title="Edit Silo Capacity"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                        {s.isActive ? (
                          <button
                            type="button"
                            onClick={() => setDialog({ kind: 'deactivate', silo: s })}
                            className="min-h-[44px] rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                            title="Deactivate Silo"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setSuccessMsg(null);
                              activate.mutate(s);
                            }}
                            disabled={activate.isPending}
                            className="min-h-[44px] rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                            title="Reactivate Silo"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialog?.kind === 'create' && <SiloFormDrawer silo={null} onClose={() => setDialog(null)} onSaved={handleSaved} />}
      {dialog?.kind === 'edit' && <SiloFormDrawer key={dialog.silo.id} silo={dialog.silo} onClose={() => setDialog(null)} onSaved={handleSaved} />}
      {dialog?.kind === 'deactivate' && <SiloDeactivateDrawer key={dialog.silo.id} silo={dialog.silo} onClose={() => setDialog(null)} onSaved={handleSaved} />}
    </div>
  );
}
