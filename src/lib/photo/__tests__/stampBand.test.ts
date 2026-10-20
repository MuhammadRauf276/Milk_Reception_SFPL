import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStampLines, formatPkt, layoutStampBand } from '../stampBand';
import type { StampInfo } from '@/types/captured-photo';

const base: StampInfo = {
  employeeCode: 'EMP-101',
  roleLabel: 'MDO',
  pointLabel: 'MOT Shop',
  captureId: '11111111-2222-3333-4444-555555555555',
  offline: false,
};
const when = new Date('2026-10-20T09:05:09Z'); // 14:05:09 PKT

test('band starts exactly below the photo and total height adds up', () => {
  const l = layoutStampBand(1280, 960, base, when, null);
  assert.equal(l.bandTop, 960);
  assert.equal(l.totalHeight, 960 + l.bandHeight);
  assert.equal(l.bandHeight, l.lines.length * l.lineHeightPx + 2 * l.paddingPx);
  assert.ok(l.fontPx >= 14);
});

test('time is shown in PKT', () => {
  assert.equal(formatPkt(when), '2026-10-20 14:05:09 PKT');
  assert.ok(buildStampLines(base, when, null).includes('Time: 2026-10-20 14:05:09 PKT'));
});

test('acting-as role line', () => {
  const lines = buildStampLines({ ...base, roleLabel: 'Zonal Manager', actingAsLabel: 'Zonal Lab Attendant' }, when, null);
  assert.ok(lines.includes('Role Zonal Manager acting as Zonal Lab Attendant'));
  assert.ok(buildStampLines(base, when, null).includes('Role: MDO'));
});

test('GPS present and missing', () => {
  const withGps = buildStampLines(base, when, { lat: 31.5204, lng: 74.3587, accuracyM: 12.4 });
  assert.ok(withGps.includes('GPS: 31.520400, 74.358700 ±12 m'));
  assert.ok(buildStampLines(base, when, null).includes('GPS: not available'));
});

test('vehicle, token and photo id lines', () => {
  const lines = buildStampLines({ ...base, vehicleNo: 'LEA-1234', tokenNo: 'T-9' }, when, null);
  assert.ok(lines.includes('Vehicle: LEA-1234  |  Token: T-9'));
  assert.ok(lines.includes(`Photo ID: ${base.captureId}`));
  assert.ok(!buildStampLines(base, when, null).some((l) => l.startsWith('Vehicle')));
});

test('OFFLINE marker only when offline', () => {
  assert.ok(buildStampLines({ ...base, offline: true }, when, null).some((l) => l.startsWith('OFFLINE')));
  assert.ok(!buildStampLines(base, when, null).some((l) => l.includes('OFFLINE')));
});
