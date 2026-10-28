'use client';

import React, { useEffect, useState } from 'react';
import { Camera, Check, Eye, X, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { LiveCamera } from '@/components/camera/LiveCamera';
import type { LiveCameraResult } from '@/types/captured-photo';

export interface LiveCameraCaptureProps {
  testType: 'LR' | 'FAT' | string;
  stageName: string;
  tokenNo?: string | null;
  vehicleNo?: string | null;
  currentPhotoUrl?: string | null;
  onPhotoCaptured: (dataUrl: string) => void;
  onPhotoCleared?: () => void;
  disabled?: boolean;
  isRequired?: boolean;
  className?: string;
  /** 'form' matches the Dispatch to Plant picture block (full-width, big touch targets). */
  variant?: 'compact' | 'form';
  testName?: string;
}

export const LiveCameraCapture: React.FC<LiveCameraCaptureProps> = ({
  testType,
  stageName,
  tokenNo,
  vehicleNo,
  currentPhotoUrl,
  onPhotoCaptured,
  onPhotoCleared,
  disabled = false,
  isRequired = false,
  className = '',
  variant = 'compact',
  testName,
}) => {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [me, setMe] = useState<{ code: string; role: string }>({ code: 'unknown', role: 'unknown' });

  const testLabel = testType.toUpperCase().includes('FAT') ? 'FAT' : 'LR';

  // The stamp needs the signed-in person; the server remains the source of truth for permissions.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const u = d?.user;
        if (alive && u) setMe({ code: u.employee_code || u.username || 'unknown', role: u.role || 'unknown' });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const handleCaptureClick = () => {
    if (disabled || processing) return;
    setCameraOpen(true);
  };

  const handleResult = async (res: LiveCameraResult) => {
    setCameraOpen(false);
    setProcessing(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(res.blob);
      });
      onPhotoCaptured(dataUrl);
    } catch (err) {
      console.error('[LiveCameraCapture] Processing error:', err);
    } finally {
      setProcessing(false);
    }
  };

  const isForm = variant === 'form';
  const label = testName || testLabel;

  return (
    <div className={`${isForm ? 'block' : 'inline-flex items-center gap-2'} ${className}`}>
      {isForm ? (
        currentPhotoUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setPreviewOpen(true)} title={`View ${label} picture`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentPhotoUrl} alt={`${label} picture`} className="h-12 w-12 rounded-lg border border-border object-cover" />
            </button>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <Check className="h-4 w-4" aria-hidden="true" />
              Picture taken
            </span>
            {!disabled && (
              <>
                <button
                  type="button"
                  onClick={handleCaptureClick}
                  disabled={processing}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-border px-3 text-sm font-semibold text-slate-700 hover:bg-muted disabled:opacity-50"
                >
                  {processing && <Loader2 className="h-4 w-4 animate-spin" />}
                  Again
                </button>
                {onPhotoCleared && (
                  <button
                    type="button"
                    onClick={onPhotoCleared}
                    aria-label={`Remove ${label} picture`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleCaptureClick}
            disabled={disabled || processing}
            className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-50 ${
              isRequired ? 'bg-primary text-white hover:bg-primary-hover' : 'border border-border bg-white text-slate-700 hover:bg-muted'
            }`}
          >
            {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" aria-hidden="true" />}
            {processing ? 'Processing…' : isRequired ? `Take ${label} picture *` : `Take ${label} picture (optional)`}
          </button>
        )
      ) : currentPhotoUrl ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="group relative h-11 w-11 overflow-hidden rounded-lg border border-border bg-card transition hover:border-slate-400"
            title={`View ${testLabel} photo`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentPhotoUrl}
              alt={`${testLabel} observation live capture`}
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
              <Eye className="h-3.5 w-3.5 text-white" />
            </span>
          </button>

          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
            <Check className="h-3 w-3" />
            <span>{testLabel} Photo</span>
          </span>

          {!disabled && (
            <button
              type="button"
              onClick={handleCaptureClick}
              disabled={processing}
              className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
              title={`Retake ${testLabel} photo`}
            >
              {processing && <Loader2 className="h-3 w-3 animate-spin text-slate-600" />}
              <span>Retake</span>
            </button>
          )}

          {!disabled && onPhotoCleared && (
            <button
              type="button"
              onClick={onPhotoCleared}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
              title={`Clear ${testLabel} photo`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={handleCaptureClick}
          disabled={disabled || processing}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition shadow-2xs ${
            isRequired
              ? 'bg-primary text-white hover:bg-primary-hover border border-transparent'
              : 'border border-border bg-white text-slate-700 hover:bg-slate-50'
          } disabled:opacity-50`}
        >
          {processing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          <span>
            {processing ? 'Processing…' : `Take ${testLabel} Photo`}
            {isRequired && <span className="ml-0.5 text-white font-bold">*</span>}
          </span>
        </button>
      )}

      {cameraOpen && (
        <LiveCamera
          stamp={{
            employeeCode: me.code,
            roleLabel: me.role,
            pointLabel: `${stageName} - ${testLabel}`,
            vehicleNo,
            tokenNo,
          }}
          onCapture={(res) => void handleResult(res)}
          onCancel={() => setCameraOpen(false)}
        />
      )}

      {previewOpen && currentPhotoUrl && (
        <Modal
          onClose={() => setPreviewOpen(false)}
          title={`${testLabel} Photo Verification`}
          className="max-w-2xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-sm font-semibold text-foreground">
              {testLabel} Meniscus / Screen Verification
            </span>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative overflow-hidden rounded-lg bg-black flex items-center justify-center max-h-[70vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentPhotoUrl}
              alt={`${testLabel} verification`}
              className="max-h-[70vh] w-auto object-contain"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};
