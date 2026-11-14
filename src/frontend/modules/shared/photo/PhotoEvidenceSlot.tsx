'use client';

/**
 * One picture slot for a test. Empty: a large dashed "Take picture" card. Taken: the untouched
 * preview, a green stamp badge (employee · time · GPS) proving what is burned into the photo,
 * plus Retake / Remove. The camera itself is opened by the parent through `onTake`.
 */
import React from 'react';
import { Camera, CheckCircle2, MapPin, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

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
  uploading?: boolean;
  uploadProgress?: number;
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
  uploading = false,
  uploadProgress,
  className,
}: PhotoEvidenceSlotProps) {
  if (!photo) {
    return (
      <button
        type="button"
        onClick={onTake}
        disabled={disabled || uploading}
        className={cn(
          'flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-base font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          required
            ? 'border-neutral-400 bg-muted text-foreground hover:border-neutral-900 hover:bg-muted active:brightness-95'
            : 'border-border bg-white text-secondary-foreground hover:bg-muted active:brightness-95',
          className
        )}
      >
        <Camera className="h-6 w-6 shrink-0" aria-hidden="true" />
        <span>
          Take {testName} picture{' '}
          <span className={required ? 'text-rose-700 font-semibold' : 'font-normal text-muted-foreground'}>
            ({required ? 'Required' : 'Optional'})
          </span>
        </span>
      </button>
    );
  }

  const gpsText = photo.gps ? `${photo.gps.lat.toFixed(4)}, ${photo.gps.lng.toFixed(4)}` : 'No GPS';

  return (
    <div className={cn('relative overflow-hidden rounded-xl border-2 border-emerald-600 bg-card', className)}>
      {uploading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/85 p-4 backdrop-blur-xs">
          <Progress
            value={uploadProgress ?? undefined}
            label={`Uploading ${testName} photo…`}
            showValueLabel
            status="uploading"
            size="md"
          />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.previewUrl}
        alt={`${testName} picture`}
        className="block max-h-56 w-full bg-neutral-900 object-contain"
      />
      <div className="space-y-2 p-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">
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
        {!uploading && uploadProgress === 100 && (
          <Progress
            value={100}
            variant="success"
            size="sm"
            status="complete"
            label="Photo uploaded (100%)"
            showValueLabel
          />
        )}
        {!uploading && uploadProgress !== 100 && (
          <p className="text-xs font-medium text-emerald-700">Photo ready: uploads on submit</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onTake}
            disabled={disabled || uploading}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-action/30 bg-action-soft px-3 text-sm font-semibold text-action transition-all duration-150 hover:bg-action/15 active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
          >
            <Camera className="h-5 w-5" aria-hidden="true" />
            Retake
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled || uploading}
            aria-label={`Remove ${testName} picture`}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-border bg-white text-secondary-foreground transition-all duration-150 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 active:scale-[0.98] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
