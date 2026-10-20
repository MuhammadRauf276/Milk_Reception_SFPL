'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Scale, Truck, Warehouse } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import type { WeighingPortionView, WeighingTankView, WeighingStep } from '@/backend/services/zmccTankService';

const STEP_LABEL: Record<WeighingStep, string> = {
  FIRST_WEIGHT: 'Step 1: Full vehicle weight',
  TANK: 'Step 2: Choose tank',
  SECOND_WEIGHT: 'Step 3: Empty vehicle weight',
  DONE: 'Done',
};

const bigButton =
  'flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-base font-bold text-white disabled:opacity-50';

function StatusBadge({ step }: { step: WeighingStep }) {
  if (step === 'DONE') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-bold text-emerald-800">
        <CheckCircle2 className="h-4 w-4" /> Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-800">
      <Clock className="h-4 w-4" /> Waiting
    </span>
  );
}

function PortionCard({
  item,
  tanks,
  onChanged,
}: {
  item: WeighingPortionView;
  tanks: WeighingTankView[];
  onChanged: (message?: string) => void;
}) {
  const myTanks = tanks.filter((t) => t.zmcc_id === item.zmcc_id);
  const [weight, setWeight] = useState('');
  const [tankId, setTankId] = useState(myTanks.length === 1 ? myTanks[0].id : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (path: string, body: Record<string, unknown>, doneMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/weighing/portions/${item.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save. Please try again.');
      setWeight('');
      onChanged(data.journey_closed ? 'Saved. The journey is closed.' : doneMessage);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const isWeightStep = item.step === 'FIRST_WEIGHT' || item.step === 'SECOND_WEIGHT';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Truck className="h-5 w-5 text-slate-600" />
          {item.vehicle_number || 'Vehicle'} - Portion {item.portion_number}
        </div>
        <StatusBadge step={item.step} />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {item.source_type === 'MOT' ? 'Area milk' : 'Local supplier milk'}
        {item.source_name ? ` - ${item.source_name}` : ''}
        {item.zmcc_token ? ` - Token ${item.zmcc_token}` : ''}
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-slate-500">Full vehicle</dt>
          <dd className="font-bold text-slate-900">{item.first_weight_kg !== null ? `${item.first_weight_kg} kg` : '-'}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-slate-500">Empty vehicle</dt>
          <dd className="font-bold text-slate-900">{item.second_weight_kg !== null ? `${item.second_weight_kg} kg` : '-'}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <dt className="text-slate-500">Net milk</dt>
          <dd className="font-bold text-slate-900">{item.net_weight_kg !== null ? `${item.net_weight_kg} kg` : '-'}</dd>
        </div>
      </dl>
      {item.tank_code && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Warehouse className="h-4 w-4" /> Tank {item.tank_code}
        </p>
      )}

      {item.step !== 'DONE' && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">{STEP_LABEL[item.step]}</p>

          {isWeightStep && (
            <>
              <label className="block text-sm font-semibold text-slate-700" htmlFor={`w-${item.id}`}>
                Weight (kg)
              </label>
              <input
                id={`w-${item.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-xl font-bold text-slate-900"
              />
              <button
                type="button"
                className={bigButton}
                disabled={busy || !weight}
                onClick={() =>
                  post(
                    item.step === 'FIRST_WEIGHT' ? 'first-weight' : 'second-weight',
                    { weight_kg: weight },
                    item.step === 'FIRST_WEIGHT' ? 'First weight saved.' : 'Second weight saved. Milk is in the tank.'
                  )
                }
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Scale className="h-5 w-5" />}
                {item.step === 'FIRST_WEIGHT' ? 'Save full vehicle weight' : 'Save empty vehicle weight'}
              </button>
            </>
          )}

          {item.step === 'TANK' && (
            <>
              <label className="block text-sm font-semibold text-slate-700" htmlFor={`t-${item.id}`}>
                Tank
              </label>
              <select
                id={`t-${item.id}`}
                value={tankId}
                onChange={(e) => setTankId(e.target.value)}
                className="h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-900"
              >
                <option value="">Choose tank</option>
                {myTanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tank_code} - {Math.round(t.available_capacity)} L free
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={bigButton}
                disabled={busy || !tankId}
                onClick={() => post('tank', { tank_id: tankId }, 'Tank saved. Pour the milk, then weigh the empty vehicle.')}
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Warehouse className="h-5 w-5" />}
                Save tank
              </button>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">
              Problem: {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const ZmccWeighingWorkspace: React.FC = () => {
  const [items, setItems] = useState<WeighingPortionView[]>([]);
  const [tanks, setTanks] = useState<WeighingTankView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/zmcc/weighing/queue');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the list.');
      setItems(data.items || []);
      setTanks(data.tanks || []);
    } catch (err) {
      setError(getErrorMessage(err) || 'Could not load the list.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const waiting = items.filter((i) => i.step !== 'DONE');
  const done = items.filter((i) => i.step === 'DONE');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Weigh milk</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="h-11 min-w-[44px] rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800"
        >
          Refresh
        </button>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">
          Problem: {error}
        </p>
      )}
      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </p>
      )}
      {!loading && waiting.length === 0 && <p className="text-sm text-slate-600">No accepted milk is waiting to be weighed.</p>}
      {waiting.map((item) => (
        <PortionCard
          key={item.id}
          item={item}
          tanks={tanks}
          onChanged={(m) => {
            setNotice(m || null);
            void load();
          }}
        />
      ))}
      {done.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-700">Done in the last 24 hours</h3>
          {done.map((item) => (
            <PortionCard key={item.id} item={item} tanks={tanks} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ZmccWeighingWorkspace;
