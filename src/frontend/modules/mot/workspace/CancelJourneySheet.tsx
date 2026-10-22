'use client';

import React, { useState } from 'react';
import { Ban } from 'lucide-react';
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

export function CancelJourneySheet({ journey, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancelMutation = useMutation({
    mutationFn: (text: string) =>
      sendJson(`/api/zmcc/mot/journeys/${journey.id}/cancel`, 'POST', { reason: text }, 'Failed to cancel journey.'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MOT_TAB_DATA_KEY });
      onDone(`Journey #${journey.journey_number} cancelled successfully.`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || reason.trim().length < 3) {
      setError('Cancellation reason must be at least 3 characters.');
      return;
    }
    setError(null);
    cancelMutation.mutate(reason.trim());
  };

  return (
    <MotSheet title="Cancel Collection Journey" onClose={onClose}>
      <div className="flex items-start gap-2 text-rose-700">
        <Ban className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-xs font-medium text-slate-600">
          You are cancelling active Journey <strong>#{journey.journey_number}</strong>. This operation is authoritative and cannot be undone.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="cancel-reason" className={sheetLabelClass}>
            Reason for Cancellation <span className="text-rose-600">*</span>
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Mechanical breakdown, road blockage, vehicle swap required…"
            className="w-full rounded-xl border border-border bg-subtle p-3 text-sm font-medium text-foreground focus:ring-2 focus:ring-rose-500"
            rows={3}
            required
          />
        </div>
        <SheetError message={error} />
        <button
          type="submit"
          disabled={cancelMutation.isPending || !reason.trim()}
          className={`${sheetPrimaryButtonClass} !bg-rose-600 hover:!bg-rose-700`}
        >
          {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancellation'}
        </button>
      </form>
    </MotSheet>
  );
}
