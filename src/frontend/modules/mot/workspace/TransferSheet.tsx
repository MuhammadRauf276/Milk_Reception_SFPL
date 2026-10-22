'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Combobox } from '@/components/ui/combobox';
import { getErrorMessage } from '@/lib/errors';
import { MotSheet, sheetLabelClass, sheetPrimaryButtonClass } from '../MotSheet';
import { SheetError } from './SheetError';
import { sendJson } from './mutationUtils';
import { MOT_TAB_DATA_KEY, type MotVehicleItem, type ZmccSource } from './types';

interface Props {
  vehicle: MotVehicleItem;
  sources: ZmccSource[];
  onClose: () => void;
  onDone: (message: string) => void;
}

export function TransferSheet({ vehicle, sources, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [targetZmccId, setTargetZmccId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const transferMutation = useMutation({
    mutationFn: (target: string) =>
      sendJson<{ vehicle?: { zmcc?: { name?: string } } }>(
        `/api/zmcc/mot/vehicles/${vehicle.id}/transfer`,
        'POST',
        { target_zmcc_id: target },
        'Failed to transfer vehicle.'
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      onDone(`Vehicle ${vehicle.vehicle_number} transferred successfully to ${data.vehicle?.zmcc?.name || 'target ZMCC'}.`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <MotSheet title="Transfer Vehicle across ZMCCs" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Transferring vehicle <strong className="text-foreground">{vehicle.vehicle_number}</strong> from current center{' '}
        <strong className="text-foreground">{vehicle.zmcc?.name}</strong>.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!targetZmccId) return;
          setError(null);
          transferMutation.mutate(targetZmccId);
        }}
        className="space-y-3"
      >
        <div>
          <label className={sheetLabelClass}>Target ZMCC Center *</label>
          <Combobox
            className="min-h-[44px]"
            value={targetZmccId}
            onValueChange={setTargetZmccId}
            placeholder="Select destination ZMCC"
            searchPlaceholder="Search ZMCC"
            options={sources
              .filter((s) => s.id !== vehicle.zmcc_id)
              .map((s) => ({ value: s.id, label: `${s.code} · ${s.name}`, keywords: `${s.code} ${s.name}` }))}
          />
        </div>
        <SheetError message={error} />
        <button type="submit" disabled={transferMutation.isPending || !targetZmccId} className={sheetPrimaryButtonClass}>
          {transferMutation.isPending ? 'Transferring…' : 'Confirm Transfer'}
        </button>
      </form>
    </MotSheet>
  );
}
