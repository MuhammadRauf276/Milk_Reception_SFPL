'use client';

import { useVisualViewportHeight } from '@/frontend/hooks/useVisualViewport';

/**
 * MOT shop collection as a streamlined 2-step wizard + dedicated Decide Modal:
 *   1. Quantity & Source   (RMR token, milk source with ERP Combobox, gross quantity, notes)
 *   2. Tests & Pictures    (policy tests, SOP acceptable ranges, live photo evidence)
 * Clicking "Review & Decide" opens the Decide Modal (Dialog on desktop, Drawer on mobile).
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Combobox } from '@/components/ui/combobox';
import { QuickRemarksChips } from '@/components/ui/quick-remarks-chips';
import { ArrowLeft, ArrowRight, CheckCircle2, Navigation, Save, Sparkles, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MotShopTestsStep, type MotShopTestsStepProps } from '@/frontend/modules/mot/MotShopTestsStep';
import {
  DecisionRulePanel,
  DecisionSubmitButton,
  type DecisionRulePanelProps,
} from '@/frontend/modules/shared/decision/DecisionRulePanel';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
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

const STEPS = ['Source & Tests', 'Quantity & Comments'] as const;

const FIELD_CLASS =
  'h-12 w-full min-w-0 rounded-xl border border-border bg-white px-3 text-base font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';



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
  const [decideOpen, setDecideOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const vvh = useVisualViewportHeight();
  const busy = Boolean(decision.submitting);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const checkStep = (i: number): string | null => {
    if (i === 0) {
      if (!selectedSourceId) return 'Choose the milk source for this shop.';
      const lr = parseFloat(tests.lr);
      const fat = parseFloat(tests.fat);
      if (!Number.isFinite(lr) || lr <= 0) return 'Enter the LR reading (more than zero).';
      if (!Number.isFinite(fat) || fat < 0) return 'Enter the Fat reading (zero or more).';
    }
    if (i === 1) {
      const q = parseFloat(quantity);
      if (!Number.isFinite(q) || q <= 0 || q > 10000) return 'Enter the milk quantity (more than 0, up to 10,000).';
    }
    return null;
  };

  const handleOpenDecide = () => {
    const err0 = checkStep(0);
    if (err0) {
      setStep(0);
      setStepError(err0);
      return;
    }
    const err1 = checkStep(1);
    if (err1) {
      setStepError(err1);
      return;
    }
    setStepError(null);
    setDecideOpen(true);
  };

  const goNext = () => {
    const err = checkStep(step);
    setStepError(err);
    if (!err) {
      if (step < STEPS.length - 1) {
        setStep(step + 1);
      } else {
        handleOpenDecide();
      }
    }
  };

  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const gpsText =
    gpsStatus === 'ACQUIRING'
      ? 'Getting location…'
      : gpsStatus === 'CAPTURED'
        ? `Location captured (±${Math.round(gpsAccuracy || 0)} m)`
        : gpsStatus === 'APPROXIMATE'
          ? 'Approximate location'
          : 'GPS unavailable';

  const error = stepError ?? formError;

  return (
    <div
      className="flex max-h-[90dvh] flex-col"
      style={vvh ? { maxHeight: Math.min(vvh - 24, typeof window !== 'undefined' ? window.innerHeight * 0.9 : vvh) } : undefined}
    >
      {/* Header */}
      <div className="flex-none border-b border-slate-200 bg-slate-50/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-white shadow-2xs">
            {sequence}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{shopLabel}</h3>
            <p
              className={cn(
                'flex items-center gap-1 text-[11px] font-medium',
                gpsStatus === 'CAPTURED' ? 'text-emerald-700' : gpsStatus === 'UNAVAILABLE' ? 'text-slate-500' : 'text-amber-700'
              )}
            >
              <Navigation className="h-3 w-3 shrink-0" aria-hidden="true" />
              {gpsBadge}
              <span className={gpsStatus === 'ACQUIRING' ? 'animate-pulse' : undefined}>{gpsText}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            title="Save draft for later"
            className="min-h-11 min-w-11 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden min-[420px]:inline">Draft</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Step Tabs */}
        <div className="mt-2.5 grid grid-cols-2 gap-2" role="tablist">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={i === step}
              onClick={() => {
                const err = i > step ? checkStep(step) : null;
                setStepError(err);
                if (!err) setStep(i);
              }}
              disabled={busy}
              className={cn('min-h-11 min-w-11', 
                'flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition',
                i === step
                  ? 'border-primary bg-primary text-white shadow-2xs'
                  : 'border-border bg-white text-slate-600 hover:bg-subtle'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', i === step ? 'bg-white' : 'bg-slate-300')} />
              <span>{i + 1}. {label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Body with subtle framer-motion transitions */}
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          goNext();
        }}
      >
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain p-4">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800"
            >
              {error}
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="step-source-tests"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="space-y-3.5"
              >
                {/* 1. RMR Token */}
                <div>
                  <label htmlFor="mot-rmr" className="mb-1 block text-xs font-semibold text-slate-900">
                    RMR Token (Paper Receipt No.)
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
                    className={cn(FIELD_CLASS, 'h-12 text-lg tracking-wider tabular-nums')}
                  />
                </div>

                {/* 2. Milk Source: required, assigned to this ZMCC, name only */}
                <div>
                  <label htmlFor="mot-source" className="mb-1 block text-xs font-semibold text-slate-900">
                    Milk Source <span className="text-red-600">*</span>
                  </label>
                  <Combobox
                    id="mot-source"
                    className="min-h-[48px]"
                    value={selectedSourceId}
                    onValueChange={onSourceChange}
                    placeholder="Select milk source…"
                    searchPlaceholder="Search milk source…"
                    options={sources.map((s) => ({
                      value: s.id,
                      label: s.name,
                      keywords: s.name,
                    }))}
                  />
                  {sources.length === 0 ? (
                    <p className="mt-1 text-[11px] font-semibold text-amber-800">
                      No milk source assigned.
                    </p>
                  ) : null}
                </div>

                {/* 3. Assigned tests from super admin to mot level user with sops */}
                <div className="pt-1">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Assigned Quality Tests (SOP)
                    </span>
                  </div>
                  <MotShopTestsStep {...tests} />
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="step-quantity-comments"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="space-y-3.5"
              >
                {/* 4. Gross Liters / Quantity */}
                <div>
                  <label htmlFor="mot-qty" className="mb-1 block text-xs font-semibold text-slate-900">
                    Gross Quantity <span className="text-rose-600">*</span>
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
                      placeholder="0.00"
                      className={cn(FIELD_CLASS, 'h-14 flex-1 text-xl tabular-nums')}
                    />
                    <div className="flex shrink-0 overflow-hidden rounded-xl border border-border" role="radiogroup" aria-label="Unit">
                      {(['LITER', 'KG'] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          role="radio"
                          aria-checked={unit === u}
                          onClick={() => onUnitChange(u)}
                          className={cn('min-h-11 min-w-11', 
                            'min-w-14 px-3 text-sm font-semibold transition',
                            unit === u ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-subtle'
                          )}
                        >
                          {u === 'LITER' ? 'L' : 'KG'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Live Yield calculations */}
                {livePreview && parseFloat(quantity) > 0 && (
                  <div className="bg-card border-border grid grid-cols-2 gap-2 rounded-xl border p-2.5">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-500">Gross Liters</p>
                      <p className="text-base font-bold tabular-nums text-slate-900">{livePreview.grossLiters} L</p>
                      <p className="text-[10px] text-slate-600">Density: {livePreview.density}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-emerald-800">At 13 TS Liters</p>
                      <p className="text-base font-bold tabular-nums text-emerald-700">{livePreview.at13TsLiters} L</p>
                      <p className="text-[10px] text-slate-600">
                        SNF {livePreview.snf}% · TS {livePreview.totalSolids}%
                      </p>
                    </div>
                  </div>
                )}

                {/* 5. Comments (if any) */}
                <div className="space-y-2">
                  <label htmlFor="mot-notes" className="block text-xs font-semibold text-slate-700">
                    Comments / Field Notes (Optional)
                  </label>
                  <QuickRemarksChips
                    presets={['Sample Normal', 'Seal Checked', 'Temp in Spec', 'Can Dented', 'Delayed at Shop']}
                    value={notes}
                    onChange={onNotesChange}
                    label="Quick notes:"
                  />
                  <textarea
                    id="mot-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Enter notes or tap quick presets above…"
                    className="min-h-11 w-full resize-none rounded-xl border border-border bg-white p-2.5 text-base sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Minimalist sticky footer */}
        <div className="flex flex-none items-center gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={busy}
              aria-label="Back"
              className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {step === 0 ? (
            <button
              type="submit"
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-2xs hover:bg-primary-hover transition"
            >
              <span>Next: Quantity & Comments</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenDecide}
              disabled={busy}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-2xs hover:bg-emerald-800 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>Review & Decide</span>
            </button>
          )}
        </div>
      </form>

      {/* Decide Modal: Opens in a centered Dialog on desktop, Drawer on mobile */}
      <Drawer open={decideOpen} onOpenChange={setDecideOpen} dismissible={!busy}>
        <DrawerContent className="max-w-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <div>
              <DrawerTitle className="text-base font-bold text-slate-900">
                Shop Collection Decision
              </DrawerTitle>
              <p className="text-xs text-slate-500 font-medium">
                {shopLabel} · RMR: <strong className="text-slate-800">{rmrNumber || 'None'}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDecideOpen(false)}
              disabled={busy}
              aria-label="Close decision"
              className="min-h-11 min-w-11 flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
            {livePreview && (
              <div className="bg-card border-border grid grid-cols-2 gap-2 rounded-xl border p-3">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-slate-500">Gross Quantity</span>
                  <p className="text-lg font-bold tabular-nums text-slate-900">{livePreview.grossLiters} L</p>
                  <p className="text-xs text-slate-600">Density: {livePreview.density}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold uppercase text-emerald-800">At 13 TS Quantity</span>
                  <p className="text-lg font-bold tabular-nums text-emerald-700">{livePreview.at13TsLiters} L</p>
                  <p className="text-xs text-slate-600">
                    SNF: {livePreview.snf}% · TS: {livePreview.totalSolids}%
                  </p>
                </div>
              </div>
            )}

            <DecisionRulePanel
              {...decision}
              acceptLabel={decision.acceptLabel ?? 'Accept Milk'}
              rejectLabel={decision.rejectLabel ?? 'Reject Milk'}
              showSubmit={false}
            />

            <div className="pt-1">
              <DecisionSubmitButton
                {...decision}
                onSubmit={() => {
                  decision.onSubmit();
                }}
                className="w-full"
              />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
