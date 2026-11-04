// Draws a video frame or image element plus the stamp band (below the photo) to a canvas and exports a hashed JPEG. Browser only.
import type { LiveCameraResult, StampInfo } from '@/types/captured-photo';
import { layoutStampBand } from './stampBand';

// Evidence photos: sharp enough to read a meter, a seal or the stamp, without filling the phone or the server.
const MAX_LONG_SIDE = 1600;
const JPEG_QUALITIES = [0.82, 0.75, 0.68];
const TARGET_BYTES = 400 * 1024;

/** The first quality that fits the target. A very detailed photo stops at the lowest one rather than losing clarity. */
export async function encodeWithinTarget(
  encode: (quality: number) => Promise<Blob>,
  qualities: readonly number[] = JPEG_QUALITIES,
  targetBytes: number = TARGET_BYTES
): Promise<Blob> {
  let blob: Blob | null = null;
  for (const quality of qualities) {
    blob = await encode(quality);
    if (blob.size <= targetBytes) return blob;
  }
  if (!blob) throw new Error('Could not save the photo.');
  return blob;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function captureFrame(
  source: HTMLVideoElement | HTMLImageElement,
  stamp: Omit<StampInfo, 'captureId'>,
  gps: LiveCameraResult['gps']
): Promise<LiveCameraResult> {
  const isVideo = 'videoWidth' in source;
  const srcW = isVideo ? (source as HTMLVideoElement).videoWidth : ((source as HTMLImageElement).naturalWidth || (source as HTMLImageElement).width);
  const srcH = isVideo ? (source as HTMLVideoElement).videoHeight : ((source as HTMLImageElement).naturalHeight || (source as HTMLImageElement).height);
  if (!srcW || !srcH) throw new Error('Camera is not ready yet.');

  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(srcW, srcH));
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);

  const captureId = crypto.randomUUID();
  const capturedDate = new Date();
  const layout = layoutStampBand(width, height, { ...stamp, captureId }, capturedDate, gps);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = layout.totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the photo.');

  ctx.drawImage(source, 0, 0, width, height);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, layout.bandTop, width, layout.bandHeight);
  ctx.font = `600 ${layout.fontPx}px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  layout.lines.forEach((line, i) => {
    const y = layout.bandTop + layout.paddingPx + i * layout.lineHeightPx + layout.lineHeightPx / 2;
    ctx.fillStyle = line.startsWith('OFFLINE') ? '#fbbf24' : '#ffffff';
    ctx.fillText(line, layout.paddingPx, y, width - layout.paddingPx * 2);
  });

  // Hashed after compressing, so the stored photo is exactly the one the hash proves.
  const blob = await encodeWithinTarget(
    (quality) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the photo.'))), 'image/jpeg', quality);
      })
  );
  const sha256 = await sha256Hex(blob);

  return {
    captureId,
    blob,
    sha256,
    width,
    height: layout.totalHeight,
    capturedAt: capturedDate.toISOString(),
    gps,
  };
}
