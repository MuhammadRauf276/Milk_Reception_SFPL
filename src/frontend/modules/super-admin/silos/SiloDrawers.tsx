'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { DrawerActions, FormDrawer, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';

export interface Silo {
  id: string;
  siloCode: string;
  siloName: string;
  capacityLiters: number;
  currentStockLiters: number;
  currentStockAt13Ts?: number | null;
  compositeTsPercent?: number | null;
  activeReservationsLiters: number;
  isActive: boolean;
  createdAt: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface FormProps {
  /** null = create */
  silo: Silo | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function SiloFormDrawer({ silo, onClose, onSaved }: FormProps) {
  const isEdit = !!silo;
  const [code, setCode] = useState('');
  const [name, setName] = useState(silo?.siloName || '');
  const [capacity, setCapacity] = useState<number | string>(silo ? silo.capacityLiters : 100000);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<{ silo?: { siloCode?: string } }>(isEdit ? `/api/super-admin/silos/${silo!.id}` : '/api/super-admin/silos', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
  });
  const busy = mutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const capNum = Number(capacity);
    if (!isEdit && !code.trim()) return setError('Silo Code is required.');
    if (!name.trim()) return setError('Silo Name is required.');
    if (isNaN(capNum) || capNum <= 0) return setError('Capacity must be a positive number greater than 0 Liters.');

    mutation.mutate(
      isEdit
        ? { siloName: name.trim(), capacityLiters: capNum }
        : { siloCode: code.trim().toUpperCase(), siloName: name.trim(), capacityLiters: capNum },
      {
        onSuccess: (data) =>
          onSaved(isEdit ? `Silo "${silo!.siloCode}" updated successfully.` : `Silo "${data.silo?.siloCode || code}" created successfully.`),
        onError: (err) => setError(getErrorMessage(err)),
      }
    );
  };

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title={isEdit ? `Edit Silo (${silo!.siloCode})` : 'Add Silo Storage'}>
      {isEdit && (
        <div className="space-y-1 rounded-xl border border-border bg-card p-3 font-medium text-blue-950">
          <div className="flex justify-between">
            <span>Current Stock:</span>
            <strong>{silo!.currentStockLiters.toLocaleString()} L</strong>
          </div>
          <div className="flex justify-between">
            <span>Active Reservations:</span>
            <strong>{silo!.activeReservationsLiters.toLocaleString()} L</strong>
          </div>
          <div className="flex justify-between border-t border-blue-200/60 pt-1">
            <span>Minimum Allowed Capacity:</span>
            <strong className="text-blue-900">{(silo!.currentStockLiters + silo!.activeReservationsLiters).toLocaleString()} L</strong>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3.5">
        {!isEdit && (
          <div>
            <label htmlFor="create-silo-code" className={fieldLabelClass}>
              Silo Code <span className="text-rose-600">*</span>
            </label>
            <input
              id="create-silo-code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${fieldInputClass} uppercase tabular-nums`}
              placeholder="e.g. SILO-05"
              disabled={busy}
            />
          </div>
        )}
        <div>
          <label htmlFor="silo-name" className={fieldLabelClass}>
            Silo Name <span className="text-rose-600">*</span>
          </label>
          <input
            id="silo-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldInputClass}
            placeholder="e.g. Storage Silo Tank 05"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="silo-capacity" className={fieldLabelClass}>
            {isEdit ? 'Capacity (Liters)' : 'Total Capacity (Liters)'} <span className="text-rose-600">*</span>
          </label>
          <input
            id="silo-capacity"
            type="number"
            required
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={`${fieldInputClass} tabular-nums`}
            disabled={busy}
          />
        </div>
        <DrawerActions
          busy={busy}
          onCancel={onClose}
          submitLabel={isEdit ? 'Update Silo' : 'Save Silo'}
          busyLabel={isEdit ? 'Updating…' : 'Saving…'}
        />
      </form>
    </FormDrawer>
  );
}

export function SiloDeactivateDrawer({ silo, onClose, onSaved }: { silo: Silo; onClose: () => void; onSaved: (m: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/super-admin/silos/${silo.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ isActive: false }) }),
    onSuccess: () => onSaved(`Silo "${silo.siloCode}" deactivated successfully.`),
    onError: (err) => setError(getErrorMessage(err)),
  });
  const busy = mutation.isPending;

  return (
    <FormDrawer open onClose={onClose} busy={busy} error={error} title="Deactivate Silo Storage">
      <div className="flex items-center gap-3 text-rose-700">
        <div className="shrink-0 rounded-xl bg-rose-100 p-2.5">
          <AlertTriangle className="h-5 w-5 text-rose-700" />
        </div>
        <p className="leading-relaxed text-slate-600">
          Are you sure you want to deactivate silo <strong className="tabular-nums text-foreground">{silo.siloCode}</strong> ({silo.siloName})?
        </p>
      </div>
      <ul className="list-disc space-y-1 rounded-xl border border-border bg-card p-3 pl-7 text-amber-900">
        <li>The silo will be removed from operational selection immediately.</li>
        <li>Deactivation is blocked if the silo contains milk stock or active unloadings.</li>
      </ul>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-11 px-5"
          disabled={busy}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          {busy ? 'Deactivating…' : 'Confirm Deactivate'}
        </Button>
      </div>
    </FormDrawer>
  );
}
