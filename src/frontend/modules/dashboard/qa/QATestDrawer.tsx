'use client';

import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, XCircle, AlertTriangle, Loader2, ShieldCheck, Send, Calculator, Info, X, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { InfoTip } from '@/components/ui/info-tip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
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
import { stampEmployeeCode, stampRoleLabel } from '@/lib/photo/stampIdentity';

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
  onSavePortion?: () => void;
  onRemovePortion?: () => void;
  canRemovePortion?: boolean;
  isSubmitting: boolean;
  currentUser?: User | null;
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
  canAccept: _canAccept,
  performedCount,
  requiredManualPlantTests,
  liveDecision,
  onAcceptSubmit,
  onRejectSubmit,
  onSavePortion,
  onRemovePortion,
  canRemovePortion = false,
  isSubmitting,
  currentUser,
}) => {
  const [cameraTest, setCameraTest] = useState<LabTestDef | null>(null);
  const [photoUploadState, setPhotoUploadState] = useState<
    Record<string, { progress: number; status: 'uploading' | 'complete' | 'error' }>
  >({});

  const isPending = portion.plant_decision === 'PENDING' || !portion.plant_decision;
  const dispatchSeal = portion.seal_number?.trim() || '';
  const currentEnteredSeal = (enteredSeal || portion.plant_seal_number_entered || '').trim();
  const hasDispatchSeal = Boolean(dispatchSeal);
  const isSealMatched = hasDispatchSeal && currentEnteredSeal.toUpperCase() === dispatchSeal.toUpperCase();
  const isSealMismatch = hasDispatchSeal && Boolean(currentEnteredSeal) && !isSealMatched;

  // The system recommends ACCEPT only when nothing is failing, missing, or waiting for a required photo.
  const { systemRejectReasons, ruleReasons } = useMemo(() => {
    if (!liveDecision) return { systemRejectReasons: [] as string[], ruleReasons: [] as string[] };
    const nameOf = (code: string) => displayableTests.find((t) => t.testCode === code)?.testName || code;
    const reasons: string[] = [];
    const rules: string[] = [];
    for (const r of liveDecision.exceptionReasons) {
      if (r === 'MISMATCH') {
        reasons.push("The person's decision differs from the test result.");
      } else if (r.startsWith('RULE_FAIL:')) {
        const msg = `${nameOf(r.slice('RULE_FAIL:'.length))} is outside the allowed limit.`;
        reasons.push(msg);
        rules.push(msg);
      } else if (r === 'MISSING_FIELD') {
        const msg = 'A compulsory test was not done.';
        reasons.push(msg);
        rules.push(msg);
      } else if (r === 'PICTURE_MISSING' || r.startsWith('PICTURE_MISSING:')) {
        const code = r.includes(':') ? r.slice(r.indexOf(':') + 1).trim() : '';
        const msg = code ? `Test photo is required for ${nameOf(code)}.` : 'A required test picture is missing.';
        reasons.push(msg);
        rules.push(msg);
      }
    }
    for (const t of displayableTests) {
      if (t.isPhotoRequired && !isCalculatedTest(t as LabTestDef & { formulaId?: unknown }) && !photoStates[t.id]) {
        const msg = `Test photo is required for ${t.testName}.`;
        reasons.push(msg);
        rules.push(msg);
      }
    }
    return { systemRejectReasons: Array.from(new Set(reasons)), ruleReasons: Array.from(new Set(rules)) };
  }, [liveDecision, displayableTests, photoStates]);
  const systemAccepts = liveDecision?.systemOutcome === 'PASS' && ruleReasons.length === 0;
  // A station user's exception goes to AVP QA; a superior decides their own here (DECIDE_NOW).
  const mustRequestAvp = Boolean(personDecision && liveDecision && liveDecision.route === 'SEND_TO_APPROVER');
  const remarksNeeded = personDecision === 'REJECT' || mustRequestAvp || Boolean(personDecision && liveDecision?.remarksRequired);

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
        <DrawerContent showClose={false} className="max-w-2xl max-h-[90dvh] flex flex-col p-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5 shrink-0">
            <div>
              <DrawerTitle className="text-base font-semibold text-foreground">
                {visitDetail.test_mode === 'COMPOSITE' && visitDetail.portions.length === 1
                  ? 'Composite sample tests and decision'
                  : `Portion #${portion.portion_number} tests and decision`}
              </DrawerTitle>
              <p className="text-xs text-muted-foreground font-medium">
                Vehicle: <strong className="font-mono text-foreground">{visitDetail.vehicle_number || '—'}</strong> · Token:{' '}
                <strong className="font-mono text-foreground tabular-nums">{visitDetail.token_number || '—'}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5 flex-1">
            {/* Read-only summary if portion is already completed */}
            {!isPending && (
              <div className="bg-card border-border space-y-3 rounded-2xl border p-4 text-xs text-secondary-foreground">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">Final decision</span>
                    <span
                      className={cn(
                        'px-3 py-0.5 rounded-md text-xs font-semibold',
                        portion.plant_decision === 'ACCEPTED'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                          : 'bg-rose-50 text-rose-800 border border-rose-300'
                      )}
                    >
                      {portion.plant_decision}
                    </span>
                  </div>
                  {portion.plant_seal_number_entered && (
                    <span className="text-secondary-foreground font-mono text-xs">
                      Seal: <strong className="text-foreground">{portion.plant_seal_number_entered}</strong>
                    </span>
                  )}
                </div>

                {displayRejectionReason && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-900">
                    <p className="font-semibold text-xs">Rejection reason</p>
                    <p className="mt-0.5">{displayRejectionReason}</p>
                  </div>
                )}

                {portion.plant_results && portion.plant_results.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="font-semibold text-foreground">Recorded results</p>
                    <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
                      {portion.plant_results.map((pr) => {
                        const notDone = pr.performanceStatus === 'NOT_PERFORMED';
                        const statusLabel = notDone
                          ? 'Not tested'
                          : pr.isPassed === true
                            ? 'PASS'
                            : pr.isPassed === false
                              ? 'FAIL'
                              : 'Monitoring';
                        const statusClass = notDone
                          ? 'bg-muted text-secondary-foreground border-border'
                          : pr.isPassed === true
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : pr.isPassed === false
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-muted text-secondary-foreground border-border';
                        return (
                          <div key={pr.testId} className="flex items-center justify-between gap-2 p-2 text-xs">
                            <span className="font-medium text-secondary-foreground">{pr.testName}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono font-semibold text-foreground">
                                {notDone
                                  ? '—'
                                  : pr.numericValue != null
                                    ? `${pr.numericValue} ${pr.unit || ''}`.trim()
                                    : pr.textValue || '—'}
                              </span>
                              <span className={cn('rounded border px-2 py-0.5 text-xs font-semibold', statusClass)}>
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Editable Testing Mode */}
            {isPending && (
              <>
                {/* Tanker seal check Section */}
                <div className="rounded-2xl border border-border bg-card p-4 space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                      <h4 className="text-xs font-semibold text-foreground">
                        Seal check
                      </h4>
                    </div>
                    {hasDispatchSeal ? (
                      isSealMatched ? (
                        <span className="px-3 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Seal matches
                        </span>
                      ) : isSealMismatch ? (
                        <span className="px-3 py-0.5 rounded-md text-xs font-semibold bg-muted text-secondary-foreground border border-border-strong">
                          Seal differs (optional)
                        </span>
                      ) : (
                        <span className="px-3 py-0.5 rounded-md text-xs font-semibold bg-muted text-secondary-foreground">
                          Seal not entered (optional)
                        </span>
                      )
                    ) : (
                      <span className="px-3 py-0.5 rounded-md text-xs font-semibold bg-muted text-secondary-foreground">
                        No dispatch seal
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground block">Dispatch seal</span>
                      <div className="mt-1 bg-subtle p-2 rounded-lg border font-mono font-semibold text-foreground text-xs">
                        {portion.seal_number || 'None'}
                      </div>
                    </div>
                    <div>
                      <label htmlFor="qa-entered-seal" className="text-xs font-semibold text-muted-foreground block">
                        Observed tanker seal (optional)
                      </label>
                      <input
                        id="qa-entered-seal"
                        type="text"
                        value={currentEnteredSeal}
                        onChange={(e) => onSealChange(e.target.value)}
                        placeholder="Seal number on tanker"
                        className={cn(
                          'mt-1 w-full min-h-11 rounded-lg border border-border p-2 text-base sm:text-xs font-mono font-semibold focus:outline-hidden focus:border-primary'
                        )}
                      />
                    </div>
                  </div>
                </div>

                {/* Laboratory Test Observations */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="bg-subtle border-b border-border p-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Lab tests ({sortedTests.length})
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground">
                      Required done: <strong className="text-foreground">{performedCount}</strong> / {requiredManualPlantTests.length}
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
                            warningTrigger: t.rule?.warningTrigger,
                            decisionConsequence: t.rule?.decisionConsequence,
                            acceptableOption: t.rule?.acceptableOption,
                            category: t.rule?.ruleCategory,
                            ruleCategory: t.rule?.ruleCategory,
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
                      const uploadState = photoUploadState[`${portion.id}:${t.id}`];
                      const isUploadingPhoto = uploadState?.status === 'uploading';

                      return (
                        <div
                          key={t.id}
                          className={cn(
                            'p-3 space-y-1.5 transition-colors',
                            isOut ? 'bg-rose-50/20' : 'bg-card'
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-[9rem] flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-foreground">{t.testName}</span>
                                <span
                                  className={cn(
                                    'rounded-md px-2 py-0.5 text-xs font-semibold',
                                    isCalculated
                                      ? 'bg-muted text-foreground border border-border'
                                      : t.isRequired
                                      ? 'bg-muted text-foreground border border-border'
                                      : 'bg-muted text-secondary-foreground'
                                  )}
                                >
                                  {isCalculated ? 'Auto' : t.isRequired ? 'Required *' : 'Optional'}
                                </span>
                                {hasCamera && (
                                  <span
                                    className={cn(
                                      'rounded-md border px-2 py-0.5 text-xs font-semibold',
                                      hasPhoto
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                        : 'border-amber-300 bg-amber-50 text-amber-900'
                                    )}
                                  >
                                    {hasPhoto ? 'Photo OK' : 'Photo required'}
                                  </span>
                                )}
                                {chip && (
                                  <span
                                    className={cn(
                                      'rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums',
                                      isOut
                                        ? 'border-rose-300 bg-rose-50 text-rose-800'
                                        : 'border-border-strong bg-subtle text-secondary-foreground'
                                    )}
                                  >
                                    {chip}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                                {t.unit ? `Unit: ${t.unit}` : ''}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isCalculated ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={calcVal != null ? `${calcVal.toFixed(2)} ${t.unit || '%'}` : !lrNum && !fatNum ? 'Awaiting LR and Fat' : !lrNum ? 'Awaiting LR' : 'Awaiting Fat'}
                                    aria-label={t.testName}
                                    className="min-h-11 h-10 w-32 rounded-lg border border-border bg-muted px-2 font-mono text-xs font-semibold text-foreground tabular-nums focus:outline-hidden"
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
                                    'min-h-11 h-10 w-28 rounded-lg border px-2 font-mono text-base sm:text-sm font-semibold tabular-nums text-right sm:text-left focus:outline-hidden focus:ring-2',
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
                                  disabled={isUploadingPhoto}
                                  onClick={() => setCameraTest(t)}
                                  className={cn(
                                    'min-h-11 min-w-11 flex items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50',
                                    hasPhoto
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                      : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                  )}
                                >
                                  {isUploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                                  <span>{isUploadingPhoto ? 'Uploading…' : hasPhoto ? 'Photo saved' : 'Take photo *'}</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {hasCamera && (uploadState || hasPhoto) && (
                            <Progress
                              value={uploadState ? uploadState.progress : 100}
                              status={uploadState ? uploadState.status : 'complete'}
                              variant={
                                uploadState?.status === 'error'
                                  ? 'destructive'
                                  : uploadState?.status === 'complete' || hasPhoto
                                    ? 'success'
                                    : 'default'
                              }
                              size="sm"
                              label={
                                uploadState?.status === 'uploading'
                                  ? 'Uploading photo…'
                                  : uploadState?.status === 'error'
                                    ? 'Photo upload failed'
                                    : 'Photo uploaded (100%)'
                              }
                              showValueLabel
                              className="mt-2"
                            />
                          )}

                          {isAppliedOnly && (
                            <div className="inline-flex items-center text-xs text-muted-foreground font-medium">
                              <span>Optional</span>
                              <InfoTip
                                label="Optional test info"
                                className="-my-2"
                                text="Optional test. No SOP rules applied."
                              />
                            </div>
                          )}
                          {isCalculated && (
                            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
                              <Calculator className="h-3 w-3 shrink-0" />
                              <span>Auto-calculated</span>
                              <InfoTip
                                label="Formula details"
                                className="-my-2"
                                text="Auto-calculated (Richmond)."
                              />
                            </div>
                          )}
                          {!isCalculated && !isAppliedOnly && Boolean(isNumeric ? effectiveVal : state.textValue) && (
                            <p
                              className={cn(
                                'flex items-center gap-1 text-xs font-semibold mt-1',
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
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Your decision
                    </span>
                    {liveDecision && (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            'rounded-md px-3 py-0.5 text-xs font-semibold',
                            systemAccepts
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                              : 'bg-rose-50 text-rose-800 border border-rose-300'
                          )}
                        >
                          System: {systemAccepts ? 'Accept' : 'Reject'}
                        </span>
                        {!systemAccepts && systemRejectReasons.length > 0 && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                aria-label="Why rejected"
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-rose-700 hover:bg-rose-50"
                              >
                                <Info className="h-4 w-4" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 space-y-1.5 p-3 text-xs">
                              <p className="font-semibold text-foreground">Why rejected</p>
                              <ul className="list-disc space-y-1 pl-4 text-secondary-foreground">
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onPersonDecisionChange?.('ACCEPT')}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors',
                        personDecision === 'ACCEPT'
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                          : 'border-border bg-card text-secondary-foreground hover:bg-subtle'
                      )}
                    >
                      {!systemAccepts ? <Send className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      <span>{!systemAccepts ? 'Request AVP to accept' : 'Accept milk'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPersonDecisionChange?.('REJECT')}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors',
                        personDecision === 'REJECT'
                          ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                          : 'border-border bg-card text-secondary-foreground hover:bg-subtle'
                      )}
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Reject milk</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="qa-decision-remarks" className="text-xs font-semibold text-muted-foreground block">
                      Remarks {remarksNeeded ? '*' : '(Optional)'}
                    </label>
                    <input
                      id="qa-decision-remarks"
                      type="text"
                      value={decisionRemarks}
                      onChange={(e) => onDecisionRemarksChange?.(e.target.value)}
                      placeholder={
                        mustRequestAvp
                          ? 'Mandatory: explain why this request should be approved'
                          : personDecision === 'REJECT'
                            ? 'Mandatory rejection reason'
                            : 'Remarks'
                      }
                      className="mt-1 w-full min-h-11 rounded-lg border border-border p-2 text-base sm:text-xs focus:border-primary focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Final Footer Actions */}
                {(() => {
                  const hasUploadingPhoto = Object.entries(photoUploadState).some(
                    ([k, st]) => k.startsWith(`${portion.id}:`) && st.status === 'uploading'
                  );
                  const hasAnyPerformedTest = sortedTests.some((t) => {
                    if (isCalculatedTest(t as LabTestDef & { formulaId?: unknown })) return false;
                    const st = testInputs[t.id];
                    if (!st || st.performanceStatus === 'NOT_PERFORMED') return false;
                    if (t.resultType === 'NUMERIC') return st.numericValue !== '' && Number.isFinite(Number(st.numericValue));
                    return Boolean(st.textValue && st.textValue.trim() !== '');
                  });
                  const needsRemarks = remarksNeeded;
                  const remarksTooShort = needsRemarks && decisionRemarks.trim().length < 3;

                  if (onSavePortion) {
                    return (
                      <div className="space-y-2 pt-2">
                        {hasUploadingPhoto && (
                          <p className="text-xs font-semibold text-amber-800">Wait for photo upload</p>
                        )}
                        {personDecision === 'REJECT' && !hasAnyPerformedTest && (
                          <p className="text-xs font-semibold text-rose-700">
                            Record a test before rejecting.
                          </p>
                        )}
                        {personDecision && remarksTooShort && (
                          <p className="text-xs font-semibold text-amber-800">
                            Add remarks (3 letters minimum).
                          </p>
                        )}
                        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border pt-3">
                          {canRemovePortion && onRemovePortion && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={isSubmitting}
                              onClick={onRemovePortion}
                              className="min-h-11 border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800"
                            >
                              Remove
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="default"
                            size="lg"
                            loading={isSubmitting}
                            loadingText="Saving…"
                            disabled={
                              isSubmitting ||
                              hasUploadingPhoto ||
                              !personDecision ||
                              (personDecision === 'REJECT' && !hasAnyPerformedTest) ||
                              remarksTooShort
                            }
                            onClick={onSavePortion}
                            className="min-h-12 flex-1 bg-emerald-700 px-6 text-base font-semibold text-white hover:bg-emerald-800 sm:flex-initial"
                          >
                            <Check className="h-4 w-4" />
                            <span>Save Portion</span>
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant={personDecision === 'REJECT' ? 'destructive' : 'default'}
                        size="lg"
                        loading={isSubmitting}
                        loadingText={mustRequestAvp ? 'Sending request…' : 'Submitting decision…'}
                        disabled={isSubmitting || !personDecision || (needsRemarks && !decisionRemarks.trim())}
                        onClick={handleSubmit}
                        className="min-h-12 h-auto w-full min-w-0 shrink whitespace-normal rounded-xl px-4 py-3 text-sm font-semibold"
                      >
                        <Send className="h-4 w-4" />
                        <span>
                          {mustRequestAvp
                            ? 'Send request to AVP QA reception lab'
                            : 'Confirm portion decision'}
                        </span>
                      </Button>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Camera Capture - Fullscreen LiveCamera matching Dispatch to Plant form */}
      {cameraTest && (
        <LiveCamera
          stamp={{
            employeeCode: stampEmployeeCode(currentUser),
            roleLabel: stampRoleLabel(currentUser),
            actingAsLabel: null,
            pointLabel: `Plant QA - ${cameraTest.testName}`,
            vehicleNo: visitDetail.vehicle_number || null,
          }}
          onCapture={async (res) => {
            const currentTest = cameraTest;
            const photoKey = `${portion.id}:${currentTest.id}`;
            setCameraTest(null);
            setPhotoUploadState((prev) => ({ ...prev, [photoKey]: { progress: 25, status: 'uploading' } }));
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
              setPhotoUploadState((prev) => ({ ...prev, [photoKey]: { progress: 80, status: 'uploading' } }));
              if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                throw new Error(d.error || 'The photo could not be saved.');
              }
              // Only a photo the server saved counts: keep its address, never the phone-only preview.
              onPhotoChange(currentTest.id, `/api/photos/${res.captureId}`);
              setPhotoUploadState((prev) => ({ ...prev, [photoKey]: { progress: 100, status: 'complete' } }));
            } catch (err) {
              setPhotoUploadState((prev) => ({ ...prev, [photoKey]: { progress: 0, status: 'error' } }));
              console.error('Failed to upload photo:', err);
              toast.error(`Photo for ${currentTest.testName} was not saved. Retake it. ${err instanceof Error ? err.message : ''}`.trim());
            }
          }}
          onCancel={() => setCameraTest(null)}
        />
      )}
    </>
  );
};
