'use client';

/**
 * MOT shop tests (Phase 4a): LR + Fat and every COMPULSORY test of the MOT_SHOP policy are shown;
 * OPTIONAL tests sit under "More tests". A picture per test when the policy asks for one
 * (REQUIRED or OPTIONAL), taken with the live camera only. The parent stores the picture blobs.
 */
import React, { useState } from 'react';
import { Camera, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Trash2 } from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { cn } from '@/lib/utils';
import type { LiveCameraResult } from '@/types/captured-photo';
import type { MotShopPolicySnapshot, MotShopPolicyTest } from '@/types/stage1-decision';

export interface MotTestPhoto {
  captureId: string;
  previewUrl: string;
  sha256: string;
  width: number;
  height: number;
  capturedAt: string;
  gps: LiveCameraResult['gps'];
}

export interface MotTestValue {
  value: string;
  text: string;
}

export interface MotShopTestsStepProps {
  policy: MotShopPolicySnapshot | null;
  lr: string;
  fat: string;
  onLrChange: (v: string) => void;
  onFatChange: (v: string) => void;
  values: Record<string, MotTestValue>;
  onValueChange: (labTestId: string, patch: Partial<MotTestValue>) => void;
  photos: Record<string, MotTestPhoto>;
  onPhotoTaken: (test: MotShopPolicyTest, result: LiveCameraResult) => void;
  onPhotoRemoved: (labTestId: string) => void;
  /** Stamp band text (point label is fixed to 'Shop (MOT)'). */
  stamp: { employeeCode: string; roleLabel: string; actingAsLabel?: string | null; vehicleNo?: string | null; tokenNo?: string | null };
  disabled?: boolean;
}

const INPUT_CLASS =
  'w-full min-w-0 min-h-[48px] rounded-xl border border-border bg-subtle p-2.5 text-base font-semibold focus:ring-2 focus:ring-primary';

function isNumeric(t: MotShopPolicyTest): boolean {
  const rt = (t.resultType || '').toUpperCase();
  return rt === '' || rt === 'NUMERIC' || rt === 'NUMBER' || rt === 'DECIMAL';
}

export function MotShopTestsStep({
  policy,
  lr,
  fat,
  onLrChange,
  onFatChange,
  values,
  onValueChange,
  photos,
  onPhotoTaken,
  onPhotoRemoved,
  stamp,
  disabled = false,
}: MotShopTestsStepProps) {
  const [cameraFor, setCameraFor] = useState<MotShopPolicyTest | null>(null);
  const [showMore, setShowMore] = useState(false);

  const active = (policy?.tests ?? []).filter((t) => t.testMode !== 'OFF');
  const lrTest = active.find((t) => t.isLr) ?? null;
  const fatTest = active.find((t) => t.isFat) ?? null;
  const others = active.filter((t) => !t.isLr && !t.isFat);
  const compulsory = others.filter((t) => t.testMode === 'COMPULSORY');
  const optional = others.filter((t) => t.testMode === 'OPTIONAL');

  const photoBlock = (t: MotShopPolicyTest | null) => {
    if (!t || t.photoMode === 'NONE') return null;
    const photo = photos[t.labTestId];
    const required = t.photoMode === 'REQUIRED';
    if (photo) {
      return (
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt={`${t.testName} picture`} className="h-12 w-12 rounded-lg border border-border object-cover" />
          <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Picture taken
          </span>
          <button
            type="button"
            onClick={() => setCameraFor(t)}
            disabled={disabled}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Again
          </button>
          <button
            type="button"
            onClick={() => onPhotoRemoved(t.labTestId)}
            disabled={disabled}
            aria-label={`Remove ${t.testName} picture`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
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
        disabled={disabled}
        className={cn(
          'mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-50',
          required ? 'bg-primary text-white hover:bg-primary-hover' : 'border border-border bg-white text-slate-700 hover:bg-muted'
        )}
      >
        <Camera className="h-5 w-5" aria-hidden="true" />
        {required ? `Take ${t.testName} picture *` : `Take ${t.testName} picture (optional)`}
      </button>
    );
  };

  const testInput = (t: MotShopPolicyTest) => {
    const v = values[t.labTestId] ?? { value: '', text: '' };
    const label = (
      <label className="mb-1 block text-sm font-semibold text-foreground">
        {t.testName}
        {t.testMode === 'COMPULSORY' && <span className="text-red-700"> *</span>}
      </label>
    );
    if (isNumeric(t)) {
      return (
        <div key={t.labTestId} className="rounded-xl border border-border p-2.5">
          {label}
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={v.value}
            onChange={(e) => onValueChange(t.labTestId, { value: e.target.value })}
            disabled={disabled}
            className={INPUT_CLASS}
          />
          {photoBlock(t)}
        </div>
      );
    }
    if (t.options && t.options.length > 0) {
      return (
        <div key={t.labTestId} className="rounded-xl border border-border p-2.5">
          {label}
          <div className="flex flex-wrap gap-2">
            {t.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onValueChange(t.labTestId, { text: v.text === o ? '' : o })}
                disabled={disabled}
                aria-pressed={v.text === o}
                className={cn(
                  'min-h-[48px] rounded-xl border-2 px-4 text-sm font-semibold transition',
                  v.text === o ? 'border-primary bg-primary text-white' : 'border-border bg-white text-slate-700 hover:bg-muted'
                )}
              >
                {o}
              </button>
            ))}
          </div>
          {photoBlock(t)}
        </div>
      );
    }
    return (
      <div key={t.labTestId} className="rounded-xl border border-border p-2.5">
        {label}
        <input
          type="text"
          value={v.text}
          onChange={(e) => onValueChange(t.labTestId, { text: e.target.value })}
          disabled={disabled}
          className={INPUT_CLASS}
        />
        {photoBlock(t)}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {!policy && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Test rules are not on this phone yet. Connect to the internet once so they can load.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-2.5">
          <label className="mb-1 block text-sm font-semibold text-foreground">
            LR reading <span className="text-red-700">*</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="20"
            max="35"
            value={lr}
            onChange={(e) => onLrChange(e.target.value)}
            placeholder="e.g. 28.5"
            disabled={disabled}
            className={INPUT_CLASS}
            required
          />
          {photoBlock(lrTest)}
        </div>
        <div className="rounded-xl border border-border p-2.5">
          <label className="mb-1 block text-sm font-semibold text-foreground">
            Fat % <span className="text-red-700">*</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="1.5"
            max="12"
            value={fat}
            onChange={(e) => onFatChange(e.target.value)}
            placeholder="e.g. 4.2"
            disabled={disabled}
            className={INPUT_CLASS}
            required
          />
          {photoBlock(fatTest)}
        </div>
      </div>

      {compulsory.length > 0 && <div className="space-y-3">{compulsory.map(testInput)}</div>}

      {optional.length > 0 && (
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            aria-expanded={showMore}
            className="flex min-h-[48px] w-full items-center justify-between px-3 text-sm font-semibold text-foreground"
          >
            <span>More tests ({optional.length})</span>
            {showMore ? <ChevronUp className="h-5 w-5" aria-hidden="true" /> : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
          </button>
          {showMore && <div className="space-y-3 border-t border-border p-2.5">{optional.map(testInput)}</div>}
        </div>
      )}

      {cameraFor && (
        <LiveCamera
          stamp={{
            employeeCode: stamp.employeeCode,
            roleLabel: stamp.roleLabel,
            actingAsLabel: stamp.actingAsLabel ?? null,
            pointLabel: 'Shop (MOT)',
            vehicleNo: stamp.vehicleNo ?? null,
            tokenNo: stamp.tokenNo ?? null,
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
