'use client';

import React, { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Scale, Warehouse } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { getErrorMessage } from '@/lib/errors';
import {
  ZmccDrawer,
  ZmccErrorBanner,
  zmccGhostBtn,
  zmccInputClass,
  zmccLabelClass,
  zmccPrimaryBtn,
} from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import type {
  WeighingSessionView,
  WeighingSourceView,
  WeighingTankView,
} from '@/backend/services/zmccTankService';

export type WeighingPolicyView = { manual_entry_enabled: boolean; allowed_units: 'KG' | 'LITER' | 'BOTH' };
type Mode = 'WEIGHT' | 'MANUAL';
type Unit = 'KG' | 'LITER';

interface Props {
  session: WeighingSessionView;
  tanks: WeighingTankView[];
  sources: WeighingSourceView[];
  policy: WeighingPolicyView;
  onClose: () => void;
  onChanged: (message: string) => void;
}

const toNum = (v: string): number | null => {
  const n = Number(v.trim());
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

export const WeighingEntryDrawer: React.FC<Props> = ({ session, tanks, sources, policy, onClose, onChanged }) => {
  const myTanks = useMemo(() => tanks.filter((t) => t.zmcc_id === session.zmcc_id), [tanks, session.zmcc_id]);
  const mySources = useMemo(() => sources.filter((s) => s.zmcc_id === session.zmcc_id), [sources, session.zmcc_id]);
  const portions = session.portions;
  const n = portions.length;

  const manualAllowed = policy.manual_entry_enabled;
  const units: Unit[] = policy.allowed_units === 'BOTH' ? ['KG', 'LITER'] : [policy.allowed_units];

  const [mode, setMode] = useState<Mode>(session.mode === 'MANUAL' && manualAllowed ? 'MANUAL' : 'WEIGHT');
  const [weights, setWeights] = useState<string[]>(() =>
    Array.from({ length: n + 1 }, (_v, i) => (session.weights_kg ? String(session.weights_kg[i] ?? '') : ''))
  );
  const [manual, setManual] = useState<Array<{ value: string; unit: Unit }>>(() =>
    portions.map((p) => ({
      value: session.mode === 'MANUAL' && p.net_value !== null ? String(p.net_value) : '',
      unit: (session.mode === 'MANUAL' && p.net_unit ? p.net_unit : units[0]) as Unit,
    }))
  );
  const [tankId, setTankId] = useState(myTanks.length === 1 ? myTanks[0].id : '');
  const [sourceId, setSourceId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Live NET per portion (the only figure shown).
  const liveNets: Array<number | null> = useMemo(() => {
    if (mode === 'MANUAL') return manual.map((m) => toNum(m.value));
    return portions.map((_p, i) => {
      const a = toNum(weights[i] ?? '');
      const b = toNum(weights[i + 1] ?? '');
      return a !== null && b !== null && a > b && b > 0 ? Number((a - b).toFixed(3)) : null;
    });
  }, [mode, manual, weights, portions]);

  const weightsInvalid =
    mode === 'WEIGHT' &&
    weights.some((w, i) => {
      if (i === 0) return false;
      const a = toNum(weights[i - 1]);
      const b = toNum(w);
      return a !== null && b !== null && b >= a;
    });
  const complete = liveNets.length > 0 && liveNets.every((v) => v !== null && v > 0) && !weightsInvalid;
  const unloadReady = complete && (myTanks.length <= 1 || tankId !== '') && (!session.needs_source || sourceId !== '');

  const buildBody = () =>
    mode === 'WEIGHT'
      ? { mode, weights_kg: weights.map((w) => Number(w)) }
      : {
          mode,
          values: portions.map((p, i) => ({ portion_id: p.id, value: Number(manual[i].value), unit: manual[i].unit })),
        };

  const saveMutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/zmcc/weighing/sessions/${session.session_id}/values`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      }),
  });
  const unloadMutation = useMutation({
    mutationFn: () =>
      fetchJson<{ journey_closed?: boolean }>(`/api/zmcc/weighing/sessions/${session.session_id}/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tank_id: tankId || undefined, milk_source_id: session.needs_source ? sourceId : undefined }),
      }),
  });
  const busy = saveMutation.isPending || unloadMutation.isPending;

  const onSave = async () => {
    setError(null);
    try {
      await saveMutation.mutateAsync();
      onChanged('Values saved. Nothing is in the tank yet. Tap "Unload to ZMCC tank" when the milk is poured.');
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save. Please try again.');
    }
  };
  const onUnload = async () => {
    setError(null);
    try {
      await saveMutation.mutateAsync();
      await unloadMutation.mutateAsync();
      onChanged('Milk unloaded to the tank.');
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not unload. Please try again.');
    }
  };

  const weightLabel = (i: number) => (i === 0 ? 'Vehicle weight before unloading (kg)' : `Vehicle weight after ${portions[i - 1].label} (kg)`);

  return (
    <ZmccDrawer
      open
      onClose={onClose}
      title={`${session.vehicle_number || 'Vehicle'} - ${session.source_type}`}
      subtitle={
        <>
          {session.source_name || ''}
          {session.zmcc_token ? ` - Token ${session.zmcc_token}` : ''}
        </>
      }
      icon={<Scale className="mt-0.5 h-5 w-5 text-slate-600" />}
    >
      {manualAllowed && (
        <div role="group" aria-label="Entry mode" className="grid grid-cols-2 gap-2">
          {(['WEIGHT', 'MANUAL'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={busy}
              onClick={() => setMode(m)}
              className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold ${
                mode === m ? 'border-primary bg-primary text-white' : 'bg-white text-slate-700'
              }`}
            >
              {m === 'WEIGHT' ? 'Weigh on scale' : 'Type quantity'}
            </button>
          ))}
        </div>
      )}

      {mode === 'WEIGHT' ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Weigh the vehicle {n + 1} times: first before unloading, then after each portion. Each weight must be less
            than the one before.
          </p>
          {weights.map((w, i) => (
            <div key={i}>
              <label className={zmccLabelClass} htmlFor={`w-${i}`}>
                {weightLabel(i)}
              </label>
              <input
                id={`w-${i}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={w}
                disabled={busy}
                onChange={(e) => setWeights((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                className={zmccInputClass}
              />
              {i > 0 && (
                <p className="mt-1 text-xs font-semibold text-emerald-800">
                  {portions[i - 1].label} net: {liveNets[i - 1] !== null ? `${liveNets[i - 1]} kg` : '-'}
                </p>
              )}
            </div>
          ))}
          {weightsInvalid && <ZmccErrorBanner message="A weight is not less than the one before it. Please check." />}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Type the net milk quantity of each portion.</p>
          {portions.map((p, i) => (
            <div key={p.id}>
              <label className={zmccLabelClass} htmlFor={`m-${p.id}`}>
                {p.label} net quantity
              </label>
              <div className="flex gap-2">
                <input
                  id={`m-${p.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={manual[i].value}
                  disabled={busy}
                  onChange={(e) => setManual((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  className={zmccInputClass}
                />
                <select
                  aria-label={`${p.label} unit`}
                  value={manual[i].unit}
                  disabled={busy || units.length === 1}
                  onChange={(e) =>
                    setManual((prev) => prev.map((x, j) => (j === i ? { ...x, unit: e.target.value as Unit } : x)))
                  }
                  className="min-h-[44px] w-28 rounded-xl border bg-white px-3 text-sm font-semibold"
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u === 'KG' ? 'kg' : 'litre'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        {myTanks.length > 1 && (
          <div>
            <label className={zmccLabelClass} htmlFor="unload-tank">
              Tank
            </label>
            <select
              id="unload-tank"
              value={tankId}
              disabled={busy}
              onChange={(e) => setTankId(e.target.value)}
              className={`${zmccInputClass} bg-white`}
            >
              <option value="">Choose tank</option>
              {myTanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tank_code} - {Math.round(t.available_capacity)} L free
                </option>
              ))}
            </select>
          </div>
        )}
        {myTanks.length === 1 && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Warehouse className="h-4 w-4" /> Tank {myTanks[0].tank_code}
          </p>
        )}
        {myTanks.length === 0 && <ZmccErrorBanner message="No active tank is set up for this ZMCC." />}

        {session.needs_source && (
          <div>
            <label className={zmccLabelClass} htmlFor="unload-source">
              Milk source
            </label>
            <select
              id="unload-source"
              value={sourceId}
              disabled={busy}
              onChange={(e) => setSourceId(e.target.value)}
              className={`${zmccInputClass} bg-white`}
            >
              <option value="">Choose milk source</option>
              {mySources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {mySources.length === 0 && (
              <p className="mt-1 text-xs text-rose-700">No milk source is assigned to this ZMCC. Ask the MPD Head.</p>
            )}
          </div>
        )}

        <ZmccErrorBanner message={error} />

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" className={zmccPrimaryBtn} disabled={busy || !unloadReady || myTanks.length === 0} onClick={() => void onUnload()}>
            {unloadMutation.isPending ? (
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            ) : (
              <Warehouse className="mr-2 inline h-4 w-4" />
            )}
            Unload to ZMCC tank
          </button>
          <button type="button" className={zmccGhostBtn} disabled={busy || !complete} onClick={() => void onSave()}>
            {saveMutation.isPending && !unloadMutation.isPending ? 'Saving…' : 'Save values only'}
          </button>
        </div>
      </div>
    </ZmccDrawer>
  );
};

export default WeighingEntryDrawer;
