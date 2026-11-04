'use client';

/**
 * Dispatch tests for one portion (Phase 4c). The tests come from the policy of the dispatch point
 * (ZMCC_DISPATCH or CONTRACTOR_DISPATCH). A picture per test when the policy asks for one, with the live camera only.
 * A test left empty is "not tested": it only becomes a problem when the policy says it is compulsory.
 */
import React, { useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Undo2, Trash2 } from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { cn } from '@/lib/utils';
import type { LiveCameraResult } from '@/types/captured-photo';
import { calculatedValuesForPortion } from '@/lib/portion-calculated-values';
import { buildSopChipText, numericSopRange } from '@/lib/sop-chip';
import { isNumericTest, type DispatchPolicyTest } from '../dispatchDecisionPreview';

export interface DispatchPhotoState {
  captureId: string;
  blob: Blob;
  previewUrl: string;
  sha256: string;
  width: number;
  height: number;
  capturedAt: string;
  gps: LiveCameraResult['gps'];
}

export function toPhotoState(res: LiveCameraResult): DispatchPhotoState {
  return {
    captureId: res.captureId,
    blob: res.blob,
    previewUrl: URL.createObjectURL(res.blob),
    sha256: res.sha256,
    width: res.width,
    height: res.height,
    capturedAt: res.capturedAt,
    gps: res.gps,
  };
}

export interface DispatchPolicyTestsProps {
  tests: DispatchPolicyTest[];
  values: Record<string, { numericValue: string; textValue: string }>;
  photos: Record<string, DispatchPhotoState>;
  errors?: Record<string, string>;
  onValueChange: (labTestId: string, field: 'numericValue' | 'textValue', value: string) => void;
  onPhotoTaken: (test: DispatchPolicyTest, result: LiveCameraResult) => void;
  onPhotoRemoved: (labTestId: string) => void;
  stamp: { employeeCode: string; roleLabel: string; actingAsLabel?: string | null; pointLabel: string; vehicleNo?: string | null };
  idPrefix: string;
}

const INPUT_CLASS =
  'w-full min-w-0 min-h-[48px] rounded-xl border bg-subtle p-2.5 text-base font-semibold focus:ring-2 focus:ring-primary focus:outline-none';

/** SOP range text from policy rule, e.g. "26.0 – 32.0", "≥ 3.5". */
export function sopRangeText(t: DispatchPolicyTest): string | null {
  return numericSopRange({ resultType: t.resultType, min: t.rule?.min, max: t.rule?.max });
}

/** Chip text: numeric range for numeric tests, accepted option for categorical ones, null when not configured. */
export function sopChipText(t: DispatchPolicyTest): string | null {
  return buildSopChipText({ resultType: t.resultType, min: t.rule?.min, max: t.rule?.max, allowed: t.rule?.allowed, options: t.options });
}

export function outsideRange(t: DispatchPolicyTest, raw: string): boolean {
  if (!raw || raw.trim() === '') return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const min = t.rule?.min ?? null;
  const max = t.rule?.max ?? null;
  return (min != null && n < min) || (max != null && n > max);
}

export function isDisallowedOption(t: DispatchPolicyTest, val: string): boolean {
  if (!val || !val.trim()) return false;
  const allowed = t.rule?.allowed;
  if (!allowed || allowed.length === 0) return false;
  const upper = val.trim().toUpperCase();
  return !allowed.some((a) => a.trim().toUpperCase() === upper);
}

export function DispatchPolicyTests({
  tests,
  values,
  photos,
  errors = {},
  onValueChange,
  onPhotoTaken,
  onPhotoRemoved,
  stamp,
  idPrefix,
}: DispatchPolicyTestsProps) {
  const [cameraFor, setCameraFor] = useState<DispatchPolicyTest | null>(null);
  const active = tests.filter((t) => t.testMode !== 'OFF');
  // SNF, Total Solids and the ratio are worked out from this portion's LR and Fat, never typed.
  const calculated = calculatedValuesForPortion(active, (t) => values[t.labTestId]?.numericValue);

  if (active.length === 0) {
    return <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-sm text-slate-600">No tests needed.</p>;
  }

  const photoBlock = (t: DispatchPolicyTest) => {
    if (t.photoMode === 'NONE' || t.labTestId in calculated) return null;
    const photo = photos[t.labTestId];
    const required = t.photoMode === 'REQUIRED';
    if (photo) {
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt={`${t.testName} picture`} className="h-12 w-12 rounded-lg border border-border object-cover" />
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Picture taken
          </span>
          <button
            type="button"
            onClick={() => setCameraFor(t)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-muted"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Again
          </button>
          <button
            type="button"
            onClick={() => onPhotoRemoved(t.labTestId)}
            aria-label={`Remove ${t.testName} picture`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border text-slate-500 hover:bg-rose-50 hover:text-rose-700"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setCameraFor(t)}
        className={cn(
          'mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition',
          required ? 'bg-primary text-white hover:bg-primary-hover' : 'border border-border bg-white text-slate-700 hover:bg-muted'
        )}
      >
        <Camera className="h-5 w-5" aria-hidden="true" />
        {required ? `Take ${t.testName} picture *` : `Take ${t.testName} picture (optional)`}
      </button>
    );
  };

  const hasInput = (t: DispatchPolicyTest) => {
    const v = values[t.labTestId];
    return Boolean(v?.numericValue || v?.textValue || photos[t.labTestId] || errors[t.labTestId]);
  };
  // LR, Fat and compulsory tests first; the rest sit in a collapsible list (opened when something is filled).
  const primary = active.filter((t) => t.testMode === 'COMPULSORY' || t.isLr || t.isFat || hasInput(t));
  const more = active.filter((t) => !primary.includes(t));

  const renderTest = (t: DispatchPolicyTest) => {
    const v = values[t.labTestId] ?? { numericValue: '', textValue: '' };
    const err = errors[t.labTestId];
    const inputId = `${idPrefix}-${t.labTestId}`;
    const range = sopRangeText(t);
    const chip = sopChipText(t);
    const numeric = isNumericTest(t);
    const isOut = numeric ? outsideRange(t, v.numericValue) : isDisallowedOption(t, v.textValue);
    const isCalc = t.labTestId in calculated;
    const calcValue = isCalc ? calculated[t.labTestId] : null;
    const isRequired = t.testMode === 'COMPULSORY' && !isCalc;

    return (
      <div
        key={t.labTestId}
        className={cn(
          'rounded-xl border p-3 space-y-2 transition shadow-2xs',
          err || isOut ? 'border-rose-300 bg-rose-50/20' : 'border-border bg-white'
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-semibold text-foreground flex items-center">
            {t.testName}
            <span
              className={cn(
                'ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide',
                isRequired ? 'bg-primary text-white shadow-2xs' : 'bg-slate-100 text-slate-600'
              )}
            >
              {isCalc ? 'Auto' : isRequired ? 'Required *' : 'Optional'}
            </span>
          </label>
          {chip && (
            <span
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums',
                isOut ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-300 bg-slate-50 text-slate-700'
              )}
            >
              {chip}
            </span>
          )}
        </div>

        {t.testMode === 'COMPULSORY' && !t.rule && (
          <p className="text-xs text-slate-500">No rule.</p>
        )}

        {isCalc ? (
          <input
            id={inputId}
            type="text"
            readOnly
            disabled
            aria-readonly="true"
            value={calcValue !== null ? calcValue.toFixed(2) : ''}
            placeholder="Auto"
            className={cn('min-h-11', INPUT_CLASS, 'border-border bg-muted text-slate-600 cursor-not-allowed')}
          />
        ) : numeric ? (
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={v.numericValue}
            onChange={(e) => onValueChange(t.labTestId, 'numericValue', e.target.value)}
            aria-invalid={isOut || undefined}
            className={cn('min-h-11', 
              INPUT_CLASS,
              isOut ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500' : 'border-border'
            )}
          />
        ) : t.options && t.options.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.testName}>
            {t.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onValueChange(t.labTestId, 'textValue', v.textValue === o ? '' : o)}
                aria-pressed={v.textValue === o}
                className={cn(
                  'min-h-[44px] rounded-xl border-2 px-3.5 text-sm font-semibold transition',
                  v.textValue === o
                    ? isOut
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-primary bg-primary text-white'
                    : 'border-border bg-white text-slate-700 hover:bg-muted'
                )}
              >
                {o}
              </button>
            ))}
          </div>
        ) : (
          <input
            id={inputId}
            type="text"
            value={v.textValue}
            onChange={(e) => onValueChange(t.labTestId, 'textValue', e.target.value)}
            className={cn('min-h-11', 
              INPUT_CLASS,
              isOut ? 'border-rose-400 bg-rose-50/40 text-rose-950' : 'border-border'
            )}
          />
        )}

        {isOut && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Outside SOP range {range ? `(${range})` : ''}
          </p>
        )}

        {err && <p className="mt-1 text-xs font-semibold text-rose-700">{err}</p>}
        {photoBlock(t)}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {primary.map((t) => renderTest(t))}
      {more.length > 0 && (
        <details className="rounded-xl border border-dashed border-border-strong">
          <summary className="flex min-h-[48px] cursor-pointer items-center justify-between px-3 text-sm font-semibold text-slate-700">
            More tests ({more.length})
          </summary>
          <div className="space-y-3 p-2.5 pt-0">{more.map((t) => renderTest(t))}</div>
        </details>
      )}

      {cameraFor && (
        <LiveCamera
          stamp={{
            employeeCode: stamp.employeeCode,
            roleLabel: stamp.roleLabel,
            actingAsLabel: stamp.actingAsLabel ?? null,
            pointLabel: `${stamp.pointLabel} - ${cameraFor.testName}`,
            vehicleNo: stamp.vehicleNo ?? null,
          }}
          onCapture={(res) => {
            const t = cameraFor;
            setCameraFor(null);
            onPhotoTaken(t, res);
          }}
          onCancel={() => setCameraFor(null)}
        />
      )}
    </div>
  );
}
