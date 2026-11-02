'use client';

import { createPortal } from 'react-dom';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Undo2, TriangleAlert, Check, X } from 'lucide-react';
import { captureFrame } from '@/lib/photo/captureFrame';
import type { LiveCameraResult, StampInfo } from '@/types/captured-photo';

export interface LiveCameraProps {
  /** Text for the stamp band. captureId and offline are filled in automatically. */
  stamp: Omit<StampInfo, 'captureId' | 'offline'>;
  onCapture: (result: LiveCameraResult) => void;
  onCancel: () => void;
}

type Phase = 'starting' | 'live' | 'error' | 'working' | 'review';

function isPhone(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function getGpsOnce(): Promise<LiveCameraResult['gps']> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 15000 }
    );
  });
}

export const LiveCamera: React.FC<LiveCameraProps> = ({ stamp, onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gpsRef = useRef<Promise<LiveCameraResult['gps']> | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [errorText, setErrorText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LiveCameraResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Start the camera. `cancelled` makes StrictMode's double mount safe: the first run's stream is stopped as soon as it arrives.
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setErrorText('This phone or browser cannot use the WebRTC camera. You can use your device native camera below.');
        setPhase('error');
        return;
      }
      setPhase('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: isPhone()
            ? { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        if (cancelled) return;
        gpsRef.current = getGpsOnce();
        setPhase('live');
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name;
        setErrorText(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera is blocked by browser or system permissions.'
            : 'No camera found or the camera is busy. Close other camera apps, then press Try again.'
        );
        setPhase('error');
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [attempt, stopStream]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleTake = async () => {
    const video = videoRef.current;
    if (!video || phase !== 'live') return;
    setPhase('working');
    try {
      const gps = (await gpsRef.current) ?? null;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const res = await captureFrame(video, { ...stamp, offline }, gps);
      stopStream();
      setResult(res);
      setPreviewUrl(URL.createObjectURL(res.blob));
      setPhase('review');
    } catch {
      setErrorText('Could not take the photo. Please press Try again.');
      setPhase('error');
    }
  };

  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase('working');
    try {
      const gps = (await gpsRef.current) ?? null;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image file'));
        img.src = objectUrl;
      });
      const res = await captureFrame(img, { ...stamp, offline }, gps);
      URL.revokeObjectURL(objectUrl);
      stopStream();
      setResult(res);
      setPreviewUrl(URL.createObjectURL(res.blob));
      setPhase('review');
    } catch {
      setErrorText('Could not process photo file. Please try again.');
      setPhase('error');
    }
  };

  const handleRetake = () => {
    setResult(null);
    setPreviewUrl(null);
    setAttempt((n) => n + 1);
  };

  const camera = (
    <div data-live-camera className="pointer-events-auto fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3 pt-safe">
        <span className="text-base font-semibold">{stamp.pointLabel}</span>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 transition-colors"
          aria-label="Close camera"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`max-h-full max-w-full object-contain rounded-lg ${phase === 'live' || phase === 'working' ? '' : 'hidden'}`}
        />
        {phase === 'review' && previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Photo you just took" className="max-h-full max-w-full object-contain rounded-lg shadow-lg" />
        )}
        {phase === 'starting' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            <p className="text-base font-medium">Starting camera… If prompted, press Allow.</p>
          </div>
        )}
        {phase === 'working' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-base font-medium">Applying security stamp and hashing photo…</p>
          </div>
        )}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 px-6 text-center max-w-md">
            <TriangleAlert className="h-10 w-10 text-amber-400" />
            <p className="text-base font-semibold text-rose-300">{errorText}</p>

            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 text-xs text-left space-y-2 text-slate-300 w-full shadow-inner">
              <p className="font-semibold text-amber-300">How to unblock permissions in Chrome:</p>
              <ol className="list-decimal pl-4 space-y-1.5 text-slate-300 text-[11px] leading-relaxed">
                <li>Click the <strong>Tune / Padlock</strong> icon on the left of the URL bar (next to <code className="text-emerald-400">mpd.sfpl.com.pk</code>).</li>
                <li>Set <strong>Camera</strong> to <strong>Allow</strong>.</li>
                <li>Set <strong>Location</strong> to <strong>Allow</strong>.</li>
                <li>In Windows Settings &rarr; Privacy &rarr; Verify <em>&quot;Let desktop apps access your camera/location&quot;</em> is <strong>ON</strong>.</li>
              </ol>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="inline-flex h-12 w-full flex-1 items-center justify-center gap-2 rounded-xl bg-card px-4 text-sm font-bold text-slate-900 shadow hover:bg-slate-100 transition-colors"
              >
                <Undo2 className="h-4 w-4" />
                Try again
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-12 w-full flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white shadow hover:bg-sky-500 transition-colors"
              >
                <Camera className="h-4 w-4" />
                Device Camera / Upload
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileCapture}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {(phase === 'live' || phase === 'working') && (
          <button
            type="button"
            onClick={() => void handleTake()}
            disabled={phase === 'working'}
            className="inline-flex h-14 min-w-[220px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-lg font-bold text-white shadow-lg disabled:opacity-60 hover:bg-emerald-600 transition-colors"
          >
            {phase === 'working' ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            {phase === 'working' ? 'Please wait' : 'Take photo'}
          </button>
        )}
        {phase === 'review' && result && (
          <>
            <button
              type="button"
              onClick={handleRetake}
              className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-white/15 px-4 text-base font-bold hover:bg-white/25 transition-colors"
            >
              <Undo2 className="h-5 w-5" />
              Retake
            </button>
            <button
              type="button"
              onClick={() => onCapture(result)}
              className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-base font-bold text-white shadow-lg hover:bg-emerald-600 transition-colors"
            >
              <Check className="h-5 w-5" />
              Use this photo
            </button>
          </>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? camera : createPortal(camera, document.body);
};
