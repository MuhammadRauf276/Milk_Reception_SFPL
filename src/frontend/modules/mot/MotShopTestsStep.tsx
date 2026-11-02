'use client';

/**
 * MOT shop tests: every active test of the MOT_SHOP policy is drawn from `policy.tests` (no test
 * names in code). COMPULSORY tests (and the LR / Fat tests the formulas need) are always shown;
 * OPTIONAL tests sit under "More tests". Each card shows the SOP range from the policy rule and,
 * when the policy asks for one, a live-camera picture slot. The parent stores the picture blobs.
 */
import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { LiveCamera } from '@/components/camera/LiveCamera';
import { PhotoEvidenceSlot } from '@/frontend/modules/shared/photo/PhotoEvidenceSlot';
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
  /** Value of the policy test flagged `isLr` (kept apart because the milk formulas need it). */
  lr: string;
  /** Value of the policy test flagged `isFat`. */
  fat: string;
  onLrChange: (v: string) => void;
  onFatChange: (v: string) => void;
  values: Record<string, MotTestValue>;
  onValueChange: (labTestId: string, patch: Partial<MotTestValue>) => void;
  photos: Record<string, MotTestPhoto>;
  onPhotoTaken: (test: MotShopPolicyTest, result: LiveCameraResult) => void;
  onPhotoRemoved: (labTestId: string) => void;
  /** Stamp band text (point label is fixed to 'Shop (MC)'). */
  stamp: { employeeCode: string; roleLabel: string; actingAsLabel?: string | null; vehicleNo?: string | null; tokenNo?: string | null };
  disabled?: boolean;
}

const INPUT_CLASS =
  'h-14 w-full min-w-0 rounded-xl border-2 bg-white px-3 text-xl font-semibold tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60';

function isNumeric(t: MotShopPolicyTest): boolean {
  const rt = (t.resultType || '').toUpperCase();
  return rt === '' || rt === 'NUMERIC' || rt === 'NUMBER' || rt === 'DECIMAL';
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** SOP range text from the policy rule, e.g. "26.0 – 32.0", "≥ 3.5". */
export function sopRangeText(t: MotShopPolicyTest): string | null {
  const min = t.rule?.min ?? null;
  const max = t.rule?.max ?? null;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `≥ ${fmt(min)}`;
  if (max != null) return `≤ ${fmt(max)}`;
  return null;
}

function outsideRange(t: MotShopPolicyTest, raw: string): boolean {
  if (raw.trim() === '') return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const min = t.rule?.min ?? null;
  const max = t.rule?.max ?? null;
  return (min != null && n < min) || (max != null && n > max);
}

/** Tests always on screen: compulsory ones plus the LR / Fat tests. The rest go under "More tests". */
export function splitMotShopTests(policy: MotShopPolicySnapshot | null) {
  const sortByOrder = (a: MotShopPolicyTest, b: MotShopPolicyTest) => {
    const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 999;
    const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 999;
    if (orderA !== orderB) return orderA - orderB;
    return (a.testCode || '').localeCompare(b.testCode || '');
  };
  const active = (policy?.tests ?? []).filter((t) => t.testMode !== 'OFF').sort(sortByOrder);
  const main = active.filter((t) => t.isLr || t.isFat || t.testMode === 'COMPULSORY').sort(sortByOrder);
  const more = active.filter((t) => !main.includes(t)).sort(sortByOrder);
  return { active, main, more };
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
  const { active, main, more } = splitMotShopTests(policy);

  const valueOf = (t: MotShopPolicyTest): string =>
    t.isLr ? lr : t.isFat ? fat : (values[t.labTestId]?.value ?? '');
  const setValue = (t: MotShopPolicyTest, v: string) => {
    if (t.isLr) onLrChange(v);
    else if (t.isFat) onFatChange(v);
    else onValueChange(t.labTestId, { value: v });
  };

  const testCard = (t: MotShopPolicyTest) => {
    const required = t.testMode === 'COMPULSORY' || t.isLr || t.isFat;
    const range = sopRangeText(t);
    const text = values[t.labTestId]?.text ?? '';
    const numeric = isNumeric(t);
    const out = numeric && outsideRange(t, valueOf(t));
    const inputId = `mot-test-${t.labTestId}`;

    return (
      <div key={t.labTestId} className="bg-card border-border space-y-2.5 rounded-2xl border p-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-base font-semibold text-slate-900">
            {t.testName}
            <span
              className={cn(
                'ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide',
                required ? 'bg-primary text-white shadow-2xs' : 'bg-slate-100 text-slate-600'
              )}
            >
              {required ? 'Required *' : 'Optional'}
            </span>
          </label>
          {range && (
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums',
                out ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-300 bg-slate-50 text-slate-700'
              )}
            >
              SOP {range}
            </span>
          )}
        </div>

        {numeric ? (
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            step="any"
            value={valueOf(t)}
            onChange={(e) => setValue(t, e.target.value)}
            disabled={disabled}
            aria-invalid={out || undefined}
            className={cn('min-h-11', INPUT_CLASS, out ? 'border-rose-400 bg-rose-50/40' : 'border-slate-300')}
          />
        ) : t.options && t.options.length > 0 ? (
          <div id={inputId} role="radiogroup" aria-label={t.testName} className="flex flex-wrap gap-2">
            {t.options.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={text === o}
                onClick={() => onValueChange(t.labTestId, { text: text === o ? '' : o })}
                disabled={disabled}
                className={cn(
                  'min-h-12 rounded-xl border-2 px-4 text-base font-semibold transition disabled:opacity-60',
                  text === o ? 'border-primary bg-primary text-white shadow-2xs' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
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
            value={text}
            onChange={(e) => onValueChange(t.labTestId, { text: e.target.value })}
            disabled={disabled}
            className={cn('min-h-11', INPUT_CLASS, 'border-slate-300 text-base')}
          />
        )}

        {out && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Outside SOP range
          </p>
        )}

        {t.photoMode !== 'NONE' && (
          <PhotoEvidenceSlot
            testName={t.testName}
            required={t.photoMode === 'REQUIRED'}
            photo={photos[t.labTestId]}
            employeeCode={stamp.employeeCode}
            onTake={() => setCameraFor(t)}
            onRemove={() => onPhotoRemoved(t.labTestId)}
            disabled={disabled}
          />
        )}
      </div>
    );
  };

  const fallbackField = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="bg-card border-border space-y-2.5 rounded-2xl border p-3 shadow-xs">
      <label htmlFor={id} className="text-base font-semibold text-slate-900">
        {label}
        <span className="ml-2 rounded-full bg-primary px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-white shadow-2xs">
          Required
        </span>
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn('min-h-11', INPUT_CLASS, 'border-slate-300')}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {active.length === 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">
          Test rules not loaded.
        </p>
      )}

      {main.map(testCard)}

      {/* Rules not cached yet: the milk formulas still need LR and Fat, so ask for just those. */}
      {!active.some((t) => t.isLr) && fallbackField('mot-fallback-lr', 'LR reading', lr, onLrChange)}
      {!active.some((t) => t.isFat) && fallbackField('mot-fallback-fat', 'Fat %', fat, onFatChange)}

      {more.length > 0 && (
        <div className="bg-card border-border rounded-2xl border">
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            aria-expanded={showMore}
            className="flex min-h-12 w-full items-center justify-between px-3 text-base font-semibold text-slate-900"
          >
            <span>More tests ({more.length})</span>
            {showMore ? <ChevronUp className="h-5 w-5" aria-hidden="true" /> : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
          </button>
          {showMore && <div className="space-y-3 border-t border-slate-200 p-2.5">{more.map(testCard)}</div>}
        </div>
      )}

      {cameraFor && (
        <LiveCamera
          stamp={{
            employeeCode: stamp.employeeCode,
            roleLabel: stamp.roleLabel,
            actingAsLabel: stamp.actingAsLabel ?? null,
            pointLabel: 'Shop (Mobile Tester)',
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
