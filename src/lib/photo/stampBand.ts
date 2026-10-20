// Pure layout for the stamp band drawn BELOW the photo (never over the image). No DOM access.
import type { StampInfo } from '@/types/captured-photo';

export interface StampGps {
  lat: number;
  lng: number;
  accuracyM: number;
}

export interface StampBandLayout {
  bandTop: number;
  bandHeight: number;
  totalHeight: number;
  lines: string[];
  fontPx: number;
  lineHeightPx: number;
  paddingPx: number;
}

/** Date and time in Pakistan time, e.g. "2026-10-20 14:05:09 PKT". */
export function formatPkt(date: Date): string {
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
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}:${map.second} PKT`;
}

export function buildStampLines(info: StampInfo, capturedAt: Date, gps: StampGps | null): string[] {
  const lines: string[] = [];
  lines.push(`Employee: ${info.employeeCode}`);
  lines.push(
    info.actingAsLabel
      ? `Role ${info.roleLabel} acting as ${info.actingAsLabel}`
      : `Role: ${info.roleLabel}`
  );
  lines.push(`Point: ${info.pointLabel}`);
  lines.push(`Time: ${formatPkt(capturedAt)}`);
  lines.push(
    gps
      ? `GPS: ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} ±${Math.round(gps.accuracyM)} m`
      : 'GPS: not available'
  );
  const vehicle = info.vehicleNo?.trim();
  const token = info.tokenNo?.trim();
  if (vehicle || token) {
    const bits: string[] = [];
    if (vehicle) bits.push(`Vehicle: ${vehicle}`);
    if (token) bits.push(`Token: ${token}`);
    lines.push(bits.join('  |  '));
  }
  lines.push(`Photo ID: ${info.captureId}`);
  if (info.offline) lines.push('OFFLINE - taken without internet');
  return lines;
}

export function layoutStampBand(
  photoWidth: number,
  photoHeight: number,
  info: StampInfo,
  capturedAt: Date,
  gps: StampGps | null
): StampBandLayout {
  const lines = buildStampLines(info, capturedAt, gps);
  const fontPx = Math.max(14, Math.round(photoWidth / 45));
  const lineHeightPx = Math.round(fontPx * 1.4);
  const paddingPx = Math.round(fontPx * 0.6);
  const bandHeight = lines.length * lineHeightPx + paddingPx * 2;
  return {
    bandTop: photoHeight,
    bandHeight,
    totalHeight: photoHeight + bandHeight,
    lines,
    fontPx,
    lineHeightPx,
    paddingPx,
  };
}
