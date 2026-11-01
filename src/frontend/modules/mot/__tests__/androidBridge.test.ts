import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { androidBridge } from '../native/androidBridge';

describe('Phase 4: Android Native Bridge Adapter', () => {

  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore window mock
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      // @ts-expect-error test teardown
      delete globalThis.window;
    }
  });

  test('isNativeAndroid returns false when window.AndroidBridge is undefined (desktop/browser)', () => {
    // @ts-expect-error test mock
    globalThis.window = {};
    assert.equal(androidBridge.isNativeAndroid(), false);
  });

  test('isNativeAndroid returns true when window.AndroidBridge is present', () => {
    // @ts-expect-error test mock
    globalThis.window = {
      AndroidBridge: {
        isNativeAndroid: () => true,
        startGpsTracking: () => true,
        stopGpsTracking: () => true,
        getGpsTrackingStatus: () => '{}',
        saveOfflineCollection: () => '{}',
        capturePhoto: () => {},
        getOfflineSummary: () => '{}',
        triggerSyncNow: () => {},
        checkBatteryOptimization: () => true,
        requestIgnoreBatteryOptimization: () => {},
        getDeviceIdentity: () => '{}',
        saveDeviceIdentity: () => {},
        saveActiveSession: () => {},
      },
    };
    assert.equal(androidBridge.isNativeAndroid(), true);
  });

  test('startGpsTracking delegates to native service when bridge is present', () => {
    let capturedJourneyId = '';
    let capturedUserId = '';

    // @ts-expect-error test mock
    globalThis.window = {
      AndroidBridge: {
        isNativeAndroid: () => true,
        startGpsTracking: (jId: string, uId: string) => {
          capturedJourneyId = jId;
          capturedUserId = uId;
          return true;
        },
        stopGpsTracking: () => true,
        getGpsTrackingStatus: () => '{}',
        saveOfflineCollection: () => '{}',
        capturePhoto: () => {},
        getOfflineSummary: () => '{}',
        triggerSyncNow: () => {},
        checkBatteryOptimization: () => true,
        requestIgnoreBatteryOptimization: () => {},
        getDeviceIdentity: () => '{}',
        saveDeviceIdentity: () => {},
        saveActiveSession: () => {},
      },
    };

    const result = androidBridge.startGpsTracking('journey-101', 'user-42');
    assert.equal(result, true);
    assert.equal(capturedJourneyId, 'journey-101');
    assert.equal(capturedUserId, 'user-42');
  });

  test('getGpsTrackingStatus parses native JSON payload correctly', () => {
    // @ts-expect-error test mock
    globalThis.window = {
      AndroidBridge: {
        isNativeAndroid: () => true,
        startGpsTracking: () => true,
        stopGpsTracking: () => true,
        getGpsTrackingStatus: () =>
          JSON.stringify({
            isTracking: true,
            currentJourneyId: 'J-99',
            lastFixTimestamp: 1700000000000,
            latitude: 29.6974,
            longitude: 72.5539,
            accuracy: 8.5,
          }),
        saveOfflineCollection: () => '{}',
        capturePhoto: () => {},
        getOfflineSummary: () => '{}',
        triggerSyncNow: () => {},
        checkBatteryOptimization: () => true,
        requestIgnoreBatteryOptimization: () => {},
        getDeviceIdentity: () => '{}',
        saveDeviceIdentity: () => {},
        saveActiveSession: () => {},
      },
    };

    const status = androidBridge.getGpsTrackingStatus();
    assert.ok(status !== null);
    assert.equal(status.isTracking, true);
    assert.equal(status.currentJourneyId, 'J-99');
    assert.equal(status.latitude, 29.6974);
    assert.equal(status.longitude, 72.5539);
    assert.equal(status.accuracy, 8.5);
  });

  test('saveOfflineCollection returns error when not running in native Android', async () => {
    // @ts-expect-error test mock
    globalThis.window = {};
    const res = await androidBridge.saveOfflineCollection({ test: 123 });
    assert.equal(res.success, false);
    assert.equal(res.error, 'Not running in native Android');
  });
});
