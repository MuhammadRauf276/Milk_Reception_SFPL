import { describe, it, expect } from 'vitest';
import {
  PLANT_TIMEZONE,
  toDatetimeLocalInput,
  datetimeLocalToIso,
  formatOperationalDatetime,
  formatOperationalTime,
} from '@/lib/datetime-utils';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

describe('QA Pakistan-Time Datetime Utilities (Stage 4C-5I)', () => {
  it('I1: formats UTC instant 2026-08-23T21:30:00.000Z as 02:30 PKT in Asia/Karachi', () => {
    const utcIso = '2026-08-23T21:30:00.000Z';
    const timeFormatted = formatOperationalTime(utcIso);
    expect(timeFormatted).toBe('02:30');

    const fullFormatted = formatOperationalDatetime(utcIso);
    expect(fullFormatted).toContain('24 Aug 2026');
    expect(fullFormatted.toLowerCase()).toContain('2:30');
  });

  it('I2: toDatetimeLocalInput for 2026-08-23T21:30:00.000Z produces 2026-08-24T02:30', () => {
    const utcIso = '2026-08-23T21:30:00.000Z';
    const localInput = toDatetimeLocalInput(utcIso);
    expect(localInput).toBe('2026-08-24T02:30');
  });

  it('I3: datetimeLocalToIso converts 2026-08-24T09:15 PKT to 2026-08-24T04:15:00.000Z UTC', () => {
    const localStr = '2026-08-24T09:15';
    const isoResult = datetimeLocalToIso(localStr);
    expect(isoResult).toBe('2026-08-24T04:15:00.000Z');
  });

  it('I4: PLANT_TIMEZONE is Asia/Karachi and formats deterministically', () => {
    expect(PLANT_TIMEZONE).toBe('Asia/Karachi');
    const afternoonUtc = '2026-08-24T12:00:00.000Z';
    expect(formatOperationalTime(afternoonUtc)).toBe('17:00');
    expect(toDatetimeLocalInput(afternoonUtc)).toBe('2026-08-24T17:00');
  });

  it('I5: invalid or missing timestamp returns safe fallback without throwing', () => {
    expect(formatOperationalTime(null)).toBe('—');
    expect(formatOperationalTime(undefined)).toBe('—');
    expect(formatOperationalTime('')).toBe('—');
    expect(formatOperationalTime('invalid-date-string')).toBe('—');

    expect(formatOperationalDatetime(null)).toBe('—');
    expect(formatOperationalDatetime(undefined)).toBe('—');
    expect(formatOperationalDatetime('')).toBe('—');
    expect(formatOperationalDatetime('invalid-date-string')).toBe('—');

    expect(datetimeLocalToIso('')).toBeNull();
    expect(datetimeLocalToIso('invalid')).toBeNull();
  });

  it('I6: chronology validation strictly rejects event earlier than predecessor', () => {
    const predecessorTs = new Date('2026-08-24T04:00:00.000Z');
    const earlyEventTs = '2026-08-24T03:59:59.000Z';
    const result = validateOperationalTimestamp(earlyEventTs, predecessorTs, 'QA Start', 'Gate Entry');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('cannot be earlier than Gate Entry');

    const equalEventTs = '2026-08-24T04:00:00.000Z';
    const equalResult = validateOperationalTimestamp(equalEventTs, predecessorTs, 'QA Start', 'Gate Entry');
    expect(equalResult.isValid).toBe(true);
  });

  it('I7: future-event validation strictly rejects timestamps in the future', () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    const result = validateOperationalTimestamp(farFuture, null, 'QA Start', 'Gate Entry');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('cannot be in the future');
  });
});
