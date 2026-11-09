'use client';

import { useAutoClearMessage } from '@/frontend/hooks/useAutoClearMessage';
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
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { fadeSlide } from '@/components/motion/presets';
import { getErrorMessage } from '@/lib/errors';
import { fetchJson } from '@/lib/query/fetchJson';
import { ZmccTankIntakeDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankIntakeDrawer';
import { ZmccTankOuttakeDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankOuttakeDrawer';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { ZmccTankLedgerDrawer } from '@/frontend/modules/super-admin/zmcc-tanks/ZmccTankLedgerDrawer';
import { FormDrawer, DrawerActions, fieldInputClass, fieldLabelClass } from '@/frontend/modules/super-admin/shared/FormDrawer';
import type { TankItem, ZmccSource } from '@/frontend/modules/zmcc/master/masterTypes';

const L2 = { minimumFractionDigits: 2 } as const;

export default function SuperAdminZmccTanksPage() {
  const queryClient = useQueryClient();
  const [selectedZmccId, setSelectedZmccId] = useState<string>('');
  const [intakeTank, setIntakeTank] = useState<TankItem | null>(null);
  const [outtakeTank, setOuttakeTank] = useState<TankItem | null>(null);
  const { currentUser: signedInUser } = useCurrentUser();
  const canOuttake = signedInUser?.role === 'SUPER_ADMIN';
  const [ledgerTank, setLedgerTank] = useState<TankItem | null>(null);
  const [editTank, setEditTank] = useState<TankItem | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  useAutoClearMessage(successMsg, setSuccessMsg);
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

  const tankColumns: DataColumn<TankItem>[] = [
    { key: 'zmcc', header: 'ZMCC', label: 'ZMCC', cell: (t) => <span className="font-semibold text-foreground">{t.zmcc ? `${t.zmcc.name} (${t.zmcc.code})` : '—'}</span> },
    { key: 'code', header: 'Tank code', label: 'Tank code', primary: true, cell: (t) => <span className="break-all font-mono font-semibold tabular-nums text-foreground">{t.tank_code}</span> },
    { key: 'name', header: 'Tank name', label: 'Tank name', cell: (t) => <span className="text-muted-foreground">{t.tank_name}</span> },
    { key: 'capacity', header: 'Capacity', label: 'Capacity', align: 'right', cell: (t) => <span className="font-mono tabular-nums">{Number(t.capacity_liters).toLocaleString('en-US', L2)} L</span> },
    {
      key: 'gross',
      header: 'Physical stock (gross)',
      label: 'Physical stock (gross)',
      align: 'right',
      cell: (t) => {
        const cap = Number(t.capacity_liters) || 0;
        const gross = Number(t.current_stock) || 0;
        const fillPct = cap > 0 ? Math.min(100, Math.round((gross / cap) * 100)) : 0;
        return (
          <div className="ml-auto min-w-28 space-y-1">
            <div className="font-mono font-semibold tabular-nums text-foreground">{Number(t.current_stock).toLocaleString('en-US', L2)} L</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Fill level ${fillPct}%`}>
              <div className={`h-full rounded-full transition-[width] duration-300 ${fillPct > 90 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${fillPct}%` }} />
            </div>
            <div className="text-xs font-normal tabular-nums text-muted-foreground">{fillPct}% full</div>
          </div>
        );
      },
    },
    {
      key: 'ts13',
      header: 'Stock @13% TS',
      label: 'Stock @13% TS',
      align: 'right',
      cell: (t) => (
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {t.current_commercial_stock_at_13ts !== null && t.current_commercial_stock_at_13ts !== undefined
            ? `${Number(t.current_commercial_stock_at_13ts).toLocaleString('en-US', L2)} L`
            : '—'}
        </span>
      ),
    },
    { key: 'free', header: 'Free space', label: 'Free space', align: 'right', cell: (t) => <span className="font-mono tabular-nums text-foreground">{Number(t.available_capacity).toLocaleString('en-US', L2)} L</span> },
    {
      key: 'status',
      header: 'Status',
      label: 'Status',
      align: 'center',
      cell: (t) => (
        <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${t.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
          {t.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      label: 'Actions',
      actions: true,
      align: 'right',
      cell: (t) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {t.is_active && (
            <Button size="sm" onClick={() => setIntakeTank(t)} title="Add manual milk stock (gross and @13% TS)">
              <Milk />
              Intake
            </Button>
          )}
          {t.is_active && canOuttake && (
            <Button variant="outline" size="sm" onClick={() => setOuttakeTank(t)} title="Take milk out of this tank">
              Outtake
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setLedgerTank(t)} title="View stock transaction ledger">
            <History />
            Ledger
          </Button>
          <Button variant="outline" size="icon" onClick={() => openEdit(t)} title="Edit tank configuration" aria-label="Edit tank configuration">
            <Edit2 className="text-muted-foreground" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => toggleMutation.mutate({ id: t.id, isActive: !t.is_active })}
            title={t.is_active ? 'Deactivate tank' : 'Activate tank'}
            aria-label={t.is_active ? 'Deactivate tank' : 'Activate tank'}
          >
            <Power className="text-muted-foreground" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Storage tanks and stock at each ZMCC</p>
          <InfoTip text="Add milk stock here when field staff are absent." />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={openCreate}>
            <Plus />
            <span>Add tank</span>
          </Button>
          <Button
            disabled={tanks.filter((t) => t.is_active).length === 0}
            onClick={() => {
              const active = tanks.find((t) => t.is_active);
              if (active) setIntakeTank(active);
            }}
          >
            <Milk />
            <span>Intake milk stock</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>Active tanks</span>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="font-mono text-2xl font-semibold text-foreground tabular-nums mt-1">{stats.activeCount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Across {sources.length} ZMCCs</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>Gross physical stock</span>
            <Milk className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="font-mono text-2xl font-semibold text-foreground tabular-nums mt-1">
            {stats.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Physical milk stored</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>Commercial @13% TS stock</span>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="font-mono text-2xl font-semibold text-foreground tabular-nums mt-1">
            {stats.total13Ts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Standardized 13% TS</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>Free storage capacity</span>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="font-mono text-2xl font-semibold text-foreground tabular-nums mt-1">
            {stats.availableCap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Total: {stats.totalCap.toLocaleString()} L</div>
        </div>
      </div>

      {/* Notifications */}
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

      {/* Filter Bar */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Filter ZMCC</span>
          <Combobox
            options={zmccFilterOptions}
            value={selectedZmccId}
            onValueChange={setSelectedZmccId}
            placeholder="All ZMCCs"
            searchPlaceholder="Search ZMCC"
            className="min-h-11 w-full max-w-60 text-xs font-medium"
          />
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          Showing {tanks.length} tank{tanks.length === 1 ? '' : 's'}
        </span>
      </div>

      <DataTable
        columns={tankColumns}
        rows={tanks}
        getRowId={(t) => t.id}
        loading={tanksQuery.isPending}
        emptyTitle="No tanks found"
        emptyDescription="There are no tanks for the selected scope."
        tableFrom="lg"
      />

      {/* Manual Stock Intake Drawer */}
      <ZmccTankIntakeDrawer
        tank={intakeTank}
        onClose={() => setIntakeTank(null)}
        onSaved={(msg) => {
          setSuccessMsg(msg);
          refresh();
        }}
      />

      <ZmccTankOuttakeDrawer
        tank={outtakeTank}
        onClose={() => setOuttakeTank(null)}
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
        title="Add ZMCC tank"
        busy={createMutation.isPending}
        error={formError}
      >
        <form onSubmit={handleCreateSubmit} className="space-y-3">
          <div>
            <label htmlFor="create-zmcc-id" className={fieldLabelClass}>ZMCC source *</label>
            <select
              id="create-zmcc-id"
              value={formZmccId}
              onChange={(e) => setFormZmccId(e.target.value)}
              className={fieldInputClass}
              required
            >
              <option value="">Select ZMCC source</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="create-tank-code" className={fieldLabelClass}>Tank code *</label>
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
            <label htmlFor="create-tank-name" className={fieldLabelClass}>Tank name *</label>
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
            <label htmlFor="create-tank-capacity" className={fieldLabelClass}>Capacity (liters) *</label>
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
            submitLabel="Create tank"
            busyLabel="Creating…"
          />
        </form>
      </FormDrawer>

      {/* Edit Tank Drawer */}
      <FormDrawer
        open={!!editTank}
        onClose={() => setEditTank(null)}
        title={`Edit tank · ${editTank?.tank_code}`}
        busy={editMutation.isPending}
        error={formError}
      >
        <form onSubmit={handleEditSubmit} className="space-y-3">
          <div>
            <label className={fieldLabelClass}>Tank code</label>
            <input
              type="text"
              disabled
              value={formCode}
              className={`${fieldInputClass} bg-muted text-muted-foreground`}
            />
          </div>
          <div>
            <label htmlFor="edit-tank-name" className={fieldLabelClass}>Tank name *</label>
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
            <label htmlFor="edit-tank-capacity" className={fieldLabelClass}>Capacity (liters) *</label>
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
            submitLabel="Save changes"
            busyLabel="Saving…"
          />
        </form>
      </FormDrawer>
    </div>
  );
}
