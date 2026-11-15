import test from 'node:test';
import assert from 'node:assert/strict';
import { getFacilityOrStoredFallback, isGpsGrade } from '@/lib/gps';
import { DEFAULT_TRACKING_CONFIG, shouldRecordPoint, type TrackedPoint } from '@/lib/gpsTracker';

test('only a GPS-grade reading counts: a computer answering from Wi-Fi or its internet address is not GPS', () => {
  assert.equal(isGpsGrade(8), true);
  assert.equal(isGpsGrade(60), true);
  assert.equal(isGpsGrade(100), true);
  assert.equal(isGpsGrade(101), false);
  assert.equal(isGpsGrade(2500), false); // a typical desktop answer
  assert.equal(isGpsGrade(null), false);
  assert.equal(isGpsGrade(undefined), false);
  assert.equal(isGpsGrade(0), false);
  assert.equal(isGpsGrade(Number.NaN), false);
});

test('a station falls back to the position saved for it, and a place with none gets no made-up position', () => {
  const hasilpur = getFacilityOrStoredFallback({ name: 'ZMCC Hasilpur', latitude: 29.6974, longitude: 72.5539 });
  assert.equal(hasilpur?.source, 'FACILITY_DEFAULT');
  assert.equal(hasilpur?.latitude, 29.6974);
  assert.equal(hasilpur?.longitude, 72.5539);
  // No position saved for the source, and nothing saved on this device.
  assert.equal(getFacilityOrStoredFallback({ name: 'New ZMCC', latitude: null, longitude: null }), null);
  assert.equal(getFacilityOrStoredFallback({ name: 'Bad', latitude: 0, longitude: 0 }), null);
  assert.equal(getFacilityOrStoredFallback(null), null);
});

test('the age of a reading is measured from when the phone received it, so a wrong phone clock does not drop it', () => {
  const now = Date.UTC(2026, 10, 15, 10, 0, 0);
  // The phone clock is 3 hours ahead of real (GPS) time.
  const gpsTime = now - 3 * 60 * 60 * 1000;
  const withReceive: TrackedPoint = { latitude: 29.7, longitude: 72.55, accuracy: 10, timestamp: gpsTime, receivedAt: now - 2000 };
  assert.deepEqual(shouldRecordPoint(null, withReceive, now, DEFAULT_TRACKING_CONFIG), { record: true, reason: 'first-point' });

  // Without the receive time the old comparison (GPS time against the phone clock) wrongly calls it stale.
  const withoutReceive: TrackedPoint = { latitude: 29.7, longitude: 72.55, accuracy: 10, timestamp: gpsTime };
  assert.equal(shouldRecordPoint(null, withoutReceive, now, DEFAULT_TRACKING_CONFIG).reason, 'stale');

  // A reading the phone really has held for too long is still dropped.
  const held: TrackedPoint = { latitude: 29.7, longitude: 72.55, accuracy: 10, timestamp: gpsTime, receivedAt: now - 5 * 60 * 1000 };
  assert.equal(shouldRecordPoint(null, held, now, DEFAULT_TRACKING_CONFIG).reason, 'stale');
});
