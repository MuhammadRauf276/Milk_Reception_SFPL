'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { LiveCameraCapture } from '@/components/camera/LiveCameraCapture';
import { cn } from '@/lib/utils';
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
  onPerformanceStatusChange: (testId: string, status: TestPerformanceStatus) => void;
  onNumericChange: (testId: string, value: string) => void;
  onTextChange: (testId: string, value: string) => void;
  onReasonChange: (testId: string, value: string) => void;
  onCapturePhoto: (testId: string, url: string) => void;
  onClearPhoto: (testId: string) => void;
}

/**
 * Plant QA Lab test observation card matching the Dispatch to Plant form standard.
 * Features:
 * - Clean rounded-xl card with distinct requirement badges (Required * vs Optional)
 * - SOP Range Pill with real-time pass/out-of-range visual feedback
 * - Touch-friendly min-h-[48px] numeric inputs and min-h-[44px] qualitative choice pills
 * - Live camera verification with stamp and photo preview
 */
export const QATestObservationCard: React.FC<QATestObservationCardProps> = ({
  test,
  state: stateProp,
  portionId: _portionId,
  tokenNumber,
  vehicleNumber,
  photoUrl,
  onPerformanceStatusChange,
  onNumericChange,
  onTextChange,
  onReasonChange,
  onCapturePhoto,
  onClearPhoto,
}) => {
  const state = stateProp || DEFAULT_STATE;
  const isPerformed = state.performanceStatus === 'PERFORMED';
  const codeUpper = (test.testCode || '').toUpperCase();
  const nameUpper = (test.testName || '').toUpperCase();
  const isLR = codeUpper.includes('LR') || nameUpper.includes('LR') || nameUpper.includes('LACTOMETER');
  const isFAT = codeUpper.includes('FAT') || nameUpper.includes('FAT') || nameUpper.includes('GERBER');
  const isPhotoEligible = isLR || isFAT || Boolean(test.isPhotoRequired);

  const selectedOption = Array.isArray(test.resultOptions)
    ? test.resultOptions.find((o) => o.value === state.textValue)
    : null;
  const isQualitativeFail = Boolean(selectedOption && selectedOption.isPassing === false);

  const numVal = state.numericValue !== '' && !isNaN(Number(state.numericValue)) ? Number(state.numericValue) : null;
  const isNumericFail = (isLR && numVal !== null && numVal < 26.0) || (isFAT && numVal !== null && numVal < 3.0);
  const sopHint = isLR ? 'SOP ≥ 28.0' : isFAT ? 'SOP ≥ 3.5' : null;

  const hasPhoto = Boolean(photoUrl);

  return (
    <div
      className={cn(
        'rounded-xl border p-4 space-y-3 transition shadow-2xs',
        isPerformed
          ? isNumericFail || isQualitativeFail
            ? 'border-rose-300 bg-rose-50/20'
            : 'border-border-strong bg-white'
          : 'border-slate-300 bg-slate-50/70'
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
                test.isRequired ? 'bg-primary text-white shadow-2xs' : 'bg-slate-100 text-slate-600'
              )}
            >
              {test.isRequired ? 'Required *' : 'Optional'}
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

      {/* Mode Selector: Performed vs Not Performed */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
        <button
          type="button"
          onClick={() => onPerformanceStatusChange(test.id, 'PERFORMED')}
          className={cn(
            'min-h-10 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1',
            isPerformed
              ? 'bg-white text-foreground shadow-xs border border-border-strong font-bold'
              : 'text-slate-600 hover:text-foreground'
          )}
        >
          <span>Performed</span>
        </button>
        <button
          type="button"
          onClick={() => onPerformanceStatusChange(test.id, 'NOT_PERFORMED')}
          className={cn(
            'min-h-10 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1',
            !isPerformed
              ? 'bg-rose-50 text-rose-800 border border-rose-300 font-bold shadow-xs'
              : 'text-slate-600 hover:text-foreground'
          )}
        >
          <span>Not Performed</span>
        </button>
      </div>

      {/* Test Input Area */}
      {isPerformed ? (
        test.resultType === 'NUMERIC' ? (
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
                'w-full min-w-0 min-h-[48px] rounded-xl border bg-subtle p-3 text-base font-semibold focus:ring-2 focus:outline-none transition tabular-nums',
                isNumericFail
                  ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                  : 'border-border focus:border-primary focus:ring-primary/20'
              )}
            />
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
                        ? isOptionFail
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
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">Observation Notes / Findings</label>
            <input
              type="text"
              value={state.textValue}
              onChange={(e) => onTextChange(test.id, e.target.value)}
              placeholder="Enter observation notes / findings"
              className="w-full min-w-0 min-h-[48px] rounded-xl border border-border bg-subtle p-3 text-base font-semibold focus:ring-2 focus:ring-primary focus:outline-none transition"
            />
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-rose-800 block">Reason Test Was Not Performed *</label>
          <input
            type="text"
            value={state.notPerformedReason}
            onChange={(e) => onReasonChange(test.id, e.target.value)}
            placeholder="Explain why this test could not be conducted…"
            className="w-full min-w-0 min-h-[48px] rounded-xl border border-rose-300 bg-rose-50/50 p-3 text-sm font-medium text-rose-950 focus:ring-2 focus:ring-rose-500 focus:outline-none transition"
          />
        </div>
      )}

      {/* Out of range alert */}
      {isPerformed && (isNumericFail || isQualitativeFail) && (
        <div className="flex items-center gap-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>
            {isQualitativeFail
              ? 'Observation does not meet acceptable quality specification.'
              : `Observation is outside standard SOP limits (${sopHint || ''}).`}
          </span>
        </div>
      )}

      {/* Live Camera Proof */}
      {isPerformed && isPhotoEligible && (
        <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Verification Photo:</span>
            {hasPhoto ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Photo Attached
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">Live camera capture required</span>
            )}
          </div>
          <LiveCameraCapture
            testType={isFAT ? 'FAT' : 'LR'}
            stageName="Plant QA Reception"
            tokenNo={tokenNumber}
            vehicleNo={vehicleNumber}
            currentPhotoUrl={photoUrl}
            onPhotoCaptured={(url) => onCapturePhoto(test.id, url)}
            onPhotoCleared={() => onClearPhoto(test.id)}
            isRequired={test.isRequired}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
};
