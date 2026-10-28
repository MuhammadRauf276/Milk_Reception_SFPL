'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, ShieldAlert, CheckCircle2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
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
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold text-foreground">Silo Storage</h1>
          <InfoTip text="Plant raw milk storage silos with capacity, fill levels, and allocation tracking." />
        </div>
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
        <div className="flex items-center space-x-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-rose-800 animate-panel-in">
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
            className="flex items-center space-x-2 rounded-xl border border-border bg-card p-4 text-xs font-semibold text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs font-sans">
            <thead className="border-b border-border bg-muted/50 text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Name</th>
                <th className="p-3">Capacity</th>
                <th className="p-3">Stock Level</th>
                <th className="p-3">Reserved</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-semibold text-foreground">
              {query.isPending ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center tabular-nums text-muted-foreground">
                    Loading silos…
                  </td>
                </tr>
              ) : silos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No silos found.
                  </td>
                </tr>
              ) : (
                silos.map((s) => {
                  const fillPct = Math.min(100, Math.round((s.currentStockLiters / (s.capacityLiters || 1)) * 100));
                  return (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-bold tabular-nums text-foreground">{s.siloCode}</td>
                      <td className="p-3 font-semibold text-foreground">{s.siloName}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">{s.capacityLiters.toLocaleString()} L</td>
                      <td className="p-3 tabular-nums">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-bold text-foreground">
                            <span>{s.currentStockLiters.toLocaleString()} L</span>
                            <span className="text-[10px] text-muted-foreground">{fillPct}%</span>
                          </div>
                          <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${fillPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {s.activeReservationsLiters > 0 ? `${s.activeReservationsLiters.toLocaleString()} L` : '—'}
                      </td>
                      <td className="p-3">
                        {s.isActive ? (
                          <span className="rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-md bg-rose-50 text-rose-800 border border-rose-200 px-2 py-0.5 text-[10px] font-bold">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setDialog({ kind: 'edit', silo: s });
                            }}
                            className="flex min-h-[36px] items-center space-x-1 rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-foreground transition hover:bg-muted/80 border border-border"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span>Edit</span>
                          </button>
                          {s.isActive ? (
                            <button
                              type="button"
                              onClick={() => setDialog({ kind: 'deactivate', silo: s })}
                              className="min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 border border-rose-200/60"
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
                              className="min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 border border-emerald-200/60"
                            >
                              Activate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
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
