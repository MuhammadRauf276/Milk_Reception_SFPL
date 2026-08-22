import { describe, it, expect } from 'vitest';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';

describe('Canonical Milk Reception Formulas (milkFormulas.ts)', () => {
  describe('A. Business Invariants (Valid Numerical Inputs)', () => {
    it('SNF % Business Rule: (LR / 4) + (0.22 * Fat) + 0.72', () => {
      // 28/4 + 0.22*3.8 + 0.72 = 7.0 + 0.836 + 0.72 = 8.556
      const snf = calculateSNF(28.0, 3.8);
      expect(snf).toBeCloseTo(8.556, 4);

      // 29.5/4 + 0.22*4.5 + 0.72 = 7.375 + 0.99 + 0.72 = 9.085
      const snfHigh = calculateSNF(29.5, 4.5);
      expect(snfHigh).toBeCloseTo(9.085, 4);
    });

    it('Total Solids % Business Rule: Fat + SNF', () => {
      const fat = 3.8;
      const snf = 8.556;
      const ts = calculateTS(fat, snf);
      expect(ts).toBeCloseTo(12.356, 4);
    });

    it('SNF to Fat Ratio Business Rule: SNF / Fat', () => {
      const snf = 8.556;
      const fat = 3.8;
      const ratio = calculateRatio(snf, fat);
      expect(ratio).toBeCloseTo(8.556 / 3.8, 4);
    });

    it('Milk Density Business Rule: 1 + (LR / 1000)', () => {
      expect(calculateDensity(28.0)).toBeCloseTo(1.028, 4);
      expect(calculateDensity(29.5)).toBeCloseTo(1.0295, 4);
    });

    it('Physical Liters Business Rule: Mass(kg) / Density', () => {
      const liters1 = calculatePhysicalLiters(10280, 28.0);
      expect(liters1).toBeCloseTo(10000, 2);

      const liters2 = calculatePhysicalLiters(10295, 29.5);
      expect(liters2).toBeCloseTo(10000, 2);
    });

    it('Standardized @13 TS Liters Business Rule: Physical Liters * TS / 13', () => {
      const physicalLiters = 10000;
      const ts = 12.356;
      // 10,000 * 12.356 / 13 = 9504.615...
      const ts13Liters = calculateAt13TSLiters(physicalLiters, ts);
      expect(ts13Liters).toBeCloseTo((10000 * 12.356) / 13, 2);
    });
  });

  describe('B. Defensive Implementation Behavior (Defensive Helper Fallbacks)', () => {
    it('SNF returns 0 on NaN input', () => {
      expect(calculateSNF(NaN, 3.8)).toBe(0);
      expect(calculateSNF(28.0, NaN)).toBe(0);
    });

    it('TS returns 0 on NaN input', () => {
      expect(calculateTS(NaN, 8.556)).toBe(0);
      expect(calculateTS(3.8, NaN)).toBe(0);
    });

    it('Ratio returns 0 when Fat is 0 (division by zero guard) or NaN', () => {
      expect(calculateRatio(8.556, 0)).toBe(0);
      expect(calculateRatio(NaN, 3.8)).toBe(0);
      expect(calculateRatio(8.556, NaN)).toBe(0);
    });

    it('Density returns fallback 1.0 when LR is NaN', () => {
      expect(calculateDensity(NaN)).toBe(1.0);
    });

    it('Physical Liters returns 0 on non-positive or NaN mass', () => {
      expect(calculatePhysicalLiters(0, 28.0)).toBe(0);
      expect(calculatePhysicalLiters(-500, 28.0)).toBe(0);
      expect(calculatePhysicalLiters(NaN, 28.0)).toBe(0);
    });

    it('@13 TS Liters returns 0 on non-positive or NaN liters', () => {
      expect(calculateAt13TSLiters(0, 12.356)).toBe(0);
      expect(calculateAt13TSLiters(-1000, 12.356)).toBe(0);
      expect(calculateAt13TSLiters(NaN, 12.356)).toBe(0);
    });
  });
});
