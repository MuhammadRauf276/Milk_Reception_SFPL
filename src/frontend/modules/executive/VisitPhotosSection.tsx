'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/empty-state';
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
        <div className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-subtle p-2 text-center text-xs font-semibold text-muted-foreground">
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
      <p className="break-words text-xs font-semibold text-foreground">{label}</p>
      <p className="text-xs tabular-nums text-muted-foreground">{formatOperationalDatetime(photo.capturedAt)}</p>
      {photo.capturedBy && <p className="break-words text-xs text-muted-foreground">{photo.capturedBy}</p>}
    </div>
  );
}

function StageColumn({ title, photos }: { title: string; photos: VisitPhoto[] }) {
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <h5 className="text-xs font-semibold text-muted-foreground">{title}</h5>
      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No photo</p>
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
    <div className="p-5 rounded-2xl bg-card border border-border space-y-4 shadow-2xs">
      <div className="flex items-center space-x-2 border-b border-border/60 pb-2">
        <Camera className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-foreground">Test photos</h3>
      </div>

      {query.isPending ? (
        <p className="text-xs text-muted-foreground">Loading photos…</p>
      ) : query.isError ? (
        <ErrorState description="Could not load the photos." onRetry={() => void query.refetch()} />
      ) : photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No photos attached to this visit.</p>
      ) : (
        <div className="space-y-4">
          {portionNumbers.map((portionNumber) => (
            <div key={portionNumber ?? 'vehicle'} className="bg-card border-border p-4 rounded-2xl border space-y-3">
              <h4 className="text-xs font-semibold text-foreground">{portionTitle(portionNumber)}</h4>
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
