import { describe, it, expect } from 'vitest';
import {
  computePortionQuantitySummary,
  canUseMeasuredPortionTotalForVehicle,
  computeVehiclePortionDifference,
} from '@/backend/modules/dispatch/quantity/dispatchQuantityService';

describe('Stage 4C-5D: Portion Quantity Total, Measured Assistance, and Difference', () => {
  it('[CASE D1] Measured KG total: Calculates exact sum and applies "Measured Portion Total" label', () => {
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9500', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(summary.complete).toBe(true);
    expect(summary.totalValue).toBe(19500);
    expect(summary.unit).toBe('KG');
    expect(summary.basis).toBe('MEASURED');
    expect(summary.totalKind).toBe('MEASURED');
    expect(summary.label).toBe('Measured Portion Total');
    expect(summary.formattedTotal).toBe('19,500 KG');
  });

  it('[CASE D2] Measured LITER total: Calculates exact sum in liters with "Measured Portion Total" label', () => {
    const portions = [
      { quantity: { value: '9800', unit: 'LITER' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9150', unit: 'LITER' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(summary.complete).toBe(true);
    expect(summary.totalValue).toBe(18950);
    expect(summary.unit).toBe('LITER');
    expect(summary.basis).toBe('MEASURED');
    expect(summary.totalKind).toBe('MEASURED');
    expect(summary.label).toBe('Measured Portion Total');
    expect(summary.formattedTotal).toBe('18,950 LITER');
  });

  it('[CASE D3] Estimated total: Sums estimated portions but blocks Vehicle prefill', () => {
    const portions = [
      { quantity: { value: '9800', unit: 'LITER' as const, basis: 'ESTIMATED' as const } },
      { quantity: { value: '9150', unit: 'LITER' as const, basis: 'ESTIMATED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(summary.complete).toBe(true);
    expect(summary.totalValue).toBe(18950);
    expect(summary.unit).toBe('LITER');
    expect(summary.basis).toBe('ESTIMATED');
    expect(summary.totalKind).toBe('ESTIMATED');
    expect(summary.label).toBe('Estimated Portion Total');
    expect(summary.formattedTotal).toBe('18,950 LITER');

    const vehicleQty = { value: '', unit: 'LITER' as const, basis: 'MEASURED' as const };
    const canUse = canUseMeasuredPortionTotalForVehicle(vehicleQty, summary);
    expect(canUse).toBe(false);
  });

  it('[CASE D4] Missing portion quantity: Total is unavailable/incomplete (missing != 0)', () => {
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(summary.complete).toBe(false);
    expect(summary.totalValue).toBeNull();
    expect(summary.formattedTotal).toBeNull();

    const vehicleQty = { value: '', unit: 'KG' as const, basis: 'MEASURED' as const };
    expect(canUseMeasuredPortionTotalForVehicle(vehicleQty, summary)).toBe(false);
  });

  it('[CASE D5] Same-unit positive difference: Vehicle > Portions yields +200 KG', () => {
    const vehicleQty = { value: '19700', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9500', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    const comparison = computeVehiclePortionDifference(vehicleQty, summary);

    expect(comparison.eligibleForDifference).toBe(true);
    expect(comparison.difference).toBe(200);
    expect(comparison.formattedDifference).toBe('+200 KG');
    expect(comparison.isDifferentUnits).toBe(false);
    expect(comparison.message).toBeNull();
  });

  it('[CASE D6] Same-unit negative difference: Vehicle < Portions yields -200 KG', () => {
    const vehicleQty = { value: '19300', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9500', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    const comparison = computeVehiclePortionDifference(vehicleQty, summary);

    expect(comparison.eligibleForDifference).toBe(true);
    expect(comparison.difference).toBe(-200);
    expect(comparison.formattedDifference).toBe('-200 KG');
    expect(comparison.isDifferentUnits).toBe(false);
  });

  it('[CASE D7] Exact match: Vehicle === Portions yields 0 KG', () => {
    const vehicleQty = { value: '19500', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9500', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    const comparison = computeVehiclePortionDifference(vehicleQty, summary);

    expect(comparison.eligibleForDifference).toBe(true);
    expect(comparison.difference).toBe(0);
    expect(comparison.formattedDifference).toBe('0 KG');
  });

  it('[CASE D8] Different units: Vehicle KG vs Portion LITER yields comparison message with no numeric difference', () => {
    const vehicleQty = { value: '19500', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '9800', unit: 'LITER' as const, basis: 'ESTIMATED' as const } },
      { quantity: { value: '9150', unit: 'LITER' as const, basis: 'ESTIMATED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    const comparison = computeVehiclePortionDifference(vehicleQty, summary);

    expect(comparison.eligibleForDifference).toBe(false);
    expect(comparison.difference).toBeNull();
    expect(comparison.isDifferentUnits).toBe(true);
    expect(comparison.message).toBe('Different units — no direct comparison');
  });

  it('[CASE D9] Measured prefill eligibility: Empty vehicle with matching Unit and MEASURED basis is eligible', () => {
    const vehicleQty = { value: '', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9500', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(canUseMeasuredPortionTotalForVehicle(vehicleQty, summary)).toBe(true);
  });

  it('[CASE D10] Estimated portion prefill blocked: Estimated portions cannot prefill vehicle even if vehicle is empty', () => {
    const vehicleQty = { value: '', unit: 'LITER' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '9800', unit: 'LITER' as const, basis: 'ESTIMATED' as const } },
      { quantity: { value: '9150', unit: 'LITER' as const, basis: 'ESTIMATED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(canUseMeasuredPortionTotalForVehicle(vehicleQty, summary)).toBe(false);
  });

  it('[CASE D11] Unit mismatch prefill blocked: Vehicle KG cannot be prefilled from Portion LITER', () => {
    const vehicleQty = { value: '', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '9800', unit: 'LITER' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9150', unit: 'LITER' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(canUseMeasuredPortionTotalForVehicle(vehicleQty, summary)).toBe(false);
  });

  it('[CASE D12] Vehicle Basis mismatch prefill blocked: Vehicle ESTIMATED cannot be prefilled from portion total', () => {
    const vehicleQty = { value: '', unit: 'LITER' as const, basis: 'ESTIMATED' as const };
    const portions = [
      { quantity: { value: '9800', unit: 'LITER' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9150', unit: 'LITER' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(canUseMeasuredPortionTotalForVehicle(vehicleQty, summary)).toBe(false);
  });

  it('[CASE D13] Existing Vehicle value: Non-empty vehicle value blocks prefill and computes difference', () => {
    const vehicleQty = { value: '19700', unit: 'KG' as const, basis: 'MEASURED' as const };
    const portions = [
      { quantity: { value: '10000', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9500', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(canUseMeasuredPortionTotalForVehicle(vehicleQty, summary)).toBe(false);

    const comparison = computeVehiclePortionDifference(vehicleQty, summary);
    expect(comparison.difference).toBe(200);
  });

  it('[CASE D14] Decimal exactness: Fractional portions sum with exact integer hundredths without floating-point artifacts', () => {
    const portions = [
      { quantity: { value: '9800.25', unit: 'KG' as const, basis: 'MEASURED' as const } },
      { quantity: { value: '9150.35', unit: 'KG' as const, basis: 'MEASURED' as const } },
    ];

    const summary = computePortionQuantitySummary(portions);
    expect(summary.complete).toBe(true);
    expect(summary.totalValue).toBe(18950.6);
    expect(summary.formattedTotal).toBe('18,950.6 KG');
    // Ensure no binary floating point artifact (e.g. 18950.599999999995)
    expect(summary.totalValue?.toString()).toBe('18950.6');
  });
});
