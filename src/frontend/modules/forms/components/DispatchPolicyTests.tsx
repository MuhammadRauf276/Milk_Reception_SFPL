'use client';

/**
 * Dispatch tests for one portion (Phase 4c). The tests come from the policy of the dispatch point
 * (ZMCC_DISPATCH or CONTRACTOR_DISPATCH). A picture per test when the policy asks for one, with the live camera only.
 * A test left empty is "not tested": it only becomes a problem when the policy says it is compulsory.
 */
import React, { useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { cn } from '@/lib/utils';
import type { LiveCameraResult } from '@/types/captured-photo';
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
  'w-full min-w-0 min-h-[48px] rounded-xl border border-border bg-subtle p-2.5 text-base font-semibold focus:ring-2 focus:ring-primary';

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

  if (active.length === 0) {
    return <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-sm text-slate-600">No tests are needed here.</p>;
  }

  const photoBlock = (t: DispatchPolicyTest) => {
    if (t.photoMode === 'NONE') return null;
    const photo = photos[t.labTestId];
    const required = t.photoMode === 'REQUIRED';
    if (photo) {
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt={`${t.testName} picture`} className="h-12 w-12 rounded-lg border border-border object-cover" />
          <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Picture taken
          </span>
          <button
            type="button"
            onClick={() => setCameraFor(t)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Again
          </button>
          <button
            type="button"
            onClick={() => onPhotoRemoved(t.labTestId)}
            aria-label={`Remove ${t.testName} picture`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border text-slate-500 hover:bg-red-50 hover:text-red-700"
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

  return (
    <div className="space-y-3">
      {active.map((t) => {
        const v = values[t.labTestId] ?? { numericValue: '', textValue: '' };
        const err = errors[t.labTestId];
        const inputId = `${idPrefix}-${t.labTestId}`;
        return (
          <div key={t.labTestId} className={cn('rounded-xl border p-2.5', err ? 'border-red-400 bg-red-50/30' : 'border-border')}>
            <label htmlFor={inputId} className="mb-1 block text-sm font-semibold text-foreground">
              {t.testName}
              {t.testMode === 'COMPULSORY' ? <span className="text-red-700"> *</span> : <span className="ml-1 text-xs font-normal text-slate-500">(optional)</span>}
            </label>
            {isNumericTest(t) ? (
              <input
                id={inputId}
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={v.numericValue}
                onChange={(e) => onValueChange(t.labTestId, 'numericValue', e.target.value)}
                className={INPUT_CLASS}
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
                      'min-h-[48px] rounded-xl border-2 px-4 text-sm font-semibold transition',
                      v.textValue === o ? 'border-primary bg-primary text-white' : 'border-border bg-white text-slate-700 hover:bg-muted'
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
                className={INPUT_CLASS}
              />
            )}
            {err && <p className="mt-1 text-xs font-semibold text-red-700">{err}</p>}
            {photoBlock(t)}
          </div>
        );
      })}

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
