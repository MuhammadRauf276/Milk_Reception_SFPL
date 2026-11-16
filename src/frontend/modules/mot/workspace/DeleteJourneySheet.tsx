'use client';

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/errors';
import { MotSheet, sheetLabelClass, sheetPrimaryButtonClass } from '../MotSheet';
import { SheetError } from './SheetError';
import { sendJson } from './mutationUtils';
import { MOT_TAB_DATA_KEY, type JourneyItem } from './types';

interface Props {
  journey: JourneyItem;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Super Admin removes a journey assigned by mistake. The server refuses one that carried milk. */
export function DeleteJourneySheet({ journey, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (text: string) =>
      sendJson<{ journeyNumber: string }>(`/api/super-admin/journeys/${journey.id}`, 'DELETE', { reason: text }, 'Could not remove the journey.'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      onDone(`Journey #${journey.journey_number} removed.`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Write why this journey is being removed (at least 3 characters).');
      return;
    }
    setError(null);
    remove.mutate(reason.trim());
  };

  return (
    <MotSheet title="Remove journey" onClose={onClose}>
      <div className="flex items-start gap-2 text-rose-700">
        <Trash2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-xs font-medium text-secondary-foreground">
          Remove journey <strong>#{journey.journey_number}</strong> ({journey.mot_profile?.name}, {journey.mot_vehicle?.vehicle_number}). Only a
          journey with no shop collection can be removed. A copy is kept in the audit log.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="delete-journey-reason" className={sheetLabelClass}>
            Why <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="delete-journey-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example: assigned twice"
            className="min-h-11 w-full rounded-lg border border-border bg-subtle p-3 text-sm font-medium text-foreground focus:ring-2 focus:ring-rose-500"
            rows={3}
            required
          />
        </div>
        <SheetError message={error} />
        <button type="submit" disabled={remove.isPending || !reason.trim()} className={`${sheetPrimaryButtonClass} !bg-rose-600 hover:!bg-rose-700`}>
          {remove.isPending ? 'Removing…' : 'Remove journey'}
        </button>
      </form>
    </MotSheet>
  );
}
