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
        setErrorText('This phone or browser cannot use the camera. Please open the app on the work phone.');
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
            ? 'Camera is blocked. Please allow the camera for this app, then press Try again.'
            : 'No camera found or the camera is busy. Close other apps that use the camera, then press Try again.'
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

  const handleRetake = () => {
    setResult(null);
    setPreviewUrl(null);
    setAttempt((n) => n + 1);
  };

  const camera = (
    <div data-live-camera className="pointer-events-auto fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-base font-semibold">{stamp.pointLabel}</span>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15"
          aria-label="Close camera"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`max-h-full max-w-full object-contain ${phase === 'live' || phase === 'working' ? '' : 'hidden'}`}
        />
        {phase === 'review' && previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Photo you just took" className="max-h-full max-w-full object-contain" />
        )}
        {phase === 'starting' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-base">Starting camera. If asked, press Allow.</p>
          </div>
        )}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <TriangleAlert className="h-10 w-10 text-amber-400" />
            <p className="text-base">{errorText}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex h-14 items-center gap-2 rounded-xl bg-card px-6 text-base font-bold text-slate-900"
            >
              <Undo2 className="h-5 w-5" />
              Try again
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-4">
        {(phase === 'live' || phase === 'working') && (
          <button
            type="button"
            onClick={() => void handleTake()}
            disabled={phase === 'working'}
            className="inline-flex h-14 min-w-[220px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-lg font-bold text-white disabled:opacity-60"
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
              className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-card/15 px-4 text-base font-bold"
            >
              <Undo2 className="h-5 w-5" />
              Retake
            </button>
            <button
              type="button"
              onClick={() => onCapture(result)}
              className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-base font-bold text-white"
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
