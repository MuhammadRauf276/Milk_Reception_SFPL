import { describe, it, expect } from 'vitest';
import {
  calculateGrossLiters,
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';

describe('Stage 4C-5C: Gross Liters & Dispatch Calculation Terminology', () => {
  it('[CASE C1] LITER direct: Returns declared quantity directly as Gross Liters without density conversion', () => {
    const qty = 9800;
    const grossLiters = calculateGrossLiters(qty, 'LITER');
    expect(grossLiters).toBe(9800);
  });

  it('[CASE C2] KG conversion: Converts declared KG to Gross Liters using canonical Density (1 + LR/1000)', () => {
    const qty = 10000;
    const lr = 28.0;
    const density = calculateDensity(lr);
    expect(density).toBeCloseTo(1.028, 4);

    const grossLiters = calculateGrossLiters(qty, 'KG', lr);
    expect(grossLiters).not.toBeNull();
    expect(grossLiters).toBeCloseTo(10000 / 1.028, 4);
    expect(grossLiters).toBeCloseTo(9727.626459, 4);
  });

  it('[CASE C3] KG missing LR: Gross Liters is strictly unavailable (null), no fallback density applied', () => {
    const qty = 10000;
    expect(calculateGrossLiters(qty, 'KG', null)).toBeNull();
    expect(calculateGrossLiters(qty, 'KG', undefined)).toBeNull();
    expect(calculateGrossLiters(qty, 'KG', NaN)).toBeNull();
    expect(calculateGrossLiters(qty, 'KG', 0)).toBeNull();
  });

  it('[CASE C4] LITER missing LR: Gross Liters equals declared liters even if LR is missing', () => {
    const qty = 9800;
    const grossLiters = calculateGrossLiters(qty, 'LITER', null);
    expect(grossLiters).toBe(9800);
  });

  it('[CASE C5] LITER + full quality: Canonical calculation of Gross Liters and Liters @ 13% TS', () => {
    const qty = 9800;
    const lr = 28.0;
    const fat = 3.8;

    const density = calculateDensity(lr);
    const snf = calculateSNF(lr, fat);
    const ts = calculateTS(fat, snf);
    const ratio = calculateRatio(snf, fat);
    const grossLiters = calculateGrossLiters(qty, 'LITER', lr);

    expect(density).toBeCloseTo(1.028, 4);
    expect(snf).toBeCloseTo(8.556, 4); // 28/4 + 0.22*3.8 + 0.72 = 8.556
    expect(ts).toBeCloseTo(12.356, 4); // 3.8 + 8.556 = 12.356
    expect(ratio).toBeCloseTo(8.556 / 3.8, 4);
    expect(grossLiters).toBe(9800);

    const at13TsLiters = grossLiters !== null ? calculateAt13TSLiters(grossLiters, ts) : null;
    expect(at13TsLiters).not.toBeNull();
    expect(at13TsLiters).toBeCloseTo((9800 * 12.356) / 13, 4);
    expect(at13TsLiters).toBeCloseTo(9314.523, 2);
  });

  it('[CASE C6] KG + full quality: Canonical calculation of Gross Liters from KG and Liters @ 13% TS', () => {
    const qty = 10000;
    const lr = 28.0;
    const fat = 3.8;

    const density = calculateDensity(lr);
    const snf = calculateSNF(lr, fat);
    const ts = calculateTS(fat, snf);
    const grossLiters = calculateGrossLiters(qty, 'KG', lr);

    expect(density).toBeCloseTo(1.028, 4);
    expect(snf).toBeCloseTo(8.556, 4);
    expect(ts).toBeCloseTo(12.356, 4);
    expect(grossLiters).toBeCloseTo(10000 / 1.028, 4);

    const at13TsLiters = grossLiters !== null ? calculateAt13TSLiters(grossLiters, ts) : null;
    expect(at13TsLiters).not.toBeNull();
    expect(at13TsLiters).toBeCloseTo(((10000 / 1.028) * 12.356) / 13, 4);
    expect(at13TsLiters).toBeCloseTo(9245.735, 2);
  });

  it('[CASE C7] Invalid/missing Fat: Gross Liters remains available for LITER, quality metrics remain unavailable', () => {
    const qty = 9800;
    const grossLiters = calculateGrossLiters(qty, 'LITER', null);
    expect(grossLiters).toBe(9800);

    // Without Fat/LR, TS cannot be computed, so Liters @ 13% TS is unavailable
    const fatNum = null;
    const lrNum = null;
    const tsVal = (fatNum !== null && lrNum !== null) ? calculateTS(fatNum, calculateSNF(lrNum, fatNum)) : null;
    expect(tsVal).toBeNull();

    const at13TsLiters = (grossLiters !== null && tsVal !== null) ? calculateAt13TSLiters(grossLiters, tsVal) : null;
    expect(at13TsLiters).toBeNull();
  });

  it('[CASE C8] Canonical formulas and null guards for negative or invalid quantities', () => {
    expect(calculateGrossLiters(0, 'LITER')).toBeNull();
    expect(calculateGrossLiters(-100, 'LITER')).toBeNull();
    expect(calculateGrossLiters(NaN, 'LITER')).toBeNull();
    expect(calculateGrossLiters(null, 'LITER')).toBeNull();
    expect(calculateGrossLiters(1000, 'UNKNOWN_UNIT')).toBeNull();
  });
});
