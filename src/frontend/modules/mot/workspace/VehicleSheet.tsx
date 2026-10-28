'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Combobox } from '@/components/ui/combobox';
import { getErrorMessage } from '@/lib/errors';
import { MotSheet, sheetInputClass, sheetLabelClass, sheetPrimaryButtonClass } from '../MotSheet';
import { SheetError } from './SheetError';
import { sendJson } from './mutationUtils';
import { MOT_TAB_DATA_KEY, type MotVehicleItem, type ZmccSource } from './types';

interface Props {
  editing: MotVehicleItem | null;
  defaultZmccId: string | null;
  isCentralRole: boolean;
  /** ZMCCs the vehicle can be registered to (shown when a new vehicle is added by a central role). */
  sources?: ZmccSource[];
  onClose: () => void;
  onDone: (message: string) => void;
}

export function VehicleSheet({ editing, defaultZmccId, isCentralRole, sources = [], onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    vehicle_number: editing?.vehicle_number ?? '',
    zmcc_id: editing?.zmcc_id ?? defaultZmccId ?? '',
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      sendJson(
        editing ? `/api/zmcc/mot/vehicles/${editing.id}` : '/api/zmcc/mot/vehicles',
        editing ? 'PATCH' : 'POST',
        { ...form, zmcc_id: isCentralRole ? form.zmcc_id || defaultZmccId : defaultZmccId },
        'Failed to save Mobile Tester Vehicle.'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      onDone(editing ? 'Mobile Tester Vehicle updated successfully.' : 'Mobile Tester Vehicle created successfully.');
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <MotSheet title={editing ? 'Edit Mobile Tester Vehicle' : 'New Mobile Tester Vehicle'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          saveMutation.mutate();
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="vehicle-number" className={sheetLabelClass}>Vehicle Registration # *</label>
          <input
            id="vehicle-number"
            type="text"
            value={form.vehicle_number}
            onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
            placeholder="e.g. LES-1234"
            className={`${sheetInputClass} tabular-nums`}
            required
          />
        </div>
        {isCentralRole && !editing ? (
          <div>
            <label className={sheetLabelClass}>Home ZMCC *</label>
            <Combobox
              className="min-h-[44px]"
              value={form.zmcc_id}
              onValueChange={(v) => setForm({ ...form, zmcc_id: v })}
              placeholder="Select ZMCC"
              searchPlaceholder="Search ZMCC"
              options={sources.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}`, keywords: `${s.code} ${s.name}` }))}
            />
          </div>
        ) : null}
        <SheetError message={error} />
        <button type="submit" disabled={saveMutation.isPending || (isCentralRole && !editing && !form.zmcc_id)} className={sheetPrimaryButtonClass}>
          {saveMutation.isPending ? 'Saving…' : 'Save Vehicle'}
        </button>
      </form>
    </MotSheet>
  );
}
