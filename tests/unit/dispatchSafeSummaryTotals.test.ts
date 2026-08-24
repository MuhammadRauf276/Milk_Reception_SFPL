import { describe, it, expect } from 'vitest';
import {
  computeDispatchSafeSummaryTotals,
  computeDispatchPortionCalculatedValues,
} from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

describe('Stage 4C-5E: Safe Summary Totals (computeDispatchSafeSummaryTotals)', () => {
  it('[CASE E1] Total Gross Liters, all LITER: Correct sum when all portions declare LITER', () => {
    const p1 = computeDispatchPortionCalculatedValues(9800, 'LITER', null, null);
    const p2 = computeDispatchPortionCalculatedValues(9150, 'LITER', null, null);

    const totals = computeDispatchSafeSummaryTotals([p1, p2]);
    expect(totals.hasPortions).toBe(true);
    expect(totals.totalGrossLiters).toBe(18950);
    expect(totals.formattedTotalGrossLiters).toBe('18,950 L');
  });

  it('[CASE E2] Total Gross Liters with KG-derived portions: Sums unrounded canonical Gross Liters', () => {
    const p1 = computeDispatchPortionCalculatedValues(10000, 'KG', 28.0, 3.8);
    const p2 = computeDispatchPortionCalculatedValues(9500, 'KG', 28.0, 3.8);

    const totals = computeDispatchSafeSummaryTotals([p1, p2]);
    expect(totals.hasPortions).toBe(true);
    expect(totals.totalGrossLiters).not.toBeNull();
    // 10000/1.028 + 9500/1.028 = 19500/1.028 = 18968.871595...
    expect(totals.totalGrossLiters).toBeCloseTo(19500 / 1.028, 4);
    expect(totals.formattedTotalGrossLiters).toBe('18,969 L');
  });

  it('[CASE E3] One Gross Liters unavailable: Total Gross Liters is strictly null (no partial sum)', () => {
    const p1 = computeDispatchPortionCalculatedValues(9800, 'LITER', null, null);
    // KG without LR => Gross Liters unavailable (null)
    const p2 = computeDispatchPortionCalculatedValues(10000, 'KG', null, null);

    const totals = computeDispatchSafeSummaryTotals([p1, p2]);
    expect(totals.hasPortions).toBe(true);
    expect(totals.totalGrossLiters).toBeNull();
    expect(totals.formattedTotalGrossLiters).toBeNull();
  });

  it('[CASE E4] Total Liters @ 13% TS, all available: Sums valid per-portion canonical results', () => {
    const p1 = computeDispatchPortionCalculatedValues(9800, 'LITER', 28.0, 3.8);
    const p2 = computeDispatchPortionCalculatedValues(9150, 'LITER', 28.0, 3.8);

    const totals = computeDispatchSafeSummaryTotals([p1, p2]);
    expect(totals.hasPortions).toBe(true);
    expect(totals.totalLitersAt13TS).not.toBeNull();
    // P1 @13: (9800 * 12.356)/13 = 9314.523...
    // P2 @13: (9150 * 12.356)/13 = 8696.88...
    // Sum: (18950 * 12.356)/13 = 18011.403...
    expect(totals.totalLitersAt13TS).toBeCloseTo((18950 * 12.356) / 13, 4);
    expect(totals.formattedTotalLitersAt13TS).toBe('18,011 L');
  });

  it('[CASE E5] One Liters @ 13% TS unavailable: Total Liters @ 13% TS is strictly null (no partial sum)', () => {
    const p1 = computeDispatchPortionCalculatedValues(9800, 'LITER', 28.0, 3.8);
    // LITER without LR/Fat => Liters @ 13% TS unavailable (null)
    const p2 = computeDispatchPortionCalculatedValues(9150, 'LITER', null, null);

    const totals = computeDispatchSafeSummaryTotals([p1, p2]);
    expect(totals.hasPortions).toBe(true);
    expect(totals.totalLitersAt13TS).toBeNull();
    expect(totals.formattedTotalLitersAt13TS).toBeNull();
  });

  it('[CASE E6] Zero portions: All totals remain strictly unavailable', () => {
    const totals = computeDispatchSafeSummaryTotals([]);
    expect(totals.hasPortions).toBe(false);
    expect(totals.totalGrossLiters).toBeNull();
    expect(totals.formattedTotalGrossLiters).toBeNull();
    expect(totals.totalLitersAt13TS).toBeNull();
    expect(totals.formattedTotalLitersAt13TS).toBeNull();
  });

  it('[CASE E7] No vehicle-quality average: Asserts absence of artificial averaged quality fields', () => {
    const p1 = computeDispatchPortionCalculatedValues(9800, 'LITER', 28.0, 3.8);
    const p2 = computeDispatchPortionCalculatedValues(9150, 'LITER', 29.0, 4.0);

    const totals = computeDispatchSafeSummaryTotals([p1, p2]);
    expect((totals as any).averageLr).toBeUndefined();
    expect((totals as any).averageFat).toBeUndefined();
    expect((totals as any).averageDensity).toBeUndefined();
    expect((totals as any).averageSnf).toBeUndefined();
    expect((totals as any).averageTs).toBeUndefined();
    expect((totals as any).averageRatio).toBeUndefined();
  });
});
