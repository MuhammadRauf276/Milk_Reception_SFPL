'use client';

import React, { useRef, useState } from 'react';
import { Camera, Check, Eye, X, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

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
}

function formatPktTimestamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
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
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const testLabel = testType.toUpperCase().includes('FAT') ? 'FAT' : 'LR';

  const handleCaptureClick = () => {
    if (disabled || processing) return;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const getGpsCoords = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !navigator.geolocation) {
        return resolve(null);
      }
      const timeout = setTimeout(() => resolve(null), 2500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timeout);
          resolve({
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
          });
        },
        () => {
          clearTimeout(timeout);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 2500, maximumAge: 10000 }
      );
    });
  };

  const processImageFile = async (file: File) => {
    setProcessing(true);
    try {
      const gps = await getGpsCoords();
      const gpsText = gps ? `${gps.lat}, ${gps.lng}` : 'N/A';
      const timestampText = formatPktTimestamp();

      const imageBitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const maxDim = 1280;
      let width = imageBitmap.width;
      let height = imageBitmap.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      ctx.drawImage(imageBitmap, 0, 0, width, height);

      const headerHeight = Math.max(54, Math.round(height * 0.085));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(0, 0, width, headerHeight);

      const headerTitleSize = Math.max(14, Math.round(headerHeight * 0.32));
      const headerSubSize = Math.max(11, Math.round(headerHeight * 0.24));

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${headerTitleSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = 'top';
      const cleanStage = (stageName || 'PLANT QA').trim().toUpperCase();
      ctx.fillText(`SHAKARGANJ · ${cleanStage}`, 16, Math.round(headerHeight * 0.16));

      ctx.fillStyle = '#cbd5e1';
      ctx.font = `600 ${headerSubSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      const cleanVehicle = (vehicleNo || 'N/A').trim();
      const cleanToken = (tokenNo || 'N/A').trim();
      ctx.fillText(
        `Test: ${testLabel} · Vehicle: ${cleanVehicle} · Token: ${cleanToken}`,
        16,
        Math.round(headerHeight * 0.54)
      );

      const footerHeight = Math.max(38, Math.round(height * 0.055));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(0, height - footerHeight, width, footerHeight);

      const footerFontSize = Math.max(11, Math.round(footerHeight * 0.38));
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `600 ${footerFontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `TIMESTAMP: ${timestampText} PKT  |  GPS: ${gpsText}`,
        16,
        height - Math.round(footerHeight / 2)
      );

      const watermarked = canvas.toDataURL('image/jpeg', 0.82);
      onPhotoCaptured(watermarked);
    } catch (err) {
      console.error('[LiveCameraCapture] Processing error:', err);
    } finally {
      setProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processImageFile(file);
    }
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {currentPhotoUrl ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="group relative h-9 w-9 overflow-hidden rounded-lg border border-border bg-slate-100 transition hover:border-slate-400"
            title={`View ${testLabel} photo`}
          >
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
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
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
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition shadow-2xs ${
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
              className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative overflow-hidden rounded-lg bg-black flex items-center justify-center max-h-[70vh]">
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
