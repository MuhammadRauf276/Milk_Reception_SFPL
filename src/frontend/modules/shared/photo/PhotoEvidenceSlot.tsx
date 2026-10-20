'use client';

/**
 * One picture slot for a test. Empty: a large dashed "Take picture" card. Taken: the untouched
 * preview, a green stamp badge (employee · time · GPS) proving what is burned into the photo,
 * plus Retake / Remove. The camera itself is opened by the parent through `onTake`.
 */
import React from 'react';
import { Camera, CheckCircle2, MapPin, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PhotoEvidence {
  previewUrl: string;
  capturedAt: string;
  gps: { lat: number; lng: number; accuracyM?: number | null } | null;
}

export interface PhotoEvidenceSlotProps {
  testName: string;
  required: boolean;
  photo: PhotoEvidence | null | undefined;
  employeeCode: string;
  onTake: () => void;
  onRemove: () => void;
  disabled?: boolean;
  className?: string;
}

function formatStampTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function PhotoEvidenceSlot({
  testName,
  required,
  photo,
  employeeCode,
  onTake,
  onRemove,
  disabled = false,
  className,
}: PhotoEvidenceSlotProps) {
  if (!photo) {
    return (
      <button
        type="button"
        onClick={onTake}
        disabled={disabled}
        className={cn(
          'flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-base font-semibold transition disabled:opacity-50',
          required
            ? 'border-slate-400 bg-slate-50 text-slate-900 hover:border-slate-900 hover:bg-slate-100'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
          className
        )}
      >
        <Camera className="h-6 w-6 shrink-0" aria-hidden="true" />
        <span>
          Take {testName} picture{' '}
          <span className={required ? 'text-rose-700' : 'font-normal text-slate-500'}>
            ({required ? 'Required' : 'Optional'})
          </span>
        </span>
      </button>
    );
  }

  const gpsText = photo.gps ? `${photo.gps.lat.toFixed(4)}, ${photo.gps.lng.toFixed(4)}` : 'No GPS';

  return (
    <div className={cn('overflow-hidden rounded-xl border-2 border-emerald-600 bg-white', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.previewUrl}
        alt={`${testName} picture`}
        className="block max-h-56 w-full bg-slate-900 object-contain"
      />
      <div className="space-y-2 p-2.5">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Stamped: {employeeCode}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatStampTime(photo.capturedAt)}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-0.5 tabular-nums">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {gpsText}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onTake}
            disabled={disabled}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            Retake
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${testName} picture`}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
