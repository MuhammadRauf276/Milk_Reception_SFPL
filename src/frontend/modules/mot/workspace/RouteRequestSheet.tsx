'use client';

import { useLocalFormDraft } from '@/frontend/hooks/useLocalFormDraft';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/errors';
import { MotSheet, sheetInputClass, sheetLabelClass, sheetPrimaryButtonClass } from '../MotSheet';
import { SheetError } from './SheetError';
import { sendJson } from './mutationUtils';
import { MOT_TAB_DATA_KEY } from './types';

interface Props {
  zmccId: string | null;
  needsZonalApproval: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function RouteRequestSheet({ zmccId, needsZonalApproval, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', origin: '', destination: '', initial_area_name: '', description: '' });
  const formDraft = useLocalFormDraft({
    formKey: `route-request:${zmccId ?? 'none'}`,
    values: form,
    onRestore: (fields) => setForm((prev) => ({ ...prev, ...fields })),
  });

  const requestMutation = useMutation({
    mutationFn: () =>
      sendJson(
        '/api/zmcc/routes',
        'POST',
        {
          zmcc_id: zmccId,
          name: form.name.trim(),
          origin: form.origin.trim() || undefined,
          destination: form.destination.trim() || undefined,
          initial_area_name: form.initial_area_name.trim() || undefined,
          description: form.description.trim() || undefined,
        },
        'Failed to request route.'
      ),
    onSuccess: () => {
      formDraft.clear();
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      onDone(
        needsZonalApproval
          ? 'Route sent to Zonal Manager. It can be used after it is approved.'
          : 'Route created successfully.'
      );
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const text = (
    key: 'name' | 'origin' | 'destination' | 'initial_area_name',
    label: string,
    placeholder: string,
    required = false
  ) => (
    <div className="min-w-0">
      <label htmlFor={`route-${key}`} className={sheetLabelClass}>{label}</label>
      <input
        id={`route-${key}`}
        type="text"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className={sheetInputClass}
        required={required}
      />
    </div>
  );

  return (
    <MotSheet title={needsZonalApproval ? 'Send route to Zonal Manager' : 'Create New Collection Route'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) {
            setError('Route name is required.');
            return;
          }
          setError(null);
          requestMutation.mutate();
        }}
        className="space-y-3"
      >
        {text('name', 'Route Name *', 'e.g. Sahiwal North Route', true)}
        <div className="grid grid-cols-2 gap-2">
          {text('origin', 'Origin Point', 'e.g. ZMCC Center')}
          {text('destination', 'Destination', 'e.g. Chichawatni')}
        </div>
        {text('initial_area_name', 'First Area Name (Optional)', 'e.g. Chak 90/9L')}
        <div>
          <label htmlFor="route-description" className={sheetLabelClass}>Description / Notes</label>
          <textarea
            id="route-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Notes"
            rows={2}
            className="min-h-11 w-full rounded-xl border border-border bg-subtle p-3 text-sm font-semibold"
          />
        </div>
        <SheetError message={error} />
        <button type="submit" disabled={requestMutation.isPending} className={sheetPrimaryButtonClass}>
          {requestMutation.isPending ? 'Sending…' : needsZonalApproval ? 'Send route to Zonal Manager' : 'Create Route'}
        </button>
      </form>
    </MotSheet>
  );
}
