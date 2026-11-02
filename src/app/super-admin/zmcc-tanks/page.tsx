'use client';

import React, { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  ShieldAlert,
  CheckCircle2,
  Milk,
  History,
  Building2,
  Edit2,
  Layers,
  Power,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { Combobox } from '@/components/ui/combobox';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { ZmccTankIntakeDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankIntakeDrawer';
import { ZmccTankLedgerDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankLedgerDrawer';
import { FormDrawer, DrawerActions, fieldInputClass, fieldLabelClass } from '@/frontend/modules/super-admin/shared/FormDrawer';
import type { TankItem, ZmccSource } from '@/frontend/modules/zmcc/master/masterTypes';

export default function SuperAdminZmccTanksPage() {
  const queryClient = useQueryClient();
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');
  const [intakeTank, setIntakeTank] = useState<TankItem | null>(null);
  const [ledgerTank, setLedgerTank] = useState<TankItem | null>(null);
  const [editTank, setEditTank] = useState<TankItem | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Form state for Create / Edit Tank
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formCapacity, setFormCapacity] = useState('');
  const [formZmccId, setFormZmccId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Load ZMCC Sources
  const sourcesQuery = useQuery({
    queryKey: ['super-admin', 'zmcc-sources'],
    queryFn: ({ signal }) => fetchJson<{ zmccs?: ZmccSource[] }>('/api/zmcc/sources', { signal }),
  });
  const sources = useMemo(() => sourcesQuery.data?.zmccs ?? [], [sourcesQuery.data]);

  // Load Tanks
  const tanksQuery = useQuery({
    queryKey: ['super-admin', 'zmcc-tanks', selectedZmccId],
    queryFn: ({ signal }) => {
      const url = selectedZmccId ? `/api/zmcc/tanks?zmcc_id=${selectedZmccId}` : '/api/zmcc/tanks';
      return fetchJson<{ tanks?: TankItem[] }>(url, { signal });
    },
  });
  const tanks = tanksQuery.data?.tanks ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['super-admin', 'zmcc-tanks'] });
    void queryClient.invalidateQueries({ queryKey: ['zmcc', 'master'] });
  };

  // Aggregated KPI Metrics
  const stats = useMemo(() => {
    let totalCap = 0;
    let totalGross = 0;
    let total13Ts = 0;
    let activeCount = 0;

    for (const t of tanks) {
      if (t.is_active) {
        activeCount++;
        totalCap += Number(t.capacity_liters || 0);
        totalGross += Number(t.current_stock || 0);
        if (t.current_commercial_stock_at_13ts) {
          total13Ts += Number(t.current_commercial_stock_at_13ts);
        }
      }
    }
    return {
      activeCount,
      totalCap,
      totalGross,
      total13Ts,
      availableCap: Math.max(0, totalCap - totalGross),
    };
  }, [tanks]);

  // Create Tank Mutation
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/zmcc/tanks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSuccessMsg(`Tank "${formCode.toUpperCase()}" created successfully.`);
      setIsCreateOpen(false);
      resetForm();
      refresh();
    },
    onError: (err) => setFormError(getErrorMessage(err) || 'Failed to create tank.'),
  });

  // Edit Tank Mutation
  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      fetchJson(`/api/zmcc/tanks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setSuccessMsg(`Tank "${editTank?.tank_code}" updated successfully.`);
      setEditTank(null);
      resetForm();
      refresh();
    },
    onError: (err) => setFormError(getErrorMessage(err) || 'Failed to update tank.'),
  });

  // Toggle Active Mutation
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetchJson(`/api/zmcc/tanks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      }),
    onSuccess: (_data, vars) => {
      setSuccessMsg(`Tank ${vars.isActive ? 'activated' : 'deactivated'} successfully.`);
      refresh();
    },
    onError: (err) => setActionError(getErrorMessage(err) || 'Failed to toggle tank status.'),
  });

  const resetForm = () => {
    setFormCode('');
    setFormName('');
    setFormCapacity('');
    setFormZmccId('');
    setFormError(null);
  };

  const openCreate = () => {
    resetForm();
    setFormZmccId(selectedZmccId || sources[0]?.id || '');
    setIsCreateOpen(true);
  };

  const openEdit = (t: TankItem) => {
    resetForm();
    setFormCode(t.tank_code);
    setFormName(t.tank_name);
    setFormCapacity(t.capacity_liters.toString());
    setFormZmccId(t.zmcc_id);
    setEditTank(t);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCode.trim()) return setFormError('Tank Code is required.');
    if (!formName.trim()) return setFormError('Tank Name is required.');
    const capNum = parseFloat(formCapacity);
    if (isNaN(capNum) || capNum <= 0) return setFormError('Capacity must be a positive number.');
    if (!formZmccId) return setFormError('Please select a ZMCC.');

    createMutation.mutate({
      zmcc_id: formZmccId,
      tank_code: formCode.trim().toUpperCase(),
      tank_name: formName.trim(),
      capacity_liters: capNum,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTank) return;
    if (!formName.trim()) return setFormError('Tank Name is required.');
    const capNum = parseFloat(formCapacity);
    if (isNaN(capNum) || capNum <= 0) return setFormError('Capacity must be a positive number.');

    editMutation.mutate({
      id: editTank.id,
      body: {
        tank_name: formName.trim(),
        capacity_liters: capNum,
      },
    });
  };

  const zmccFilterOptions = [
    { value: '', label: 'All ZMCCs' },
    ...sources.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
  ];

  const error = actionError || (tanksQuery.error ? getErrorMessage(tanksQuery.error) : null);

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold text-foreground">ZMCC Tank Storage &amp; Stock</h1>
          <InfoTip text="Raw milk storage tanks across all ZMCC sources. Directly add milk stock (@13% TS and Gross Liters) when field staff are absent, and monitor dispatch issue deductions." />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-11 shrink-0 px-3.5"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            <span>Add Tank</span>
          </Button>
          <Button
            className="h-11 shrink-0 px-4"
            disabled={tanks.filter((t) => t.is_active).length === 0}
            onClick={() => {
              const active = tanks.find((t) => t.is_active);
              if (active) setIntakeTank(active);
            }}
          >
            <Milk className="h-4 w-4 mr-1.5" />
            <span>Intake Milk Stock</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] uppercase font-semibold">
            <span>Active Tanks</span>
            <Building2 className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums mt-1">{stats.activeCount}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Across {sources.length} ZMCCs</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] uppercase font-semibold">
            <span>Gross Physical Stock</span>
            <Milk className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-blue-700 tabular-nums mt-1">
            {stats.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Physical milk stored</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] uppercase font-semibold">
            <span>Commercial @13% TS Stock</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-primary tabular-nums mt-1">
            {stats.total13Ts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Standardized 13% TS</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-[11px] uppercase font-semibold">
            <span>Free Storage Capacity</span>
            <Building2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
            {stats.availableCap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total: {stats.totalCap.toLocaleString()} L</div>
        </div>
      </div>

      {/* Notifications */}
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

      {/* Filter Bar */}
      <div className="flex items-center justify-between bg-card p-3 rounded-xl border border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Filter ZMCC:</span>
          <Combobox
            options={zmccFilterOptions}
            value={selectedZmccId}
            onValueChange={setSelectedZmccId}
            placeholder="All ZMCCs"
            searchPlaceholder="Search ZMCC"
            className="min-h-10 w-60 text-xs font-semibold"
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          Showing {tanks.length} tank{tanks.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Tanks Table */}
      <div className="w-full max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[750px] text-left text-xs font-sans">
            <thead className="border-b border-border bg-muted/50 text-muted-foreground uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="p-3">ZMCC</th>
                <th className="p-3">Tank Code</th>
                <th className="p-3">Tank Name</th>
                <th className="p-3 text-right">Capacity</th>
                <th className="p-3 text-right">Physical Stock (Gross)</th>
                <th className="p-3 text-right">Stock @13% TS</th>
                <th className="p-3 text-right">Free Space</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 font-semibold text-foreground">
              {tanksQuery.isPending ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    Loading tanks…
                  </td>
                </tr>
              ) : tanks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    No tanks found for the selected scope.
                  </td>
                </tr>
              ) : (
                tanks.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-semibold text-foreground">
                      {t.zmcc ? `${t.zmcc.name} (${t.zmcc.code})` : '—'}
                    </td>
                    <td className="p-3 font-bold tabular-nums text-foreground">{t.tank_code}</td>
                    <td className="p-3 text-muted-foreground">{t.tank_name}</td>
                    <td className="p-3 text-right tabular-nums">
                      {Number(t.capacity_liters).toLocaleString('en-US', { minimumFractionDigits: 2 })} L
                    </td>
                    <td className="p-3 text-right tabular-nums text-blue-700 font-bold">
                      {Number(t.current_stock).toLocaleString('en-US', { minimumFractionDigits: 2 })} L
                    </td>
                    <td className="p-3 text-right tabular-nums text-primary font-bold">
                      {t.current_commercial_stock_at_13ts !== null && t.current_commercial_stock_at_13ts !== undefined
                        ? `${Number(t.current_commercial_stock_at_13ts).toLocaleString('en-US', { minimumFractionDigits: 2 })} L`
                        : '—'}
                    </td>
                    <td className="p-3 text-right tabular-nums text-emerald-700">
                      {Number(t.available_capacity).toLocaleString('en-US', { minimumFractionDigits: 2 })} L
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          t.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {t.is_active && (
                          <Button
                            size="sm"
                            className="h-8 px-2.5 text-xs bg-primary hover:bg-primary-hover text-white"
                            onClick={() => setIntakeTank(t)}
                            title="Add manual milk stock (Gross and @13% TS)"
                          >
                            <Milk className="h-3.5 w-3.5 mr-1" />
                            <span>Intake</span>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => setLedgerTank(t)}
                          title="View immutable stock transactions ledger"
                        >
                          <History className="h-3.5 w-3.5 mr-1" />
                          <span>Ledger</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(t)}
                          title="Edit tank configuration"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-slate-700" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`h-8 w-8 p-0 ${
                            t.is_active
                              ? 'text-rose-600 border-rose-200 hover:bg-rose-50'
                              : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                          }`}
                          onClick={() => toggleMutation.mutate({ id: t.id, isActive: !t.is_active })}
                          title={t.is_active ? 'Deactivate tank' : 'Activate tank'}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Stock Intake Drawer */}
      <ZmccTankIntakeDrawer
        tank={intakeTank}
        onClose={() => setIntakeTank(null)}
        onSaved={(msg) => {
          setSuccessMsg(msg);
          refresh();
        }}
      />

      {/* Transaction History Ledger Drawer */}
      <ZmccTankLedgerDrawer
        tank={ledgerTank}
        onClose={() => setLedgerTank(null)}
      />

      {/* Create Tank Drawer */}
      <FormDrawer
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Add ZMCC Tank"
        busy={createMutation.isPending}
        error={formError}
      >
        <form onSubmit={handleCreateSubmit} className="space-y-3">
          <div>
            <label htmlFor="create-zmcc-id" className={fieldLabelClass}>ZMCC Source *</label>
            <select
              id="create-zmcc-id"
              value={formZmccId}
              onChange={(e) => setFormZmccId(e.target.value)}
              className={fieldInputClass}
              required
            >
              <option value="">Select ZMCC Source</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="create-tank-code" className={fieldLabelClass}>Tank Code *</label>
            <input
              id="create-tank-code"
              type="text"
              required
              value={formCode}
              onChange={(e) => setFormCode(e.target.value.toUpperCase())}
              placeholder="e.g. TANK-01"
              className={fieldInputClass}
            />
          </div>
          <div>
            <label htmlFor="create-tank-name" className={fieldLabelClass}>Tank Name *</label>
            <input
              id="create-tank-name"
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Raw Milk Tank 1"
              className={fieldInputClass}
            />
          </div>
          <div>
            <label htmlFor="create-tank-capacity" className={fieldLabelClass}>Capacity (Liters) *</label>
            <input
              id="create-tank-capacity"
              type="number"
              step="0.01"
              min="1"
              required
              value={formCapacity}
              onChange={(e) => setFormCapacity(e.target.value)}
              placeholder="e.g. 50000"
              className={fieldInputClass}
            />
          </div>
          <DrawerActions
            busy={createMutation.isPending}
            onCancel={() => setIsCreateOpen(false)}
            submitLabel="Create Tank"
            busyLabel="Creating…"
          />
        </form>
      </FormDrawer>

      {/* Edit Tank Drawer */}
      <FormDrawer
        open={!!editTank}
        onClose={() => setEditTank(null)}
        title={`Edit Tank · ${editTank?.tank_code}`}
        busy={editMutation.isPending}
        error={formError}
      >
        <form onSubmit={handleEditSubmit} className="space-y-3">
          <div>
            <label className={fieldLabelClass}>Tank Code</label>
            <input
              type="text"
              disabled
              value={formCode}
              className={`${fieldInputClass} bg-muted text-muted-foreground`}
            />
          </div>
          <div>
            <label htmlFor="edit-tank-name" className={fieldLabelClass}>Tank Name *</label>
            <input
              id="edit-tank-name"
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className={fieldInputClass}
            />
          </div>
          <div>
            <label htmlFor="edit-tank-capacity" className={fieldLabelClass}>Capacity (Liters) *</label>
            <input
              id="edit-tank-capacity"
              type="number"
              step="0.01"
              min="1"
              required
              value={formCapacity}
              onChange={(e) => setFormCapacity(e.target.value)}
              className={fieldInputClass}
            />
          </div>
          <DrawerActions
            busy={editMutation.isPending}
            onCancel={() => setEditTank(null)}
            submitLabel="Save Changes"
            busyLabel="Saving…"
          />
        </form>
      </FormDrawer>
    </div>
  );
}
