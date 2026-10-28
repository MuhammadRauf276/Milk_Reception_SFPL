'use client';

/**
 * Phone setup (Phase 3): an office person registers this phone for offline sync.
 * 1. Shows this phone's ID (deviceUid) so Super Admin / Data Executive can add it on the Phones screen.
 * 2. Takes the key: scan the QR shown on the Phones screen (JSON {deviceUid, key}) with the camera
 *    (BarcodeDetector + getUserMedia, when the browser has them) or type / paste it. No file input.
 * 3. Saves the key, asks for persistent storage, checks the key with the server and runs one sync.
 * "Remove key" only removes the key; work waiting on this phone is never deleted.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Ban, Camera, CheckCircle2, Copy, KeyRound, Loader2, Smartphone, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clearDeviceKey,
  DEVICE_SYNC_STATE_EVENT,
  getDeviceKey,
  getDeviceSyncState,
  getDeviceUid,
  requestPersistentStorage,
  saveDeviceKey,
  type DeviceSyncState,
} from './deviceIdentity';
import { checkDeviceConnection, runSyncOnce } from './syncEngine';
import { logDeviceEvent } from './diary';
import { InfoTip } from '@/components/ui/info-tip';

const BIG_BTN = 'h-14 min-h-14 w-full px-5 text-base [&_svg]:size-5';

type Banner = { tone: 'ok' | 'error' | 'wait' | 'info'; text: string } | null;

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor || !navigator.mediaDevices?.getUserMedia) return null;
  return ctor;
}

/** Reads the key from typed text: either the bare key or the QR JSON {deviceUid, key}. */
export function parseKeyInput(text: string, myDeviceUid: string): { ok: true; key: string } | { ok: false; error: string } {
  const raw = text.trim();
  if (!raw) return { ok: false, error: 'Type or scan the key first.' };
  if (raw.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'This code is not a phone key.' };
    }
    const rec = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const uid = typeof rec.deviceUid === 'string' ? rec.deviceUid.trim() : '';
    const key = typeof rec.key === 'string' ? rec.key.trim() : '';
    if (!uid || !key) return { ok: false, error: 'This code is not a phone key.' };
    if (uid !== myDeviceUid) return { ok: false, error: 'This code is for another phone. Check the phone ID on the Phones screen.' };
    return { ok: true, key };
  }
  if (/\s/.test(raw) || raw.length > 512) return { ok: false, error: 'The key has spaces or is too long. Check it again.' };
  return { ok: true, key: raw };
}

function stateBanner(state: DeviceSyncState | null, hasKey: boolean): Banner {
  if (!hasKey) return { tone: 'info', text: 'This phone is not set up yet.' };
  if (!state) return { tone: 'wait', text: 'Key saved. Not checked yet.' };
  if (state.state === 'OK') return { tone: 'ok', text: 'Phone is set up' };
  if (state.state === 'BLOCKED') return { tone: 'error', text: state.message || 'This phone is blocked. Ask the office.' };
  return { tone: 'error', text: 'The key is wrong or old. Ask the office for a new key.' };
}

function BannerBox({ banner }: { banner: Banner }) {
  if (!banner) return null;
  const styles = {
    ok: { cls: 'border-border bg-card text-emerald-900', icon: <CheckCircle2 className="size-6 text-emerald-600" aria-hidden /> },
    error: { cls: 'border-border bg-card text-rose-900', icon: <Ban className="size-6 text-rose-600" aria-hidden /> },
    wait: { cls: 'border-border bg-card text-amber-900', icon: <Loader2 className="size-6 animate-spin text-amber-600" aria-hidden /> },
    info: { cls: 'border-sky-300 bg-sky-50 text-sky-900', icon: <AlertCircle className="size-6 text-sky-600" aria-hidden /> },
  }[banner.tone];
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 rounded-lg border-2 p-4 text-lg font-semibold ${styles.cls}`}>
      {styles.icon}
      <span>{banner.text}</span>
    </div>
  );
}

export function DeviceSetupScreen() {
  const [deviceUid, setDeviceUid] = useState<string>('');
  const [hasKey, setHasKey] = useState(false);
  const [syncState, setSyncState] = useState<DeviceSyncState | null>(null);
  const [keyText, setKeyText] = useState('');
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [canScan, setCanScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Bumped by stopScan (and on unmount): a camera stream that arrives for an older scan is stopped. */
  const scanTokenRef = useRef(0);

  const refresh = useCallback(async () => {
    const [uid, key] = await Promise.all([getDeviceUid().catch(() => ''), getDeviceKey().catch(() => null)]);
    setDeviceUid(uid);
    setHasKey(Boolean(key));
    setSyncState(getDeviceSyncState());
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await refresh();
      if (alive) setCanScan(barcodeDetectorCtor() !== null);
    })();
    const onState = () => setSyncState(getDeviceSyncState());
    window.addEventListener(DEVICE_SYNC_STATE_EVENT, onState);
    return () => {
      alive = false;
      window.removeEventListener(DEVICE_SYNC_STATE_EVENT, onState);
    };
  }, [refresh]);

  const stopScan = useCallback(() => {
    scanTokenRef.current++;
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  useEffect(() => stopScan, [stopScan]);

  const verify = useCallback(async () => {
    setBanner({ tone: 'wait', text: 'Checking with the office server…' });
    const check = await checkDeviceConnection();
    if (check.ok) {
      setBanner({ tone: 'ok', text: 'Phone is set up' });
      void logDeviceEvent('DEVICE_SETUP', { result: 'OK' });
      void runSyncOnce({ fresh: true });
    } else {
      setBanner({ tone: 'error', text: check.message });
    }
    await refresh();
  }, [refresh]);

  const saveKey = useCallback(
    async (text: string) => {
      const parsed = parseKeyInput(text, deviceUid);
      if (!parsed.ok) {
        setBanner({ tone: 'error', text: parsed.error });
        return;
      }
      setBusy(true);
      try {
        await saveDeviceKey(parsed.key);
        await requestPersistentStorage();
        setKeyText('');
        await verify();
      } catch {
        setBanner({ tone: 'error', text: 'Could not save the key on this phone. Try again.' });
      } finally {
        setBusy(false);
      }
    },
    [deviceUid, verify]
  );

  const startScan = useCallback(async () => {
    const Ctor = barcodeDetectorCtor();
    if (!Ctor) return;
    setBanner(null);
    const token = ++scanTokenRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (token !== scanTokenRef.current) {
        // Stopped or left the screen while the camera was opening.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setScanning(true);
      // Wait one frame so the <video> element is mounted.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (token !== scanTokenRef.current) return;
      const video = videoRef.current;
      if (!video) throw new Error('no video');
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const detector = new Ctor({ formats: ['qr_code'] });
      let detecting = false;
      scanTimerRef.current = setInterval(() => {
        if (detecting || !videoRef.current || videoRef.current.readyState < 2) return;
        detecting = true;
        detector
          .detect(videoRef.current)
          .then((codes) => {
            const value = codes.find((c) => c.rawValue)?.rawValue;
            if (!value) return;
            stopScan();
            if (!value.trim().startsWith('{')) {
              setBanner({ tone: 'error', text: 'This QR code is not a phone key.' });
              return;
            }
            void saveKey(value);
          })
          .catch(() => undefined)
          .finally(() => {
            detecting = false;
          });
      }, 300);
    } catch {
      if (token !== scanTokenRef.current) return;
      stopScan();
      setBanner({ tone: 'error', text: 'Camera did not open. Type the key instead.' });
    }
  }, [saveKey, stopScan]);

  const copyUid = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(deviceUid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [deviceUid]);

  const removeKey = useCallback(async () => {
    setBusy(true);
    try {
      await logDeviceEvent('DEVICE_KEY_REMOVED');
      await clearDeviceKey();
      setConfirmRemove(false);
      setBanner({ tone: 'info', text: 'Key removed. Work waiting on this phone is kept.' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const shown = banner ?? stateBanner(syncState, hasKey);

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 p-4 pb-28">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Smartphone className="size-7" aria-hidden /> Phone setup
        </h1>
        <p className="flex items-center text-base text-muted-foreground">For office staff<InfoTip text="Set up this phone so it can send work by itself." /></p>
      </header>

      <BannerBox banner={shown} />

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="flex items-center text-lg font-semibold">1. Phone ID<InfoTip text="Add this ID on the Phones screen in the office." /></h2>
        <div className="break-all rounded-md border-2 border-dashed bg-muted/40 p-4 text-center font-mono text-2xl font-bold tracking-wide" aria-label="Phone ID">
          {deviceUid || '...'}
        </div>
        <Button variant="outline" className={BIG_BTN} disabled={!deviceUid} onClick={copyUid}>
          <Copy aria-hidden /> {copied ? 'Copied' : 'Copy phone ID'}
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold">2. Phone key</h2>
        {canScan ? (
          scanning ? (
            <div className="space-y-3">
              <video ref={videoRef} className="aspect-square w-full rounded-md bg-black object-cover" muted playsInline />
              <p className="text-base">Scan the QR code.</p>
              <Button variant="outline" className={BIG_BTN} onClick={stopScan}>
                <X aria-hidden /> Stop camera
              </Button>
            </div>
          ) : (
            <Button className={BIG_BTN} disabled={busy || !deviceUid} onClick={startScan}>
              <Camera aria-hidden /> Scan QR code
            </Button>
          )
        ) : (
          <p className="flex items-center text-base text-muted-foreground">Type the key<InfoTip text="This phone cannot scan QR codes here." /></p>
        )}
        <label className="block space-y-2 text-base font-medium">
          Or type the key
          <input
            className="h-14 w-full rounded-md border border-input bg-card px-3 font-mono text-lg"
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="Key from the Phones screen"
          />
        </label>
        <Button className={BIG_BTN} disabled={busy || !deviceUid || !keyText.trim()} onClick={() => saveKey(keyText)}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />} Save key
        </Button>
      </section>

      {hasKey ? (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-lg font-semibold">Key on this phone</h2>
          <Button variant="outline" className={BIG_BTN} disabled={busy} onClick={() => void verify()}>
            <CheckCircle2 aria-hidden /> Check again
          </Button>
          {confirmRemove ? (
            <div className="space-y-3 rounded-md border-2 border-border bg-card p-3 text-rose-900">
              <p className="text-base font-semibold">Remove the key from this phone?</p>
              <p className="text-base">The phone stops sending by itself until a new key is saved. Work waiting on this phone is kept.</p>
              <Button variant="destructive" className={BIG_BTN} disabled={busy} onClick={removeKey}>
                <Trash2 aria-hidden /> Yes, remove key
              </Button>
              <Button variant="outline" className={BIG_BTN} disabled={busy} onClick={() => setConfirmRemove(false)}>
                <X aria-hidden /> No, keep key
              </Button>
            </div>
          ) : (
            <Button variant="outline" className={BIG_BTN} disabled={busy} onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden /> Remove key
            </Button>
          )}
        </section>
      ) : null}
    </main>
  );
}
