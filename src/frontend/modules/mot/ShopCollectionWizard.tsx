'use client';

/**
 * MOT shop collection as a 3-step wizard, shown inside the collection modal:
 *   1. Quantity & source   (RMR token, milk source with ERP badge, gross quantity)
 *   2. Tests & pictures    (every active policy test, SOP range, picture slots)
 *   3. Check & decide      (milk summary, test results, Accept / Reject, reason)
 * The footer (Back / Next / route-coloured submit) is sticky and sized to the visual viewport,
 * so the on-screen keyboard never covers it. State and saving stay in the page; this only lays it out.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Navigation, Plus, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MotShopTestsStep, type MotShopTestsStepProps } from '@/frontend/modules/mot/MotShopTestsStep';
import {
  DecisionRulePanel,
  DecisionSubmitButton,
  type DecisionRulePanelProps,
} from '@/frontend/modules/shared/decision/DecisionRulePanel';
import type { CachedAvailableSource } from '@/frontend/modules/mot/offlineStore';
import type { CanonicalMilkMetrics } from '@/backend/utils/milkFormulas';

export type CollectionGpsStatus = 'ACQUIRING' | 'CAPTURED' | 'APPROXIMATE' | 'UNAVAILABLE';

export interface ShopCollectionWizardProps {
  shopLabel: string;
  sequence: number;
  gpsStatus: CollectionGpsStatus;
  gpsAccuracy: number | null;
  gpsBadge?: React.ReactNode;
  formError: string | null;

  rmrNumber: string;
  onRmrNumberChange: (v: string) => void;
  sources: CachedAvailableSource[];
  selectedSourceId: string;
  onSourceChange: (id: string) => void;
  onRequestErpCode: () => void;
  quantity: string;
  onQuantityChange: (v: string) => void;
  unit: 'LITER' | 'KG';
  onUnitChange: (u: 'LITER' | 'KG') => void;

  tests: MotShopTestsStepProps;
  livePreview: CanonicalMilkMetrics | null;
  notes: string;
  onNotesChange: (v: string) => void;
  decision: Omit<DecisionRulePanelProps, 'showSubmit' | 'className'>;

  onSaveDraft: () => void;
  onClose: () => void;
}

const STEPS = ['Quantity', 'Tests', 'Decide'] as const;

const FIELD_CLASS =
  'h-12 w-full min-w-0 rounded-xl border-2 border-slate-300 bg-white px-3 text-base font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900';

/** Height of the visible area (shrinks when the on-screen keyboard opens). */
function useVisualViewportHeight(): number | null {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setH(vv.height);
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return h;
}

export function ShopCollectionWizard(props: ShopCollectionWizardProps) {
  const {
    shopLabel,
    sequence,
    gpsStatus,
    gpsAccuracy,
    gpsBadge,
    formError,
    rmrNumber,
    onRmrNumberChange,
    sources,
    selectedSourceId,
    onSourceChange,
    onRequestErpCode,
    quantity,
    onQuantityChange,
    unit,
    onUnitChange,
    tests,
    livePreview,
    notes,
    onNotesChange,
    decision,
    onSaveDraft,
    onClose,
  } = props;

  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const vvh = useVisualViewportHeight();
  const busy = Boolean(decision.submitting);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const selectedSource = sources.find((s) => s.id === selectedSourceId) ?? null;

  const checkStep = (i: number): string | null => {
    if (i === 0) {
      const q = parseFloat(quantity);
      if (!Number.isFinite(q) || q <= 0 || q > 10000) return 'Enter the milk quantity (more than 0, up to 10,000).';
    }
    if (i === 1) {
      const lr = parseFloat(tests.lr);
      const fat = parseFloat(tests.fat);
      if (!Number.isFinite(lr) || lr <= 0) return 'Enter the LR reading (more than zero).';
      if (!Number.isFinite(fat) || fat < 0) return 'Enter the Fat reading (zero or more).';
    }
    return null;
  };

  const goNext = () => {
    const err = checkStep(step);
    setStepError(err);
    if (!err) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  };
  const goTo = (i: number) => {
    if (i <= step) {
      setStepError(null);
      setStep(i);
      return;
    }
    for (let k = step; k < i; k++) {
      const err = checkStep(k);
      if (err) {
        setStepError(err);
        setStep(k);
        return;
      }
    }
    setStepError(null);
    setStep(i);
  };

  const gpsText =
    gpsStatus === 'ACQUIRING'
      ? 'Getting location…'
      : gpsStatus === 'CAPTURED'
        ? `Location captured (±${Math.round(gpsAccuracy || 0)} m)`
        : gpsStatus === 'APPROXIMATE'
          ? 'Approximate location (no fresh GPS)'
          : 'GPS unavailable';

  const error = stepError ?? formError;

  return (
    <div
      className="flex max-h-[90vh] flex-col"
      style={vvh ? { maxHeight: Math.min(vvh - 24, typeof window !== 'undefined' ? window.innerHeight * 0.9 : vvh) } : undefined}
    >
      {/* Header */}
      <div className="flex-none border-b border-slate-200 bg-slate-50 px-3 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            {sequence}
          </span>
          <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-tight text-slate-900 sm:text-base">{shopLabel}</h3>
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            <span className="hidden min-[400px]:inline">Save for later</span>
            <span className="min-[400px]:hidden">Save</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p
          className={cn(
            'mt-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold',
            gpsStatus === 'CAPTURED' ? 'text-emerald-700' : gpsStatus === 'UNAVAILABLE' ? 'text-slate-500' : 'text-amber-700'
          )}
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
          {gpsBadge}
          <span className={gpsStatus === 'ACQUIRING' ? 'animate-pulse' : undefined}>{gpsText}</span>
        </p>

        {/* Step indicator */}
        <ol className="mt-3 grid grid-cols-3 gap-1.5" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => goTo(i)}
                disabled={busy}
                aria-current={i === step ? 'step' : undefined}
                className="flex w-full flex-col items-stretch gap-1 text-left"
              >
                <span className={cn('h-1.5 rounded-full', i <= step ? 'bg-slate-900' : 'bg-slate-300')} />
                <span className={cn('text-xs font-semibold', i === step ? 'text-slate-900' : 'text-slate-500')}>
                  {i + 1}. {label}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* Body */}
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length - 1) goNext();
        }}
      >
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
              {error}
            </div>
          )}

          {step === 0 && (
            <>
              <div>
                <label htmlFor="mot-rmr" className="mb-1 block text-sm font-semibold text-slate-900">
                  RMR token (paper receipt no.)
                </label>
                <input
                  id="mot-rmr"
                  type="text"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  autoComplete="off"
                  value={rmrNumber}
                  onChange={(e) => onRmrNumberChange(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 004821"
                  className={cn(FIELD_CLASS, 'h-14 text-xl tracking-wider tabular-nums')}
                />
                <p className="mt-1 text-xs text-slate-500">Digits only. Leading zeros are kept.</p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="mot-source" className="text-sm font-semibold text-slate-900">
                    Milk source
                  </label>
                  {selectedSource?.erp_code ? (
                    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-800">
                      ERP {selectedSource.erp_code}
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                      No ERP code
                    </span>
                  )}
                </div>
                <select
                  id="mot-source"
                  value={selectedSourceId}
                  onChange={(e) => onSourceChange(e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">Unassigned</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.erp_code ? `[${s.erp_code}] ${s.name}` : s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onRequestErpCode}
                  className="mt-2 inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-900 underline-offset-4 hover:underline"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Request new ERP code
                </button>
              </div>

              <div>
                <label htmlFor="mot-qty" className="mb-1 block text-sm font-semibold text-slate-900">
                  Gross quantity <span className="text-rose-700">(required)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="mot-qty"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.1"
                    max="10000"
                    value={quantity}
                    onChange={(e) => onQuantityChange(e.target.value)}
                    placeholder="0.0"
                    className={cn(FIELD_CLASS, 'h-16 flex-1 text-2xl tabular-nums')}
                  />
                  <div className="flex shrink-0 overflow-hidden rounded-xl border-2 border-slate-300" role="radiogroup" aria-label="Unit">
                    {(['LITER', 'KG'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        role="radio"
                        aria-checked={unit === u}
                        onClick={() => onUnitChange(u)}
                        className={cn(
                          'min-w-14 px-3 text-base font-semibold transition',
                          unit === u ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        {u === 'LITER' ? 'L' : 'KG'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 1 && <MotShopTestsStep {...tests} />}

          {step === 2 && (
            <>
              {livePreview && (
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gross</p>
                    <p className="text-xl font-semibold tabular-nums text-slate-900">{livePreview.grossLiters} L</p>
                    <p className="text-xs text-slate-600">Density {livePreview.density}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">At 13 TS</p>
                    <p className="text-xl font-semibold tabular-nums text-emerald-700">{livePreview.at13TsLiters} L</p>
                    <p className="text-xs text-slate-600">
                      SNF {livePreview.snf}% · TS {livePreview.totalSolids}%
                    </p>
                  </div>
                </div>
              )}

              <DecisionRulePanel {...decision} acceptLabel={decision.acceptLabel ?? 'Accept milk'} rejectLabel={decision.rejectLabel ?? 'Reject milk'} showSubmit={false} />

              <div>
                <label htmlFor="mot-notes" className="mb-1 block text-sm font-semibold text-slate-900">
                  Notes (optional)
                </label>
                <textarea
                  id="mot-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="e.g. Clean container, seal checked"
                  className="min-h-12 w-full min-w-0 resize-y break-words rounded-xl border-2 border-slate-300 bg-white p-3 text-base focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex flex-none gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={busy}
              aria-label="Back"
              className="inline-flex min-h-14 min-w-14 shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white px-3 text-base font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 sm:px-5"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="submit"
              className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-base font-semibold text-white hover:bg-slate-800"
            >
              Next: {STEPS[step + 1]}
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : (
            <DecisionSubmitButton {...decision} className="flex-1" />
          )}
        </div>
      </form>
    </div>
  );
}
