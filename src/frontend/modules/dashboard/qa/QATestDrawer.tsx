'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  Camera,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Send,
  Sparkles,
  Calculator,
  Info,
} from 'lucide-react';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { cn } from '@/lib/utils';
import { toast } from '@/frontend/lib/appToast';
import { evaluate3ZoneTest } from '@/lib/sop-evaluation';
import type { LabTestDef, TestInputState, VisitDetail, VisitDetailPortion } from './qaTypes';
import type { DecisionResult, PersonDecision } from '@/types/stage1-decision';
import type { User } from '@core/types';
import { evaluateAllCalculatedTests } from '@/lib/calculated-tests';
import { buildSopChipText } from '@/lib/sop-chip';
import { pickRoleTest, isCalculatedTest, calculatedValueFor } from '@/lib/lab-test-roles';

export interface QATestDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  visitDetail: VisitDetail;
  portion: VisitDetailPortion;
  displayableTests: LabTestDef[];
  testInputs: Record<string, TestInputState>;
  onTestNumericChange: (testId: string, val: string) => void;
  onTestTextChange: (testId: string, val: string) => void;
  enteredSeal: string;
  onSealChange: (val: string) => void;
  photoStates: Record<string, string>;
  onPhotoChange: (testId: string, url: string | null) => void;
  personDecision: PersonDecision | null;
  onPersonDecisionChange?: (d: PersonDecision) => void;
  decisionRemarks: string;
  onDecisionRemarksChange?: (val: string) => void;
  canAccept: boolean;
  performedCount: number;
  requiredManualPlantTests: LabTestDef[];
  liveDecision: DecisionResult | null;
  onAcceptSubmit?: () => Promise<void> | void;
  onRejectSubmit?: () => Promise<void> | void;
  isSubmitting: boolean;
  currentUser?: User | null;
}

function outsideLabRange(rule?: { min?: number | null; max?: number | null } | null, raw?: string): boolean {
  if (!raw || raw.trim() === '') return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const min = rule?.min ?? null;
  const max = rule?.max ?? null;
  return (min != null && n < min) || (max != null && n > max);
}

function isDisallowedLabOption(rule?: { allowed?: string[] | null } | null, val?: string): boolean {
  if (!val || !val.trim()) return false;
  const allowed = rule?.allowed;
  if (!allowed || allowed.length === 0) return false;
  const upper = val.trim().toUpperCase();
  return !allowed.some((a) => a.trim().toUpperCase() === upper);
}

// Photo evidence follows the Super Admin policy only (no test is hard-coded to need a photo).
function isPhotoEligible(test: LabTestDef): boolean {
  return Boolean(test.isPhotoRequired);
}

function getTestOptions(test: LabTestDef): Array<{ value: string; label: string }> {
  if (Array.isArray(test.resultOptions) && test.resultOptions.length > 0) {
    return test.resultOptions.map((o) => ({
      value: o.value,
      label: o.label || o.value,
    }));
  }
  if (test.rule?.allowed && test.rule.allowed.length > 0) {
    return test.rule.allowed.map((a) => ({
      value: a,
      label: a,
    }));
  }
  const typeUpper = (test.resultType || '').toUpperCase();
  const codeUpper = (test.testCode || '').toUpperCase();
  const nameUpper = (test.testName || '').toUpperCase();

  if (typeUpper === 'OK_NOT_OK') {
    return [
      { value: 'OK', label: 'OK' },
      { value: 'NOT_OK', label: 'NOT OK' },
    ];
  }
  if (
    typeUpper === 'POSITIVE_NEGATIVE' ||
    nameUpper.includes('APT') ||
    nameUpper.includes('COB') ||
    nameUpper.includes('CLOT') ||
    nameUpper.includes('ALCOHOL') ||
    codeUpper.includes('APT') ||
    codeUpper.includes('COB')
  ) {
    return [
      { value: 'NEGATIVE', label: 'Negative' },
      { value: 'POSITIVE', label: 'Positive' },
    ];
  }
  if (typeUpper === 'BOOLEAN') {
    return [
      { value: 'PASS', label: 'Pass' },
      { value: 'FAIL', label: 'Fail' },
    ];
  }
  if (typeUpper === 'QUALITATIVE') {
    return [
      { value: 'NORMAL', label: 'Normal' },
      { value: 'ABNORMAL', label: 'Abnormal' },
    ];
  }
  return [];
}

export const QATestDrawer: React.FC<QATestDrawerProps> = ({
  isOpen,
  onClose,
  visitDetail,
  portion,
  displayableTests,
  testInputs,
  onTestNumericChange,
  onTestTextChange,
  enteredSeal,
  onSealChange,
  photoStates,
  onPhotoChange,
  personDecision,
  onPersonDecisionChange,
  decisionRemarks,
  onDecisionRemarksChange,
  canAccept,
  performedCount,
  requiredManualPlantTests,
  liveDecision,
  onAcceptSubmit,
  onRejectSubmit,
  isSubmitting,
  currentUser,
}) => {
  const [cameraTest, setCameraTest] = useState<LabTestDef | null>(null);

  const isPending = portion.plant_decision === 'PENDING' || !portion.plant_decision;
  const dispatchSeal = portion.seal_number?.trim() || '';
  const currentEnteredSeal = (enteredSeal || portion.plant_seal_number_entered || '').trim();
  const hasDispatchSeal = Boolean(dispatchSeal);
  const isSealMatched = hasDispatchSeal && currentEnteredSeal.toUpperCase() === dispatchSeal.toUpperCase();
  const isSealMismatch = hasDispatchSeal && Boolean(currentEnteredSeal) && !isSealMatched;

  // The system recommends ACCEPT only when nothing is failing, missing, or waiting for a required photo.
  const systemRejectReasons = useMemo(() => {
    if (!liveDecision) return [] as string[];
    const nameOf = (code: string) => requiredManualPlantTests.find((t) => t.testCode === code)?.testName || code;
    const reasons: string[] = [];
    for (const r of liveDecision.exceptionReasons) {
      if (r.startsWith('RULE_FAIL:')) reasons.push(`${nameOf(r.slice('RULE_FAIL:'.length))} is outside the allowed limit.`);
      else if (r === 'MISSING_FIELD') reasons.push('A required test result is missing.');
    }
    for (const t of requiredManualPlantTests) {
      if (t.isPhotoRequired && !isCalculatedTest(t as LabTestDef & { formulaId?: unknown }) && !photoStates[t.id]) {
        reasons.push(`Test photo is required for ${t.testName}.`);
      }
    }
    return Array.from(new Set(reasons));
  }, [liveDecision, requiredManualPlantTests, photoStates, hasDispatchSeal, isSealMatched]);
  const systemAccepts = liveDecision?.systemOutcome === 'PASS' && systemRejectReasons.length === 0;
  // Authorized roles decide on the spot; everyone else cannot accept a system-rejected portion, only ask the AVP.
  // Super Admin and Data Executive (and the heads above QAE) decide on their own account, even on the QAE station.
  const isAuthorizedToOverride = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'QA_HEAD'].includes(currentUser?.role || '');
  const mustRequestAvp = Boolean(liveDecision) && !systemAccepts && !isAuthorizedToOverride;

  // Check if executive user for information cloaking
  const isExecutiveUser = Boolean(
    currentUser &&
      ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'EXECUTIVE_MANAGEMENT', 'HEAD_OF_MPD', 'QA_HEAD'].includes(currentUser.role)
  );

  // Authoritative detection of raw observations: LR and Fat
  // Found by stored role (LR / Fat): the same rule the live preview and the server use.
  const lrTest = useMemo(() => pickRoleTest(displayableTests, 'LR') ?? undefined, [displayableTests]);
  const fatTest = useMemo(() => pickRoleTest(displayableTests, 'FAT') ?? undefined, [displayableTests]);

  const lrNum = lrTest && testInputs[lrTest.id]?.numericValue ? Number(testInputs[lrTest.id]?.numericValue) : null;
  const fatNum = fatTest && testInputs[fatTest.id]?.numericValue ? Number(testInputs[fatTest.id]?.numericValue) : null;

  const autoCalculations = useMemo(() => {
    return evaluateAllCalculatedTests({ LR: lrNum, FAT: fatNum });
  }, [lrNum, fatNum]);

  // Information Cloaking for junior operators
  const displayRejectionReason = useMemo(() => {
    if (!portion.plant_rejection_reason) return '';
    if (isExecutiveUser) return portion.plant_rejection_reason;
    // Cloak sensitive internal override notes
    let text = portion.plant_rejection_reason;
    text = text.replace(/super admin/gi, 'Authorized Management');
    text = text.replace(/avp absent/gi, 'Authorized Management');
    text = text.replace(/override/gi, 'Authorization');
    return text;
  }, [portion.plant_rejection_reason, isExecutiveUser]);

  // Master test order (the catalog order Super Admin sets: 1, 2, 3 ...), never alphabetical or required-first.
  const sortedTests = useMemo(() => {
    return [...displayableTests].sort(
      (a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || (a.testCode || '').localeCompare(b.testCode || '')
    );
  }, [displayableTests]);

  const handleSubmit = async () => {
    if (personDecision === 'REJECT') {
      if (onRejectSubmit) await onRejectSubmit();
    } else {
      if (onAcceptSubmit) await onAcceptSubmit();
    }
  };

  return (
    <>
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) onClose();
        }}
      >
        <DrawerContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5 shrink-0">
            <div>
              <DrawerTitle className="text-base font-bold text-slate-900">
                {visitDetail.test_mode === 'COMPOSITE' && visitDetail.portions.length === 1
                  ? 'Composite Sample Tests & Decision'
                  : `Portion #${portion.portion_number} Tests & Decision`}
              </DrawerTitle>
              <p className="text-xs text-slate-500 font-medium">
                Vehicle: <strong className="text-slate-800">{visitDetail.vehicle_number || '—'}</strong> · Token:{' '}
                <strong className="text-slate-800 tabular-nums">{visitDetail.token_number || '—'}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border-2 border-red-500 text-slate-500 hover:bg-red-50 hover:text-red-700 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5 flex-1">
            {/* Read-only summary if portion is already completed */}
            {!isPending && (
              <div className="bg-card border-border space-y-3 rounded-xl border p-4 text-xs text-slate-700">
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">Final Decision:</span>
                    <span
                      className={cn(
                        'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase',
                        portion.plant_decision === 'ACCEPTED'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                          : 'bg-rose-50 text-rose-800 border border-rose-300'
                      )}
                    >
                      {portion.plant_decision}
                    </span>
                  </div>
                  {portion.plant_seal_number_entered && (
                    <span className="text-slate-600 font-mono text-xs">
                      Seal: <strong className="text-slate-900">{portion.plant_seal_number_entered}</strong>
                    </span>
                  )}
                </div>

                {displayRejectionReason && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-rose-900">
                    <p className="font-bold text-[11px] uppercase tracking-wide">Rejection Reason:</p>
                    <p className="mt-0.5">{displayRejectionReason}</p>
                  </div>
                )}

                {portion.plant_results && portion.plant_results.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="font-semibold text-slate-800">Recorded Test Results:</p>
                    <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-white">
                      {portion.plant_results.map((pr) => (
                        <div key={pr.testId} className="flex items-center justify-between p-2 text-xs">
                          <span className="font-medium text-slate-700">{pr.testName}</span>
                          <span className="font-mono font-bold text-slate-900">
                            {pr.numericValue != null ? `${pr.numericValue} ${pr.unit || ''}` : pr.textValue || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Editable Testing Mode */}
            {isPending && (
              <>
                {/* Tanker Seal Check Section */}
                <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-primary" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Tanker Seal Check
                      </h4>
                    </div>
                    {hasDispatchSeal ? (
                      isSealMatched ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Seal Match
                        </span>
                      ) : isSealMismatch ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                          Seal differs (optional)
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                          Seal not entered (optional)
                        </span>
                      )
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                        No Dispatch Seal
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Dispatch Seal</span>
                      <div className="mt-1 bg-subtle p-2 rounded-lg border font-mono font-bold text-slate-900 text-xs">
                        {portion.seal_number || 'None'}
                      </div>
                    </div>
                    <div>
                      <label htmlFor="qa-entered-seal" className="text-[10px] uppercase font-bold text-slate-500 block">
                        Observed Tanker Seal (optional)
                      </label>
                      <input
                        id="qa-entered-seal"
                        type="text"
                        value={currentEnteredSeal}
                        onChange={(e) => onSealChange(e.target.value)}
                        placeholder="Enter seal number on tanker"
                        className={cn(
                          'mt-1 w-full min-h-11 rounded-lg border border-border p-2 text-base sm:text-xs font-mono font-bold focus:outline-hidden focus:border-primary'
                        )}
                      />
                    </div>
                  </div>
                </div>

                {/* Laboratory Test Observations */}
                <div className="rounded-xl border border-border bg-card overflow-hidden shadow-2xs">
                  <div className="bg-slate-50 border-b border-border p-3 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Laboratory Tests ({sortedTests.length})
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Performed: <strong className="text-slate-900">{performedCount}</strong> / {sortedTests.length}
                    </span>
                  </div>

                  <div className="divide-y divide-border">
                    {sortedTests.map((t) => {
                      const state = testInputs[t.id] || {
                        performanceStatus: 'PERFORMED',
                        notPerformedReason: '',
                        numericValue: '',
                        textValue: '',
                      };
                      // Calculated tests (SNF, Total Solids, ratio) are found by stored role first, never by test id or order.
                      const isCalculated = isCalculatedTest(t as LabTestDef & { formulaId?: unknown });
                      const calcVal: number | null = isCalculated ? calculatedValueFor(t, autoCalculations) : null;

                      const isNumeric = t.resultType === 'NUMERIC';
                      const options = getTestOptions(t);
                      const chip = buildSopChipText({
                        resultType: t.resultType,
                        min: t.rule?.min,
                        max: t.rule?.max,
                        allowed: t.rule?.allowed,
                        options: Array.isArray(t.resultOptions) ? t.resultOptions : null,
                      });
                      const hasOptions = !isNumeric && options.length > 0;
                      const isAppliedOnly = !t.isRequired;

                      const effectiveVal = isCalculated && calcVal != null ? String(calcVal.toFixed(2)) : state.numericValue;

                      const evalRes = evaluate3ZoneTest(
                          {
                            min: t.rule?.min,
                            max: t.rule?.max,
                            warningTrigger: (t.rule as any)?.warningTrigger,
                            decisionConsequence: (t.rule as any)?.decisionConsequence,
                            acceptableOption: (t.rule as any)?.acceptableOption,
                            category: (t.rule as any)?.ruleCategory,
                            ruleCategory: (t.rule as any)?.ruleCategory,
                            testMode: t.isRequired ? 'COMPULSORY' : 'OPTIONAL',
                            resultType: t.resultType,
                            resultOptions: t.resultOptions,
                            unit: t.unit,
                          },
                          isNumeric ? effectiveVal : state.textValue
                        );

                        const isWarning = !isAppliedOnly && !isCalculated && Boolean(isNumeric ? effectiveVal : state.textValue) && evalRes.isWarning;
                        const isFail = !isAppliedOnly && !isCalculated && Boolean(isNumeric ? effectiveVal : state.textValue) && evalRes.isRuleFailure;
                        const isOut = isWarning || isFail;

                      const hasCamera = isPhotoEligible(t) && !isCalculated;
                      const hasPhoto = Boolean(photoStates[t.id]);

                      return (
                        <div
                          key={t.id}
                          className={cn(
                            'p-3 space-y-1.5 transition',
                            isOut ? 'bg-rose-50/20' : 'bg-card'
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-[9rem] flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-slate-800">{t.testName}</span>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                    isCalculated
                                      ? 'bg-purple-100 text-purple-900 border border-purple-300'
                                      : t.isRequired
                                      ? 'bg-red-600 text-white shadow-2xs'
                                      : 'bg-slate-100 text-slate-600'
                                  )}
                                >
                                  {isCalculated ? 'AUTO' : t.isRequired ? 'REQUIRED *' : 'OPTIONAL'}
                                </span>
                                {chip && (
                                  <span
                                    className={cn(
                                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                                      isOut
                                        ? 'border-rose-300 bg-rose-50 text-rose-800'
                                        : 'border-slate-300 bg-slate-50 text-slate-700'
                                    )}
                                  >
                                    {chip}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5 font-medium">
                                {t.unit ? `Unit: ${t.unit}` : ''}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isCalculated ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    readOnly
                                    value={calcVal != null ? `${calcVal.toFixed(2)} ${t.unit || '%'}` : !lrNum && !fatNum ? 'Awaiting LR & Fat' : !lrNum ? 'Awaiting LR' : 'Awaiting Fat'}
                                    aria-label={t.testName}
                                    className="min-h-11 h-10 w-32 rounded-lg border border-purple-300 bg-purple-50/50 px-2 text-xs font-bold text-purple-950 tabular-nums focus:outline-hidden"
                                  />
                                </div>
                              ) : isNumeric ? (
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  value={state.numericValue}
                                  aria-label={t.testName}
                                  placeholder="0.00"
                                  onChange={(e) => onTestNumericChange(t.id, e.target.value)}
                                  aria-invalid={isOut || undefined}
                                  className={cn(
                                    'min-h-11 h-10 w-28 rounded-lg border px-2 text-base sm:text-sm font-semibold tabular-nums text-right sm:text-left focus:outline-hidden focus:ring-2',
                                    isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'
                                  )}
                                />
                              ) : hasOptions ? (
                                <select
                                  value={state.textValue}
                                  aria-label={t.testName}
                                  onChange={(e) => onTestTextChange(t.id, e.target.value)}
                                  aria-invalid={isOut || undefined}
                                  className={cn(
                                    'min-h-11 h-10 w-32 rounded-lg border px-2 text-xs font-semibold focus:outline-hidden focus:ring-2',
                                    isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'
                                  )}
                                >
                                  <option value="">Select</option>
                                  {options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={state.textValue}
                                  aria-label={t.testName}
                                  placeholder="Observation"
                                  onChange={(e) => onTestTextChange(t.id, e.target.value)}
                                  aria-invalid={isOut || undefined}
                                  className={cn(
                                    'min-h-11 h-10 w-32 rounded-lg border px-2 text-xs font-semibold focus:outline-hidden focus:ring-2',
                                    isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'
                                  )}
                                />
                              )}

                              {hasCamera && (
                                <button
                                  type="button"
                                  onClick={() => setCameraTest(t)}
                                  className={cn(
                                    'min-h-11 min-w-11 flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition',
                                    hasPhoto
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                  )}
                                >
                                  <Camera className="h-4 w-4" />
                                  <span>{hasPhoto ? 'Photo' : 'Snap'}</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {isAppliedOnly && (
                            <p className="text-[10px] text-sky-700 font-medium">
                              Not under SOP: Optional test, system rules not applied.
                            </p>
                          )}
                          {isCalculated && (
                            <p className="text-[10px] text-purple-700 font-medium flex items-center gap-1">
                              <Calculator className="h-3 w-3" /> Auto-calculated by Richmond canonical formula
                            </p>
                          )}
                          {!isCalculated && !isAppliedOnly && Boolean(isNumeric ? effectiveVal : state.textValue) && (
                            <p
                              className={cn(
                                'flex items-center gap-1 text-[11px] font-semibold mt-1',
                                isFail ? 'text-rose-700' : isWarning ? 'text-amber-800' : 'text-emerald-700'
                              )}
                            >
                              {isFail ? (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                              ) : isWarning ? (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                              )}
                              <span>{evalRes.message}</span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Person Decision & Remarks */}
                <div className="rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Your Decision
                    </span>
                    {liveDecision && (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase',
                            systemAccepts
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                              : 'bg-rose-50 text-rose-800 border border-rose-300'
                          )}
                        >
                          System: {systemAccepts ? 'ACCEPT' : 'REJECT'}
                        </span>
                        {!systemAccepts && systemRejectReasons.length > 0 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                aria-label="Why the system rejects"
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-rose-700 hover:bg-rose-50"
                              >
                                <Info className="h-4 w-4" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 space-y-1.5 p-3 text-xs">
                              <p className="font-bold text-slate-800">Why the system rejects</p>
                              <ul className="list-disc space-y-1 pl-4 text-slate-700">
                                {systemRejectReasons.map((r) => (
                                  <li key={r}>{r}</li>
                                ))}
                              </ul>
                            </PopoverContent>
                          </Popover>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onPersonDecisionChange?.('ACCEPT')}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition',
                        personDecision === 'ACCEPT'
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      {mustRequestAvp ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      <span>{mustRequestAvp ? 'Request AVP to Accept' : 'Accept Milk'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPersonDecisionChange?.('REJECT')}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition',
                        personDecision === 'REJECT'
                          ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Reject Milk</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="qa-decision-remarks" className="text-[10px] uppercase font-bold text-slate-500 block">
                      Decision Remarks / Notes {personDecision === 'REJECT' || mustRequestAvp ? '*' : '(Optional)'}
                    </label>
                    <input
                      id="qa-decision-remarks"
                      type="text"
                      value={decisionRemarks}
                      onChange={(e) => onDecisionRemarksChange?.(e.target.value)}
                      placeholder={personDecision === 'REJECT' ? 'Mandatory rejection reason' : mustRequestAvp ? 'Mandatory: tell the AVP why this should be accepted' : 'Operational remarks'}
                      className="mt-1 w-full min-h-11 rounded-lg border border-border p-2 text-base sm:text-xs focus:border-primary focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Final Submit Actions */}
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isSubmitting || !personDecision || ((personDecision === 'REJECT' || mustRequestAvp) && !decisionRemarks.trim())}
                    onClick={handleSubmit}
                    className={cn(
                      'w-full min-h-12 rounded-xl text-white font-bold text-sm shadow-xs transition flex items-center justify-center space-x-2 disabled:opacity-50',
                      personDecision === 'REJECT'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-primary hover:bg-primary-hover'
                    )}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{mustRequestAvp && personDecision !== 'REJECT' ? 'Sending Request…' : 'Submitting Decision…'}</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>
                          {mustRequestAvp && personDecision !== 'REJECT'
                            ? 'Send Request to AVP QA Reception Lab'
                            : 'Confirm & Complete Portion Decision'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Camera Capture - Fullscreen LiveCamera matching Dispatch to Plant form */}
      {cameraTest && (
        <LiveCamera
          stamp={{
            employeeCode: currentUser?.username || 'QA-OPERATOR',
            roleLabel: currentUser?.role || 'Plant QA Reception',
            actingAsLabel: null,
            pointLabel: `Plant QA - ${cameraTest.testName}`,
            vehicleNo: visitDetail.vehicle_number || null,
          }}
          onCapture={async (res) => {
            const currentTest = cameraTest;
            setCameraTest(null);
            try {
              const form = new FormData();
              form.append('file', res.blob, `${res.captureId}.jpg`);
              // /api/photos reads the details from the `meta` field and needs the record the photo belongs to.
              form.append(
                'meta',
                JSON.stringify({
                  captureId: res.captureId,
                  sha256: res.sha256,
                  testingPoint: 'PLANT_QA',
                  entityType: 'visit_portion',
                  entityId: portion.id,
                  labTestId: currentTest.id,
                  portionNumber: portion.portion_number,
                  photoKind: 'TEST_RESULT',
                  deviceCapturedAt: res.capturedAt,
                  latitude: res.gps?.lat ?? null,
                  longitude: res.gps?.lng ?? null,
                  gpsAccuracyM: res.gps?.accuracyM ?? null,
                  wasOffline: false,
                  width: res.width,
                  height: res.height,
                })
              );
              const r = await fetch('/api/photos', { method: 'POST', body: form });
              if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                throw new Error(d.error || 'The photo could not be saved.');
              }
              // Only a photo the server saved counts: keep its address, never the phone-only preview.
              onPhotoChange(currentTest.id, `/api/photos/${res.captureId}`);
            } catch (err) {
              console.error('Failed to upload photo:', err);
              toast.error(`Photo for ${currentTest.testName} was not saved. Please take it again. ${err instanceof Error ? err.message : ''}`.trim());
            }
          }}
          onCancel={() => setCameraTest(null)}
        />
      )}
    </>
  );
};
