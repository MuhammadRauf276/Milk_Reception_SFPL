/**
 * Device activity diary ("black box"): small DEVICE_EVENT items sent through the sync queue.
 * The server stores them as DeviceActivityEvent (idempotent by clientUuid).
 * Logging never throws and never blocks the UI.
 */
import { enqueueSyncItem, getEngineOwnerUserId, SYNC_ERROR_EVENT } from './syncEngine';
import { getActiveOwnerUserId, hasDeviceKeySync } from './deviceIdentity';

export type DeviceEventType =
  | 'APP_OPEN'
  | 'LOGIN'
  | 'LOGOUT_ATTEMPT'
  | 'LOGOUT'
  | 'GPS_OFF'
  | 'GPS_ON'
  | 'LOW_BATTERY'
  | 'SYNC_ERROR'
  | 'DEVICE_SETUP'
  | 'DEVICE_KEY_REMOVED'
  | (string & {});

const SYNC_ERROR_THROTTLE_MS = 30 * 60 * 1000;
const LOW_BATTERY_LEVEL = 0.15;

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Queues one diary event. Returns the clientUuid, or null when it was not stored
 * (no signed-in user and no device key: the server could not attribute it).
 * With a device key and nobody signed in, ownerUserId is '' and the server attributes the
 * event to the device and its assigned user. If the server refuses a diary event, the phone
 * drops it (syncQueueCore.applyResults): it is never shown as 'needs office help'.
 * Payload (server handleDeviceEvent): { eventType, details, occurredAt, online }.
 * Types the server writes itself (e.g. LOGIN, STATION_PIN_*) are stored as CLIENT_<type>
 * (CLIENT_LOGIN), so the phone's own record never looks like the server's.
 */
export async function logDeviceEvent(
  type: DeviceEventType,
  details?: Record<string, unknown> | null,
  opts?: { ownerUserId?: string | null }
): Promise<string | null> {
  try {
    const owner = opts?.ownerUserId ?? getEngineOwnerUserId() ?? getActiveOwnerUserId();
    if (!owner && !hasDeviceKeySync()) return null;
    const clientUuid = newUuid();
    const occurredAt = new Date().toISOString();
    await enqueueSyncItem({
      clientUuid,
      kind: 'DEVICE_EVENT',
      ownerUserId: owner ?? '',
      capturedAt: occurredAt,
      payload: {
        eventType: String(type).slice(0, 50),
        details: details ?? null,
        occurredAt,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      },
    });
    return clientUuid;
  } catch {
    return null;
  }
}

type BatteryLike = EventTarget & { level: number; charging: boolean };

/**
 * Starts automatic diary listeners: GPS permission off/on, low battery, sync errors (throttled).
 * Returns a cleanup function. Safe to call more than once (each call needs its own cleanup).
 */
export function startDeviceDiary(): () => void {
  if (typeof window === 'undefined') return () => {};
  const cleanups: Array<() => void> = [];
  let disposed = false;

  // Sync errors: at most one diary entry per 30 minutes (avoid filling the queue with errors).
  let lastSyncErrorAt = 0;
  const onSyncError = (e: Event) => {
    const now = Date.now();
    if (now - lastSyncErrorAt < SYNC_ERROR_THROTTLE_MS) return;
    lastSyncErrorAt = now;
    void logDeviceEvent('SYNC_ERROR', (e as CustomEvent<Record<string, unknown>>).detail ?? null);
  };
  window.addEventListener(SYNC_ERROR_EVENT, onSyncError);
  cleanups.push(() => window.removeEventListener(SYNC_ERROR_EVENT, onSyncError));

  // GPS permission changes.
  try {
    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          if (disposed) return;
          let last = status.state;
          const onChange = () => {
            const next = status.state;
            if (next === last) return;
            last = next;
            void logDeviceEvent(next === 'granted' ? 'GPS_ON' : 'GPS_OFF', { permission: next });
          };
          status.addEventListener('change', onChange);
          cleanups.push(() => status.removeEventListener('change', onChange));
        })
        .catch(() => undefined);
    }
  } catch {
    // Permissions API not available.
  }

  // Low battery (Chromium only).
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery === 'function') {
      void nav
        .getBattery()
        .then((battery) => {
          if (disposed) return;
          let warned = false;
          const check = () => {
            const low = battery.level <= LOW_BATTERY_LEVEL && !battery.charging;
            if (low && !warned) {
              warned = true;
              void logDeviceEvent('LOW_BATTERY', { level: Math.round(battery.level * 100) });
            } else if (!low) {
              warned = false;
            }
          };
          check();
          battery.addEventListener('levelchange', check);
          battery.addEventListener('chargingchange', check);
          cleanups.push(() => {
            battery.removeEventListener('levelchange', check);
            battery.removeEventListener('chargingchange', check);
          });
        })
        .catch(() => undefined);
    }
  } catch {
    // Battery API not available.
  }

  return () => {
    disposed = true;
    cleanups.splice(0).forEach((fn) => fn());
  };
}

/** Records a GPS signal change seen by a page (e.g. geolocation watch error / recovery). */
export function logGpsSignal(on: boolean, details?: Record<string, unknown>): Promise<string | null> {
  return logDeviceEvent(on ? 'GPS_ON' : 'GPS_OFF', details ?? null);
}
