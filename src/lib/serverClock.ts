/**
 * The server's clock, as seen from this device. Phones are often a few minutes fast or slow, so time boxes are filled
 * with the server's "now" instead of the phone's. The difference is learned from the live-update check (every 15 s
 * while signed in) and kept on the device, so it still applies offline.
 */
const KEY = 'milk-server-clock-offset-ms';
/** Differences smaller than this are ordinary network delay, not a wrong clock. */
const IGNORE_BELOW_MS = 2_000;

let offsetMs = 0;
try {
  if (typeof window !== 'undefined') offsetMs = Number(window.localStorage.getItem(KEY)) || 0;
} catch {
  offsetMs = 0;
}

/** The server's current time, worked out on this device (on the server itself: just now). */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** How far the server clock is ahead of this device, in ms (negative: behind). */
export function serverClockOffsetMs(): number {
  return offsetMs;
}

/**
 * Learns the difference from one server answer. sentAt/receivedAt are this device's times around the request, so
 * half the round trip is taken as the network delay.
 */
export function learnServerTime(serverMs: number, sentAt: number, receivedAt: number): void {
  if (!Number.isFinite(serverMs) || receivedAt < sentAt) return;
  const measured = Math.round(serverMs - (sentAt + receivedAt) / 2);
  offsetMs = Math.abs(measured) < IGNORE_BELOW_MS ? 0 : measured;
  try {
    window.localStorage.setItem(KEY, String(offsetMs));
  } catch {
    // Private window or storage blocked: the difference still applies until the page reloads.
  }
}
