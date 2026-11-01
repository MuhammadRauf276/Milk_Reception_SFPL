/**
 * Android Native Bridge Adapter for SFPL Milk Reception MOT
 * Connects the web application running inside Android WebView to the Native Android Service,
 * providing:
 * 1. Persistent Foreground GPS Tracking (runs when screen is locked or app is backgrounded)
 * 2. High-performance SQLite local persistence (mot_offline.db)
 * 3. Native hardware Camera capture with SHA-256 integrity checksums
 * 4. Background synchronization via Android WorkManager
 *
 * When running in a standard desktop browser or non-native PWA, falls back to web standard APIs
 * (IndexedDB, navigator.geolocation) without errors, preserving 100% web compatibility.
 */

export interface NativeGpsStatus {
  isTracking: boolean;
  currentJourneyId: string | null;
  lastFixTimestamp: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
}

export interface NativeOfflineSummary {
  unsyncedCollections: number;
  unsyncedGps: number;
  pendingPhotos: number;
}

export interface NativePhotoResult {
  labTestId: string;
  captureId: string;
  filePath: string;
  sha256Checksum: string;
}

interface RawAndroidBridge {
  isNativeAndroid(): boolean;
  startGpsTracking(journeyId: string, userId: string): boolean;
  stopGpsTracking(): boolean;
  getGpsTrackingStatus(): string;
  saveOfflineCollection(collectionJson: string): string;
  capturePhoto(labTestId: string, clientEventId: string): void;
  getOfflineSummary(ownerUserId?: string): string;
  triggerSyncNow(): void;
  checkBatteryOptimization(): boolean;
  requestIgnoreBatteryOptimization(): void;
  getDeviceIdentity(): string;
  saveDeviceIdentity(uid: string, key: string): void;
  saveActiveSession(userId: string, cookie: string): void;
}

declare global {
  interface Window {
    AndroidBridge?: RawAndroidBridge;
    isNativeAndroidApp?: boolean;
    onNativePhotoCaptured?: (labTestId: string, captureId: string, filePath: string, sha256: string) => void;
  }
}

class AndroidBridgeAdapter {
  private photoCallbacks = new Map<string, (result: NativePhotoResult) => void>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.onNativePhotoCaptured = (labTestId, captureId, filePath, sha256) => {
        const callback = this.photoCallbacks.get(labTestId);
        if (callback) {
          callback({
            labTestId,
            captureId,
            filePath,
            sha256Checksum: sha256,
          });
          this.photoCallbacks.delete(labTestId);
        }
      };
    }
  }

  /**
   * Returns true if currently running inside the native Android container app.
   */
  public isNativeAndroid(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean(window.AndroidBridge && window.AndroidBridge.isNativeAndroid());
    } catch {
      return false;
    }
  }

  /**
   * Starts native Android Foreground Service for continuous GPS tracking.
   * Keeps recording when screen is locked or app is minimized.
   */
  public startGpsTracking(journeyId: string, userId: string): boolean {
    if (this.isNativeAndroid()) {
      try {
        return window.AndroidBridge!.startGpsTracking(journeyId, userId);
      } catch (e) {
        console.error('[AndroidBridge] Failed to start native GPS tracking:', e);
      }
    }
    return false;
  }

  /**
   * Stops native Android Foreground Service.
   */
  public stopGpsTracking(): boolean {
    if (this.isNativeAndroid()) {
      try {
        return window.AndroidBridge!.stopGpsTracking();
      } catch (e) {
        console.error('[AndroidBridge] Failed to stop native GPS tracking:', e);
      }
    }
    return false;
  }

  /**
   * Gets real-time GPS tracking status from the native Android service.
   */
  public getGpsTrackingStatus(): NativeGpsStatus | null {
    if (this.isNativeAndroid()) {
      try {
        const jsonStr = window.AndroidBridge!.getGpsTrackingStatus();
        return JSON.parse(jsonStr) as NativeGpsStatus;
      } catch (e) {
        console.error('[AndroidBridge] Failed to get GPS status:', e);
      }
    }
    return null;
  }

  /**
   * Saves offline collection directly into native SQLite database.
   */
  public async saveOfflineCollection(collectionPayload: Record<string, unknown>): Promise<{ success: boolean; clientEventId?: string; error?: string }> {
    if (this.isNativeAndroid()) {
      try {
        const jsonStr = window.AndroidBridge!.saveOfflineCollection(JSON.stringify(collectionPayload));
        const res = JSON.parse(jsonStr) as { success: boolean; clientEventId?: string; error?: string };
        return res;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown bridge error';
        return { success: false, error: msg };
      }
    }
    return { success: false, error: 'Not running in native Android' };
  }

  /**
   * Triggers native Android Camera capture.
   */
  public capturePhoto(labTestId: string, clientEventId: string, onCaptured: (result: NativePhotoResult) => void): void {
    if (this.isNativeAndroid()) {
      this.photoCallbacks.set(labTestId, onCaptured);
      try {
        window.AndroidBridge!.capturePhoto(labTestId, clientEventId);
      } catch (e) {
        console.error('[AndroidBridge] Failed to launch native camera:', e);
      }
    }
  }

  /**
   * Gets summary of unsynced items from native SQLite database.
   */
  public getOfflineSummary(ownerUserId?: string): NativeOfflineSummary | null {
    if (this.isNativeAndroid()) {
      try {
        const jsonStr = window.AndroidBridge!.getOfflineSummary(ownerUserId);
        return JSON.parse(jsonStr) as NativeOfflineSummary;
      } catch (e) {
        console.error('[AndroidBridge] Failed to get offline summary:', e);
      }
    }
    return null;
  }

  /**
   * Triggers immediate synchronization cycle on native background sync engine.
   */
  public triggerSyncNow(): void {
    if (this.isNativeAndroid()) {
      try {
        window.AndroidBridge!.triggerSyncNow();
      } catch (e) {
        console.error('[AndroidBridge] Failed to trigger sync:', e);
      }
    }
  }

  /**
   * Checks if Android battery optimization is disabled for this app.
   */
  public isBatteryOptimizationIgnored(): boolean {
    if (this.isNativeAndroid()) {
      try {
        return window.AndroidBridge!.checkBatteryOptimization();
      } catch {
        return true;
      }
    }
    return true;
  }

  /**
   * Requests user to disable battery optimization.
   */
  public requestIgnoreBatteryOptimization(): void {
    if (this.isNativeAndroid()) {
      try {
        window.AndroidBridge!.requestIgnoreBatteryOptimization();
      } catch (e) {
        console.error('[AndroidBridge] Failed to request battery optimization ignore:', e);
      }
    }
  }
}

export const androidBridge = new AndroidBridgeAdapter();
