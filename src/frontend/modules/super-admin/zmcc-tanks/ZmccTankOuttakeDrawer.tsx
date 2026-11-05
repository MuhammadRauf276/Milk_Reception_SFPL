'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Milk } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { FormDrawer, DrawerActions, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';
import type { TankItem } from '@/frontend/modules/zmcc/master/masterTypes';

interface Props {
  tank: TankItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Super Admin takes milk out of a tank. @13% TS leaves in proportion to what is in the tank. */
export function ZmccTankOuttakeDrawer({ tank, onClose, onSaved }: Props) {
  const [grossLiters, setGrossLiters] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stock = tank?.current_stock ?? 0;
  const stockAt13 = tank?.current_commercial_stock_at_13ts ?? 0;
  const gross = parseFloat(grossLiters) || 0;
  const at13Out = stock > 0 ? Math.min(stockAt13, (stockAt13 * gross) / stock) : 0;
  const tooMuch = gross > stock + 0.001;

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/super-admin/zmcc-tanks/outtake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });

  const close = () => {
    setGrossLiters('');
    setReason('');
    setError(null);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tank) return;
    setError(null);
    if (gross <= 0) return setError('Gross volume must be greater than 0 Liters.');
    if (tooMuch) return setError(`Only ${stock.toFixed(2)} L is in this tank.`);
    if (reason.trim().length < 3) return setError('Please write why this milk is taken out.');
    mutation.mutate(
      { tank_id: tank.id, gross_liters: gross, reason: reason.trim() },
      {
        onSuccess: () => {
          onSaved(`Took ${gross.toLocaleString('en-US', { minimumFractionDigits: 2 })} L out of ${tank.tank_code}.`);
          close();
        },
        onError: (err) => setError(getErrorMessage(err) || 'Failed to record the outtake.'),
      }
    );
  };

  if (!tank) return null;

  return (
    <FormDrawer
      open
      onClose={close}
      title={
        <div className="flex items-center gap-2 min-w-0">
          <Milk className="h-5 w-5 text-primary shrink-0" />
          <span className="truncate text-sm sm:text-base">Milk Outtake · {tank.tank_code}</span>
        </div>
      }
      busy={mutation.isPending}
      error={error}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-subtle p-3 text-sm">
        <div>
          <p className="text-xs text-slate-500">In tank (gross)</p>
          <p className="font-semibold tabular-nums">{stock.toLocaleString('en-US', { minimumFractionDigits: 2 })} L</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">In tank (@13% TS)</p>
          <p className="font-semibold tabular-nums">{stockAt13.toLocaleString('en-US', { minimumFractionDigits: 2 })} L</p>
        </div>
      </div>
      <div>
        <label htmlFor="outtake-gross" className={fieldLabelClass}>
          Gross Milk to Take Out (Liters) <span className="text-rose-600">*</span>
        </label>
        <input
          id="outtake-gross"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={grossLiters}
          onChange={(e) => setGrossLiters(e.target.value)}
          className={fieldInputClass}
          placeholder="e.g. 500"
        />
      </div>
      {gross > 0 && !tooMuch && (
        <p className="text-sm text-slate-700">
          @13% TS going out: <strong className="tabular-nums">{at13Out.toFixed(2)} L</strong>. Left in tank:{' '}
          <strong className="tabular-nums">{(stock - gross).toFixed(2)} L</strong> gross.
        </p>
      )}
      <div>
        <label htmlFor="outtake-reason" className={fieldLabelClass}>
          Reason <span className="text-rose-600">*</span>
        </label>
        <textarea
          id="outtake-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={fieldInputClass}
          placeholder="Why is this milk taken out?"
        />
      </div>
        <DrawerActions
          busy={mutation.isPending}
          onCancel={close}
          submitLabel="Take Milk Out"
          busyLabel="Recording Outtake…"
        />
      </form>
    </FormDrawer>
  );
}
