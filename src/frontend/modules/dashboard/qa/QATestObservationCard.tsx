'use client';

import React from 'react';
import { AlertTriangle, Calculator } from 'lucide-react';
import { LiveCameraCapture } from '@/components/camera/LiveCameraCapture';
import { cn } from '@/lib/utils';
import { isDisallowedOption, outsideRange, sopRangeText } from '@/frontend/modules/forms/components/DispatchPolicyTests';
import type { DispatchPolicyTest } from '@/frontend/modules/forms/dispatchDecisionPreview';
import type { LabTestDef, TestInputState, TestPerformanceStatus } from './qaTypes';

const DEFAULT_STATE: TestInputState = {
  performanceStatus: 'PERFORMED',
  notPerformedReason: '',
  numericValue: '',
  textValue: '',
};

export interface QATestObservationCardProps {
  test: LabTestDef;
  state: TestInputState | undefined;
  portionId: string;
  tokenNumber: string | null;
  vehicleNumber: string;
  photoUrl: string | null;
  calculatedValue?: number | null;
  isCalculated?: boolean;
  onPerformanceStatusChange?: (testId: string, status: TestPerformanceStatus) => void;
  onNumericChange: (testId: string, value: string) => void;
  onTextChange: (testId: string, value: string) => void;
  onReasonChange?: (testId: string, value: string) => void;
  onCapturePhoto: (testId: string, url: string) => void;
  onClearPhoto: (testId: string) => void;
}

/**
 * Plant QA Lab test observation card matching the Dispatch to Plant form standard.
 * Features:
 * - Direct, clean test input without per-test toggles (blank = unperformed; entered = performed)
 * - Distinct requirement badges (Required * vs Optional)
 * - Auto-calculated test support (SNF, Total Solids, Ratio) with live Richmond formula
 * - Applied tests non-enforcement: shows "Not under SOP — Optional test, system rules not applied"
 * - SOP Range Pill with real-time pass / out-of-SOP visual feedback
 * - Touch-friendly min-h-[48px] numeric inputs and min-h-[44px] qualitative choice pills
 * - Live inline out-of-SOP warning alerts directly on the card
 * - Live camera verification with stamp and photo preview
 */
export const QATestObservationCard: React.FC<QATestObservationCardProps> = ({
  test,
  state: stateProp,
  portionId: _portionId,
  tokenNumber,
  vehicleNumber,
  photoUrl,
  calculatedValue,
  isCalculated: isCalculatedProp,
  onNumericChange,
  onTextChange,
  onCapturePhoto,
  onClearPhoto,
}) => {
  const state = stateProp || DEFAULT_STATE;
  const codeUpper = (test.testCode || '').toUpperCase();
  const nameUpper = (test.testName || '').toUpperCase();

  const isCategorical = test.resultType === 'POSITIVE_NEGATIVE' || test.resultType === 'OK_NOT_OK' || test.resultType === 'BOOLEAN';
  const isCalculated =
    !isCategorical && (
      Boolean(isCalculatedProp) ||
      test.resultType === 'CALCULATED' ||
      Boolean((test as any).formulaId) ||
      codeUpper === 'SYS-SNF' ||
      codeUpper === 'SYS-TS' ||
      codeUpper === 'SNF' ||
      codeUpper === 'TS' ||
      codeUpper === 'RATIO' ||
      nameUpper === 'SNF' ||
      nameUpper.includes('SOLIDS-NOT-FAT') ||
      nameUpper.includes('SNF TO FAT RATIO') ||
      nameUpper.includes('RATIO SNF/FAT') ||
      nameUpper === 'TOTAL SOLIDS'
    );

  const isAppliedOnly = !test.isRequired;

  const effectiveNumericVal = isCalculated && calculatedValue != null
    ? String(calculatedValue.toFixed(2))
    : state.numericValue;

  const hasValue = Boolean(
    (test.resultType === 'NUMERIC' || isCalculated)
      ? effectiveNumericVal !== ''
      : state.textValue !== ''
  );

  const isLR = codeUpper.includes('LR') || nameUpper.includes('LR') || nameUpper.includes('LACTOMETER');
  const isFAT = codeUpper.includes('FAT') || nameUpper.includes('FAT') || nameUpper.includes('GERBER');
  const isPhotoEligible = (isLR || isFAT || Boolean(test.isPhotoRequired)) && !isCalculated;

  const selectedOption = Array.isArray(test.resultOptions)
    ? test.resultOptions.find((o) => o.value === state.textValue)
    : null;

  const ruleTest = { rule: test.rule ?? null } as DispatchPolicyTest;

  // System rules are only enforced for compulsory tests!
  const isQualitativeFail =
    hasValue &&
    (Boolean(selectedOption && selectedOption.isPassing === false) || isDisallowedOption(ruleTest, state.textValue));

  const isNumericFail = !isCalculated && hasValue && outsideRange(ruleTest, effectiveNumericVal);
  const isOut = isNumericFail || isQualitativeFail;
  const range = sopRangeText(ruleTest);
  const sopHint = range ? `SOP ${range}` : null;

  return (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-2 transition shadow-2xs',
        isOut
          ? 'border-rose-300 bg-rose-50/20'
          : hasValue
            ? 'border-border bg-white'
            : 'border-border bg-subtle'
      )}
    >
      {/* Header: Test Name, Requirement Badge, SOP Range Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-sm font-semibold text-foreground truncate" title={test.testName}>
              {test.testName}
            </span>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                isCalculated
                  ? 'bg-purple-100 text-purple-900 border border-purple-300'
                  : test.isRequired
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600'
              )}
            >
              {isCalculated ? 'AUTO (Formula)' : test.isRequired ? 'Required *' : 'Optional (Applied)'}
            </span>
          </div>
          <span className="text-xs font-mono text-slate-500 block mt-0.5">{test.testCode}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {sopHint && (
            <span
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums',
                isNumericFail ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-300 bg-slate-50 text-slate-700'
              )}
            >
              {sopHint}
            </span>
          )}
          {test.unit && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums">
              {test.unit}
            </span>
          )}
        </div>
      </div>

      {/* Test Input Area */}
      {isCalculated ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 block">
              Auto-Calculated Value {test.unit ? `(${test.unit})` : ''}
            </label>
            <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
              <Calculator className="h-3 w-3" />
              <span>Richmond Canonical Formula</span>
            </span>
          </div>
          <input
            type="text"
            readOnly
            value={calculatedValue != null ? `${calculatedValue.toFixed(2)} ${test.unit || '%'}` : ''}
            placeholder="Auto-calculating (awaiting LR & Fat)…"
            className="w-full min-w-0 min-h-[48px] rounded-xl border border-purple-200 bg-purple-50/40 p-3 text-base font-bold text-purple-950 tabular-nums focus:outline-hidden"
          />
          <p className="text-[11px] text-purple-800 font-medium">
            Calculated automatically from Lactometer Reading (LR) and Fat. Preserves canonical milk solids balance.
          </p>
        </div>
      ) : test.resultType === 'NUMERIC' ? (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 block">
            Observed Value {test.unit ? `(${test.unit})` : ''}
          </label>
          <input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={state.numericValue}
            onChange={(e) => onNumericChange(test.id, e.target.value)}
            placeholder={`Enter observation value ${test.unit ? `in ${test.unit}` : ''}`}
            aria-invalid={isNumericFail || undefined}
            className={cn(
              'w-full min-w-0 min-h-[48px] rounded-xl border bg-subtle p-3 text-base font-semibold focus:ring-2 focus:outline-hidden transition tabular-nums',
              isNumericFail
                ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                : 'border-border focus:border-primary focus:ring-primary/20'
            )}
          />
          {isAppliedOnly && !hasValue && (
            <p className="text-[11px] text-slate-500 font-medium">
              Optional test — leave blank if not conducted.
            </p>
          )}
        </div>
      ) : Array.isArray(test.resultOptions) && test.resultOptions.length > 0 ? (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 block">Select Observation Result</label>
          <div className="flex flex-wrap gap-2" role="group" aria-label={test.testName}>
            {test.resultOptions.map((opt) => {
              const isSelected = state.textValue === opt.value;
              const isOptionFail = opt.isPassing === false;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onTextChange(test.id, isSelected ? '' : opt.value)}
                  aria-pressed={isSelected}
                  className={cn(
                    'min-h-[44px] rounded-xl border-2 px-3.5 text-sm font-semibold transition',
                    isSelected
                      ? isOptionFail && !isAppliedOnly
                        ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                        : 'border-primary bg-primary text-white shadow-xs'
                      : 'border-border bg-white text-slate-700 hover:bg-muted'
                  )}
                >
                  {opt.label || opt.value}
                </button>
              );
            })}
          </div>
          {isAppliedOnly && !hasValue && (
            <p className="text-[11px] text-slate-500 font-medium">
              Optional test — leave blank if not conducted.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 block">Observation Notes / Findings</label>
          <input
            type="text"
            value={state.textValue}
            onChange={(e) => onTextChange(test.id, e.target.value)}
            placeholder="Enter observation notes / findings"
            className={cn(
              'w-full min-w-0 min-h-[48px] rounded-xl border bg-subtle p-3 text-base font-semibold focus:ring-2 focus:ring-primary focus:outline-hidden transition',
              isQualitativeFail ? 'border-rose-400 bg-rose-50/40 text-rose-950' : 'border-border'
            )}
          />
          {isAppliedOnly && !hasValue && (
            <p className="text-[11px] text-slate-500 font-medium">
              Optional test — leave blank if not conducted.
            </p>
          )}
        </div>
      )}

      {/* Out of range alert */}
      {isOut && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {isQualitativeFail ? 'Does not meet the acceptable specification.' : `Outside SOP range${sopHint ? ` (${sopHint.replace('SOP ', '')})` : ''}`}
        </p>
      )}

      {/* Live Camera Proof */}
      {isPhotoEligible && (
        <LiveCameraCapture
          variant="form"
          testType={isFAT ? 'FAT' : 'LR'}
          testName={test.testName}
          stageName="Plant QA Reception"
          tokenNo={tokenNumber}
          vehicleNo={vehicleNumber}
          currentPhotoUrl={photoUrl}
          onPhotoCaptured={(url) => onCapturePhoto(test.id, url)}
          onPhotoCleared={() => onClearPhoto(test.id)}
          isRequired={test.isRequired}
          className="w-full"
        />
      )}
    </div>
  );
};
