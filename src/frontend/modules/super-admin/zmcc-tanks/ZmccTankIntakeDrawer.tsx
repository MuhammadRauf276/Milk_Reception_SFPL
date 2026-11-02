'use client';

import React, { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Calculator, CheckCircle2, FlaskConical, Milk } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import { FormDrawer, DrawerActions, fieldInputClass, fieldLabelClass } from '../shared/FormDrawer';
import type { TankItem } from '@/frontend/modules/zmcc/master/masterTypes';

interface Props {
  tank: TankItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function ZmccTankIntakeDrawer({ tank, onClose, onSaved }: Props) {
  const [grossLiters, setGrossLiters] = useState<string>('');
  const [fat, setFat] = useState<string>('3.50');
  const [lr, setLr] = useState<string>('28.0');
  const [custom13Ts, setCustom13Ts] = useState<string>('');
  const [useCustom13Ts, setUseCustom13Ts] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('Direct intake by Super Admin - staff unavailable');
  const [error, setError] = useState<string | null>(null);

  // Derived calculations following canonical formulas
  const numGross = parseFloat(grossLiters) || 0;
  const numFat = parseFloat(fat) || 0;
  const numLr = parseFloat(lr) || 0;

  const density = useMemo(() => {
    if (numLr <= 0) return 1.028;
    return Number((1 + numLr / 1000).toFixed(4));
  }, [numLr]);

  const snf = useMemo(() => {
    if (numLr <= 0 && numFat <= 0) return 0;
    return Number((numLr / 4 + 0.22 * numFat + 0.72).toFixed(2));
  }, [numLr, numFat]);

  const ts = useMemo(() => {
    return Number((numFat + snf).toFixed(2));
  }, [numFat, snf]);

  const calculated13Ts = useMemo(() => {
    if (numGross <= 0 || ts <= 0) return 0;
    return Number(((numGross * ts) / 13).toFixed(2));
  }, [numGross, ts]);

  const final13Ts = useCustom13Ts && parseFloat(custom13Ts) > 0
    ? parseFloat(custom13Ts)
    : calculated13Ts;

  const availableCap = tank ? tank.available_capacity : 0;
  const afterStock = tank ? (tank.current_stock + numGross) : numGross;
  const isOverCapacity = tank ? (afterStock > tank.capacity_liters + 0.001) : false;

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/super-admin/zmcc-tanks/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tank) return;
    setError(null);

    if (numGross <= 0) {
      setError('Gross volume must be greater than 0 Liters.');
      return;
    }
    if (isOverCapacity) {
      setError(`Cannot add ${numGross.toFixed(2)} L. Only ${availableCap.toFixed(2)} L free space remaining in tank.`);
      return;
    }
    if (final13Ts <= 0) {
      setError('Valid @13% TS volume could not be determined. Check Fat % and LR, or enter custom @13% TS.');
      return;
    }

    mutation.mutate(
      {
        tank_id: tank.id,
        gross_liters: numGross,
        at_13ts_liters: final13Ts,
        fat: numFat,
        lr: numLr,
        snf,
        ts,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          onSaved(`Added ${numGross.toLocaleString('en-US', { minimumFractionDigits: 2 })} L (${final13Ts.toLocaleString('en-US', { minimumFractionDigits: 2 })} L @13% TS) to tank "${tank.tank_code}".`);
          onClose();
        },
        onError: (err) => {
          setError(getErrorMessage(err) || 'Failed to record stock intake.');
        },
      }
    );
  };

  if (!tank) return null;

  return (
    <FormDrawer
      open={!!tank}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Milk className="h-5 w-5 text-primary shrink-0" />
          <span>Manual Milk Intake · {tank.tank_code} ({tank.tank_name})</span>
        </div>
      }
      busy={mutation.isPending}
      error={error}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Tank State Summary Card */}
        <div className="rounded-xl border border-border bg-subtle p-3.5 space-y-2.5">
          <div className="flex justify-between items-center text-xs font-semibold text-foreground">
            <span>Tank Storage State</span>
            <span className="text-[11px] text-muted-foreground uppercase">{tank.zmcc?.name || 'Assigned ZMCC'}</span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground block uppercase font-medium">Capacity</span>
              <span className="font-bold text-foreground tabular-nums">{tank.capacity_liters.toLocaleString()} L</span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground block uppercase font-medium">Current Stock</span>
              <span className="font-bold text-blue-700 tabular-nums">{tank.current_stock.toLocaleString()} L</span>
            </div>
            <div className="bg-card p-2 rounded-lg border border-border">
              <span className="text-[10px] text-muted-foreground block uppercase font-medium">Available</span>
              <span className="font-bold text-emerald-700 tabular-nums">{availableCap.toLocaleString()} L</span>
            </div>
          </div>

          {tank.current_commercial_stock_at_13ts !== undefined && tank.current_commercial_stock_at_13ts !== null && (
            <div className="text-[11px] text-slate-600 bg-card px-2.5 py-1.5 rounded-lg border border-border flex justify-between items-center">
              <span>Current Commercial Stock (@13% TS):</span>
              <span className="font-semibold tabular-nums text-foreground">{Number(tank.current_commercial_stock_at_13ts).toLocaleString()} L</span>
            </div>
          )}
        </div>

        {/* Input Gross Liters */}
        <div className="space-y-1">
          <label htmlFor="intake-gross-liters" className={fieldLabelClass}>
            Gross Milk Volume to Add (Liters) *
          </label>
          <input
            id="intake-gross-liters"
            type="number"
            step="0.01"
            min="0.01"
            max={availableCap}
            required
            value={grossLiters}
            onChange={(e) => setGrossLiters(e.target.value)}
            placeholder="e.g. 5000"
            className={fieldInputClass}
            disabled={mutation.isPending}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Free space: {availableCap.toLocaleString()} L</span>
            {isOverCapacity && (
              <span className="text-rose-600 font-semibold">Exceeds available capacity!</span>
            )}
          </div>
        </div>

        {/* Quality Parameters Section */}
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <FlaskConical className="h-4 w-4 text-primary shrink-0" />
              <span>Milk Quality &amp; @13% TS Basis</span>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={useCustom13Ts}
                onChange={(e) => setUseCustom13Ts(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
              />
              <span>Manual @13% TS override</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="intake-fat" className={fieldLabelClass}>
                Fat % *
              </label>
              <input
                id="intake-fat"
                type="number"
                step="0.01"
                min="0.1"
                max="15.0"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
                placeholder="3.50"
                className={fieldInputClass}
                disabled={mutation.isPending || useCustom13Ts}
              />
            </div>
            <div>
              <label htmlFor="intake-lr" className={fieldLabelClass}>
                LR (Lactometer Reading) *
              </label>
              <input
                id="intake-lr"
                type="number"
                step="0.1"
                min="10"
                max="40"
                value={lr}
                onChange={(e) => setLr(e.target.value)}
                placeholder="28.0"
                className={fieldInputClass}
                disabled={mutation.isPending || useCustom13Ts}
              />
            </div>
          </div>

          {useCustom13Ts ? (
            <div className="pt-1">
              <label htmlFor="intake-custom-13ts" className={fieldLabelClass}>
                Standardized @13% TS Volume (Liters) *
              </label>
              <input
                id="intake-custom-13ts"
                type="number"
                step="0.01"
                min="0.01"
                value={custom13Ts}
                onChange={(e) => setCustom13Ts(e.target.value)}
                placeholder={calculated13Ts.toFixed(2)}
                className={fieldInputClass}
                disabled={mutation.isPending}
              />
            </div>
          ) : (
            /* Live Calculated Preview */
            <div className="bg-subtle rounded-lg p-2.5 border border-border text-[11px] space-y-1.5">
              <div className="flex items-center justify-between text-muted-foreground font-medium">
                <span>Density: <strong className="text-foreground font-semibold tabular-nums">{density.toFixed(4)}</strong></span>
                <span>SNF: <strong className="text-foreground font-semibold tabular-nums">{snf.toFixed(2)}%</strong></span>
                <span>TS: <strong className="text-foreground font-semibold tabular-nums">{ts.toFixed(2)}%</strong></span>
              </div>
              <div className="border-t border-border pt-1.5 flex justify-between items-center font-semibold text-foreground">
                <span className="flex items-center gap-1">
                  <Calculator className="h-3.5 w-3.5 text-primary" />
                  Calculated @13% TS Volume:
                </span>
                <span className="text-primary tabular-nums text-xs">
                  {calculated13Ts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Notes / Reason */}
        <div className="space-y-1">
          <label htmlFor="intake-notes" className={fieldLabelClass}>
            Reason / Administrative Notes
          </label>
          <input
            id="intake-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Staff unavailable - direct intake by Super Admin"
            className={fieldInputClass}
            disabled={mutation.isPending}
          />
        </div>

        {/* Projected Outcome Preview */}
        {numGross > 0 && !isOverCapacity && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-900 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold block">Projected Tank Stock After Intake</span>
              <span className="text-[11px] text-emerald-800">
                Gross Physical Stock: <strong className="tabular-nums font-semibold">{afterStock.toLocaleString('en-US', { minimumFractionDigits: 2 })} L</strong> ({((afterStock / tank.capacity_liters) * 100).toFixed(1)}% full)
              </span>
            </div>
          </div>
        )}

        <DrawerActions
          busy={mutation.isPending}
          onCancel={onClose}
          submitLabel="Confirm Milk Intake"
          busyLabel="Recording Intake…"
        />
      </form>
    </FormDrawer>
  );
}
