import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMeters, shouldRecordPoint, type TrackedPoint, type TrackingConfig } from '../gpsTracker';

describe('Phase 4: Native GPS Filter & Adaptive Sampling Algorithm', () => {

  const testConfig: TrackingConfig = {
    maxAccuracyM: 50,
    maxFixAgeMs: 30_000,
    minDistanceM: 25,
    heartbeatMs: 120_000,
  };

  test('Haversine distance calculates accurate displacement between coordinates', () => {
    // Hasilpur base to a point ~250m away
    const lat1 = 29.6974;
    const lon1 = 72.5539;
    const lat2 = 29.6995;
    const lon2 = 72.5545;

    const distance = haversineMeters(lat1, lon1, lat2, lon2);
    assert.ok(distance > 230 && distance < 250, `Expected distance ~240m, got ${distance}`);
  });

  test('Haversine distance returns 0 for identical points', () => {
    const d = haversineMeters(31.2698, 72.3169, 31.2698, 72.3169);
    assert.equal(d, 0);
  });

  test('Rejects low accuracy fixes exceeding maxAccuracyM (50m)', () => {
    const now = Date.now();
    const poorFix: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 75, // > 50m
      timestamp: now,
    };

    const decision = shouldRecordPoint(null, poorFix, now, testConfig);
    assert.equal(decision.record, false);
    assert.equal(decision.reason, 'low-accuracy');
  });

  test('Rejects stale fixes older than maxFixAgeMs (30s)', () => {
    const now = Date.now();
    const staleFix: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 10,
      timestamp: now - 45_000, // 45 seconds old
    };

    const decision = shouldRecordPoint(null, staleFix, now, testConfig);
    assert.equal(decision.record, false);
    assert.equal(decision.reason, 'stale');
  });

  test('Always records the first valid GPS point in a journey', () => {
    const now = Date.now();
    const firstFix: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 12,
      timestamp: now,
    };

    const decision = shouldRecordPoint(null, firstFix, now, testConfig);
    assert.equal(decision.record, true);
    assert.equal(decision.reason, 'first-point');
  });

  test('Records point when vehicle moves >= minDistanceM (25m)', () => {
    const now = Date.now();
    const prevPoint: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 10,
      timestamp: now - 15_000,
    };

    // Moved ~35 meters
    const currentPoint: TrackedPoint = {
      latitude: 29.6977,
      longitude: 72.5540,
      accuracy: 8,
      timestamp: now,
    };

    const decision = shouldRecordPoint(prevPoint, currentPoint, now, testConfig);
    assert.equal(decision.record, true);
    assert.equal(decision.reason, 'moved');
  });

  test('Drops stationary points when moved < minDistanceM and time < heartbeatMs', () => {
    const now = Date.now();
    const prevPoint: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 10,
      timestamp: now - 30_000, // 30s ago
    };

    // Minor GPS jitter of ~3 meters
    const jitterPoint: TrackedPoint = {
      latitude: 29.69742,
      longitude: 72.55391,
      accuracy: 10,
      timestamp: now,
    };

    const decision = shouldRecordPoint(prevPoint, jitterPoint, now, testConfig);
    assert.equal(decision.record, false);
    assert.equal(decision.reason, 'no-change');
  });

  test('Records heartbeat point when stationary for >= heartbeatMs (120s)', () => {
    const now = Date.now();
    const prevPoint: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 10,
      timestamp: now - 125_000, // 125s ago
    };

    // Parked at shop
    const stationaryPoint: TrackedPoint = {
      latitude: 29.6974,
      longitude: 72.5539,
      accuracy: 10,
      timestamp: now,
    };

    const decision = shouldRecordPoint(prevPoint, stationaryPoint, now, testConfig);
    assert.equal(decision.record, true);
    assert.equal(decision.reason, 'heartbeat');
  });
});
