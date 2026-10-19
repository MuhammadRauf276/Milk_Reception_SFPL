import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRACKING_CONFIG,
  getFixAgeLabel,
  haversineMeters,
  shouldRecordPoint,
  type TrackedPoint,
} from '../gpsTracker';

const NOW = 1_700_000_000_000;
const pt = (over: Partial<TrackedPoint> = {}): TrackedPoint => ({
  latitude: 30.0,
  longitude: 72.0,
  accuracy: 10,
  timestamp: NOW - 1000,
  ...over,
});

test('haversineMeters: zero for same point, ~111 km per degree latitude', () => {
  assert.equal(haversineMeters(30, 72, 30, 72), 0);
  const d = haversineMeters(30, 72, 31, 72);
  assert.ok(d > 111_000 && d < 111_400, `got ${d}`);
});

test('drops inaccurate fix', () => {
  const r = shouldRecordPoint(null, pt({ accuracy: 51 }), NOW);
  assert.equal(r.record, false);
  assert.equal(r.reason, 'low-accuracy');
});

test('accepts accuracy exactly at limit', () => {
  assert.equal(shouldRecordPoint(null, pt({ accuracy: 50 }), NOW).record, true);
});

test('drops stale fix', () => {
  const r = shouldRecordPoint(null, pt({ timestamp: NOW - 31_000 }), NOW);
  assert.equal(r.record, false);
  assert.equal(r.reason, 'stale');
});

test('records first point', () => {
  const r = shouldRecordPoint(null, pt(), NOW);
  assert.equal(r.record, true);
  assert.equal(r.reason, 'first-point');
});

test('records when moved 25 m or more', () => {
  const prev = pt({ timestamp: NOW - 10_000 });
  // ~0.0003 deg latitude is ~33 m
  const r = shouldRecordPoint(prev, pt({ latitude: 30.0003 }), NOW);
  assert.equal(r.record, true);
  assert.equal(r.reason, 'moved');
});

test('skips small movement', () => {
  const prev = pt({ timestamp: NOW - 10_000 });
  // ~0.0001 deg is ~11 m
  const r = shouldRecordPoint(prev, pt({ latitude: 30.0001 }), NOW);
  assert.equal(r.record, false);
  assert.equal(r.reason, 'no-change');
});

test('records heartbeat after 120 s standing still', () => {
  const prev = pt({ timestamp: NOW - 121_000 });
  const r = shouldRecordPoint(prev, pt(), NOW);
  assert.equal(r.record, true);
  assert.equal(r.reason, 'heartbeat');
});

test('custom config is respected', () => {
  const cfg = { ...DEFAULT_TRACKING_CONFIG, maxAccuracyM: 10 };
  assert.equal(shouldRecordPoint(null, pt({ accuracy: 20 }), NOW, cfg).record, false);
});

test('getFixAgeLabel', () => {
  assert.equal(getFixAgeLabel(0), 'Live');
  assert.equal(getFixAgeLabel(59_000), 'Live');
  assert.equal(getFixAgeLabel(60_000), '1 min ago');
  assert.equal(getFixAgeLabel(5 * 60_000 + 10_000), '5 min ago');
  assert.equal(getFixAgeLabel(2 * 3_600_000), '2 hr ago');
  assert.equal(getFixAgeLabel(-5), 'Live');
});
