'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ZmccDrawer } from '@/frontend/modules/zmcc/shared/ZmccDrawer';
import { correctedPortionFigures } from '@/backend/services/zmcc/labPortionCorrectionCalc';
import { formatNumber } from '@/lib/format';

type PortionRow = {
  id: string;
  portionNumber: number;
  status: string;
  finalDecision: string;
  reviewStatus: string;
  lr: number | null;
  fat: number | null;
  netWeightKg: number | null;
  grossLiters: number | null;
  at13tsLiters: number | null;
  version: number;
};

export interface PortionCorrectionDrawerProps {
  open: boolean;
  sessionId: string | null;
  subtitleLabel?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const INPUT = 'min-h-11 w-full rounded-lg border border-border-strong p-3 text-sm tabular-nums focus:outline-hidden focus:ring-2 focus:ring-primary';

function Figure({ label, before, after, unit }: { label: string; before: number | null; after: number | null; unit: string }) {
  const changed = before !== after;
  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="font-mono text-xs tabular-nums text-muted-foreground">Now {before === null ? '—' : `${formatNumber(before)} ${unit}`}</p>
      <p className={`font-mono text-sm font-semibold tabular-nums ${changed ? 'text-foreground' : 'text-secondary-foreground'}`}>
        New {after === null ? '—' : `${formatNumber(after)} ${unit}`}
      </p>
    </div>
  );
}

/** Correct LR, Fat or net weight of one portion. The tank, receipt and route loss follow on the server. */
export function PortionCorrectionDrawer({ open, sessionId, subtitleLabel, onClose, onSaved }: PortionCorrectionDrawerProps) {
  const [portions, setPortions] = useState<PortionRow[]>([]);
  const [portionId, setPortionId] = useState('');
  const [lr, setLr] = useState('');
  const [fat, setFat] = useState('');
  const [net, setNet] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => `portion-correction-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const selected = useMemo(() => portions.find((p) => p.id === portionId) ?? null, [portions, portionId]);

  const fillFrom = (p: PortionRow | undefined) => {
    setPortionId(p?.id ?? '');
    setLr(p?.lr != null ? String(p.lr) : '');
    setFat(p?.fat != null ? String(p.fat) : '');
    setNet(p?.netWeightKg != null ? String(p.netWeightKg) : '');
  };

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setReason('');
      try {
        const res = await fetch(`/api/zmcc/lab/sessions/${sessionId}/portions`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || 'Could not load the portions.');
        const rows: PortionRow[] = body.portions ?? [];
        setPortions(rows);
        fillFrom(rows.find((p) => p.finalDecision !== 'PENDING') ?? rows[0]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the portions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const lrNumber = lr.trim() === '' ? null : Number(lr);
  const fatNumber = fat.trim() === '' ? null : Number(fat);
  const netNumber = net.trim() === '' ? null : Number(net);
  const preview = lrNumber !== null && fatNumber !== null ? correctedPortionFigures({ netWeightKg: netNumber, lr: lrNumber, fat: fatNumber }) : null;
  const isChanged = !!selected && (lrNumber !== selected.lr || fatNumber !== selected.fat || netNumber !== selected.netWeightKg);
  const isWaiting = !!selected && (selected.finalDecision === 'PENDING' || selected.reviewStatus === 'PENDING');

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/zmcc/lab/portions/${selected.id}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          version: selected.version,
          lr: lrNumber !== selected.lr ? lrNumber : undefined,
          fat: fatNumber !== selected.fat ? fatNumber : undefined,
          net_weight_kg: netNumber !== selected.netWeightKg ? netNumber : undefined,
          idempotency_key: `${idempotencyKey}-${selected.id}-${selected.version}`,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save the correction.');
      onSaved(body.outsideLimits ? 'Correction saved. A value is outside the limits, so the Zonal Manager was told.' : 'Correction saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the correction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ZmccDrawer
      open={open}
      onClose={onClose}
      title="Correct lab record"
      icon={<ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" aria-hidden="true" />}
      subtitle={subtitleLabel}
    >
      <p className="rounded-xl border border-border bg-card p-3 text-xs text-secondary-foreground">
        The tank, receipt and route loss update with this correction. Every change is recorded.
      </p>

      {loading ? <p className="text-xs text-muted-foreground">Loading portions…</p> : null}

      {portions.length > 1 ? (
        <div>
          <label htmlFor="correct-portion" className="mb-1 block text-xs font-semibold text-foreground">Portion</label>
          <select id="correct-portion" value={portionId} onChange={(e) => fillFrom(portions.find((p) => p.id === e.target.value))} className={INPUT}>
            {portions.map((p) => (
              <option key={p.id} value={p.id}>Portion {p.portionNumber}: {p.finalDecision === 'REJECTED' ? 'rejected' : p.finalDecision === 'PENDING' ? 'waiting' : 'accepted'}</option>
            ))}
          </select>
        </div>
      ) : null}

      {selected ? (
        <>
          {isWaiting ? <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">This portion is waiting for a decision. Correct it after the decision.</p> : null}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="correct-lr" className="mb-1 block text-xs font-semibold text-foreground">LR</label>
              <input id="correct-lr" type="number" inputMode="decimal" step="0.01" min="0" value={lr} onChange={(e) => setLr(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="correct-fat" className="mb-1 block text-xs font-semibold text-foreground">Fat %</label>
              <input id="correct-fat" type="number" inputMode="decimal" step="0.01" min="0" value={fat} onChange={(e) => setFat(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="correct-net" className="mb-1 block text-xs font-semibold text-foreground">Net weight (kg)</label>
              <input id="correct-net" type="number" inputMode="decimal" step="0.001" min="0" value={net} disabled={selected.netWeightKg === null} placeholder={selected.netWeightKg === null ? 'Not weighed' : undefined} onChange={(e) => setNet(e.target.value)} className={INPUT} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Figure label="Litres" before={selected.grossLiters} after={preview?.grossLiters ?? null} unit="L" />
            <Figure label="@13% TS" before={selected.at13tsLiters} after={preview?.at13tsLiters ?? null} unit="L" />
          </div>

          <div>
            <label htmlFor="correct-reason" className="mb-1 block text-xs font-semibold text-foreground">Reason</label>
            <input id="correct-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} />
          </div>
        </>
      ) : null}

      {error ? <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800">{error}</p> : null}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} disabled={saving} className="min-h-11 min-w-11 rounded-lg border border-border-strong px-4 py-2 text-xs font-semibold text-secondary-foreground hover:bg-muted active:scale-[0.98]">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !selected || !preview || !isChanged || isWaiting || reason.trim().length < 3}
          className="min-h-11 min-w-11 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Apply correction'}
        </button>
      </div>
    </ZmccDrawer>
  );
}
