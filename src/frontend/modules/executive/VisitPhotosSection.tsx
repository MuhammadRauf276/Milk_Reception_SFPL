'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, ImageOff } from 'lucide-react';
import { fetchJson } from '@/lib/query/fetchJson';
import { formatOperationalDatetime } from '@/lib/datetime-utils';
import type { VisitPhoto, VisitPhotoStage } from '@/backend/services/photo/visitPhotoService';

const portionTitle = (portionNumber: number | null) =>
  portionNumber == null ? 'Whole vehicle' : `Portion #P-${String(portionNumber).padStart(2, '0')}`;

function photoLabel(photo: VisitPhoto): string {
  if (photo.testName) return photo.testName;
  return photo.photoKind === 'LAB_REPORT' ? 'Lab report' : 'Photo';
}

function PhotoTile({ photo }: { photo: VisitPhoto }) {
  const [missing, setMissing] = useState(false);
  const label = photoLabel(photo);
  const src = `/api/photos/${photo.captureId}`;

  return (
    <div className="w-28 space-y-1">
      {missing ? (
        <div className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-subtle p-2 text-center text-[11px] font-semibold text-slate-500">
          <ImageOff className="h-4 w-4" aria-hidden="true" />
          <span>Image file missing</span>
        </div>
      ) : (
        <a href={src} target="_blank" rel="noreferrer" aria-label={`Open photo: ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${src}?w=320`}
            alt={label}
            loading="lazy"
            onError={() => setMissing(true)}
            className="h-28 w-28 rounded-xl border border-border object-cover shadow-2xs transition hover:opacity-90"
          />
        </a>
      )}
      <p className="break-words text-xs font-semibold text-slate-900">{label}</p>
      <p className="text-[11px] tabular-nums text-slate-500">{formatOperationalDatetime(photo.capturedAt)}</p>
      {photo.capturedBy && <p className="break-words text-[11px] text-slate-500">{photo.capturedBy}</p>}
    </div>
  );
}

function StageColumn({ title, photos }: { title: string; photos: VisitPhoto[] }) {
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h5>
      {photos.length === 0 ? (
        <p className="text-xs text-slate-500">No photo</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <PhotoTile key={photo.captureId} photo={photo} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The photos attached to a visit's tests, laid out per portion with dispatch first, then plant. */
export function VisitPhotosSection({ visitId }: { visitId: number }) {
  const query = useQuery({
    queryKey: ['executive', 'visit-photos', visitId],
    queryFn: ({ signal }) => fetchJson<{ photos: VisitPhoto[] }>(`/api/executive/visits/${visitId}/photos`, { signal }),
  });
  const photos = query.data?.photos ?? [];

  const portionNumbers = Array.from(new Set(photos.map((p) => p.portionNumber))).sort((a, b) => {
    if (a == null) return -1;
    if (b == null) return 1;
    return a - b;
  });
  const photosFor = (portionNumber: number | null, stage: VisitPhotoStage) =>
    photos.filter((p) => p.portionNumber === portionNumber && p.stage === stage);

  return (
    <div className="p-5 rounded-xl bg-card border border-border space-y-4 shadow-2xs">
      <div className="flex items-center space-x-2 border-b border-border/60 pb-2">
        <Camera className="w-4 h-4 text-primary" />
        <h3 className="text-xs font-semibold text-foreground">Attached Test Photos</h3>
      </div>

      {query.isPending ? (
        <p className="text-xs text-slate-500">Loading photos…</p>
      ) : query.isError ? (
        <p className="text-xs font-semibold text-rose-800" role="alert">
          Could not load the photos.
        </p>
      ) : photos.length === 0 ? (
        <p className="text-xs text-slate-500">No photos attached to this visit.</p>
      ) : (
        <div className="space-y-4">
          {portionNumbers.map((portionNumber) => (
            <div key={portionNumber ?? 'vehicle'} className="bg-card border-border p-4 rounded-xl border space-y-3">
              <h4 className="text-xs font-semibold text-slate-900">{portionTitle(portionNumber)}</h4>
              <div className="flex flex-col gap-4 sm:flex-row">
                <StageColumn title="Dispatch" photos={photosFor(portionNumber, 'DISPATCH')} />
                {portionNumber != null && <StageColumn title="Plant" photos={photosFor(portionNumber, 'PLANT')} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
