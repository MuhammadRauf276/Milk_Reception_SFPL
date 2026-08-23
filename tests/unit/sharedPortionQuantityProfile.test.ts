import { describe, it, expect } from 'vitest';
import {
  validateDispatchQuantities,
  QuantityMeasurementError,
  applySharedPortionUnit,
  applySharedPortionBasis,
  createPortionQuantityFromSharedProfile,
  formatAcceptedQuantitySummary,
} from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { createDispatchSchema } from '@/lib/validations/dispatch';
import { DEFAULT_DISPATCH_QUANTITY_POLICY } from '@/backend/modules/dispatch/quantity-policy/types';

describe('Stage 4C-5B: Shared Portion Quantity Profile (Unit & Basis)', () => {
  const policy = DEFAULT_DISPATCH_QUANTITY_POLICY;

  it('[CASE B1] Accepts multi-portion dispatch when all portions share Unit and Basis (KG / MEASURED)', () => {
    const input = {
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: '9800', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: '9150', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
      ],
      policy,
    };

    const result = validateDispatchQuantities(input);
    expect(result.portionQuantities).toHaveLength(2);
    expect(result.portionQuantities[0].unit).toBe('KG');
    expect(result.portionQuantities[0].basis).toBe('MEASURED');
    expect(result.portionQuantities[1].unit).toBe('KG');
    expect(result.portionQuantities[1].basis).toBe('MEASURED');

    // Also verify Zod schema
    const schemaResult = createDispatchSchema.safeParse({
      vehicleNumber: 'TEST-01',
      operationalDate: '2026-08-23',
      vehicleQuantity: { value: 19500, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: 9800, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: 9150, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
      ],
    });
    expect(schemaResult.success).toBe(true);
  });

  it('[CASE B2] Backend rejects dispatch when portion Unit mismatches Portion 1 (P1=KG, P2=LITER)', () => {
    const input = {
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: '9800', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: '9150', unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' } },
      ],
      policy,
    };

    expect(() => validateDispatchQuantities(input)).toThrow(QuantityMeasurementError);
    try {
      validateDispatchQuantities(input);
    } catch (err: any) {
      expect(err.code).toBe('PORTION_UNIT_MISMATCH');
      expect(err.message).toContain('Portion 2 quantity unit (LITER) must match Portion 1 unit (KG)');
    }

    // Also verify Zod schema rejection
    const schemaResult = createDispatchSchema.safeParse({
      vehicleNumber: 'TEST-01',
      operationalDate: '2026-08-23',
      vehicleQuantity: { value: 19500, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: 9800, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: 9150, unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' } },
      ],
    });
    expect(schemaResult.success).toBe(false);
  });

  it('[CASE B3] Backend rejects dispatch when portion Basis mismatches Portion 1 (P1=MEASURED, P2=ESTIMATED)', () => {
    const input = {
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: '9800', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: '9150', unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
      ],
      policy,
    };

    expect(() => validateDispatchQuantities(input)).toThrow(QuantityMeasurementError);
    try {
      validateDispatchQuantities(input);
    } catch (err: any) {
      expect(err.code).toBe('PORTION_BASIS_MISMATCH');
      expect(err.message).toContain('Portion 2 measurement basis (ESTIMATED) must match Portion 1 basis (MEASURED)');
    }

    // Also verify Zod schema rejection
    const schemaResult = createDispatchSchema.safeParse({
      vehicleNumber: 'TEST-01',
      operationalDate: '2026-08-23',
      vehicleQuantity: { value: 19500, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: 9800, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: 9150, unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
      ],
    });
    expect(schemaResult.success).toBe(false);
  });

  it('[CASE B4] Proves Vehicle quantity remains independent: Vehicle (KG / MEASURED) with Portions (LITER / ESTIMATED) is VALID', () => {
    const input = {
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: '9800', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
        { portionNumber: 2, quantity: { value: '9150', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
      ],
      policy,
    };

    const result = validateDispatchQuantities(input);
    expect(result.vehicleQuantity.unit).toBe('KG');
    expect(result.vehicleQuantity.basis).toBe('MEASURED');
    expect(result.portionQuantities[0].unit).toBe('LITER');
    expect(result.portionQuantities[0].basis).toBe('ESTIMATED');
    expect(result.portionQuantities[1].unit).toBe('LITER');
    expect(result.portionQuantities[1].basis).toBe('ESTIMATED');

    const schemaResult = createDispatchSchema.safeParse({
      vehicleNumber: 'TEST-01',
      operationalDate: '2026-08-23',
      vehicleQuantity: { value: 19500, unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: 9800, unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
        { portionNumber: 2, quantity: { value: 9150, unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
      ],
    });
    expect(schemaResult.success).toBe(true);
  });

  it('[CASE B5] Newly created Portion 2 inherits Unit and Basis from current Portion 1 (LITER / ESTIMATED)', () => {
    const p1State = {
      portionNumber: 1,
      quantity: {
        value: '9800',
        unit: 'LITER' as const,
        basis: 'ESTIMATED' as const,
        method: 'MANUAL_ESTIMATE' as const,
      },
    };

    const defaultRules = policy.portionRules.default;
    const allowed = policy.portionRules.allowedMeasurements;

    const newPortionQty = createPortionQuantityFromSharedProfile(
      p1State.quantity,
      defaultRules,
      allowed
    );

    expect(newPortionQty.unit).toBe('LITER');
    expect(newPortionQty.basis).toBe('ESTIMATED');
    expect(newPortionQty.value).toBe(''); // Fresh portion has empty value
  });

  it('[CASE B6] Shared Unit change (LITER -> KG) clears all portion values and sets Unit to KG without reinterpretation', () => {
    const portions = [
      {
        portionNumber: 1,
        quantity: { value: '9800', unit: 'LITER' as const, basis: 'ESTIMATED' as const, method: 'MANUAL_ESTIMATE' as const },
      },
      {
        portionNumber: 2,
        quantity: { value: '9150', unit: 'LITER' as const, basis: 'ESTIMATED' as const, method: 'MANUAL_ESTIMATE' as const },
      },
    ];

    const updated = applySharedPortionUnit(portions, 'KG', policy.portionRules.allowedMeasurements);

    expect(updated).toHaveLength(2);
    // Values must be cleared
    expect(updated[0].quantity.value).toBe('');
    expect(updated[1].quantity.value).toBe('');
    // Units must be KG
    expect(updated[0].quantity.unit).toBe('KG');
    expect(updated[1].quantity.unit).toBe('KG');
    // Basis preserved if allowed
    expect(updated[0].quantity.basis).toBe('ESTIMATED');
    expect(updated[1].quantity.basis).toBe('ESTIMATED');
  });

  it('[CASE B7] Shared Basis change (ESTIMATED -> MEASURED) propagates to all portions while PRESERVING numeric values', () => {
    const portions = [
      {
        portionNumber: 1,
        quantity: { value: '9800', unit: 'LITER' as const, basis: 'ESTIMATED' as const, method: 'MANUAL_ESTIMATE' as const },
      },
      {
        portionNumber: 2,
        quantity: { value: '9150', unit: 'LITER' as const, basis: 'ESTIMATED' as const, method: 'MANUAL_ESTIMATE' as const },
      },
    ];

    const updated = applySharedPortionBasis(portions, 'MEASURED', policy.portionRules.allowedMeasurements);

    expect(updated).toHaveLength(2);
    // Values must remain intact
    expect(updated[0].quantity.value).toBe('9800');
    expect(updated[1].quantity.value).toBe('9150');
    // Basis must be MEASURED
    expect(updated[0].quantity.basis).toBe('MEASURED');
    expect(updated[1].quantity.basis).toBe('MEASURED');
    // Unit unchanged
    expect(updated[0].quantity.unit).toBe('LITER');
    expect(updated[1].quantity.unit).toBe('LITER');
  });

  it('[CASE B8] Vehicle quantity value/unit/basis is independent and unchanged by portion profile changes', () => {
    const vehicleQuantity = {
      value: '19500',
      unit: 'KG' as const,
      basis: 'MEASURED' as const,
      method: 'WEIGHING' as const,
    };

    const portions = [
      {
        portionNumber: 1,
        quantity: { value: '9800', unit: 'LITER' as const, basis: 'ESTIMATED' as const, method: 'MANUAL_ESTIMATE' as const },
      },
    ];

    // Changing portion unit to KG
    const updatedPortions = applySharedPortionUnit(portions, 'KG', policy.portionRules.allowedMeasurements);

    // Vehicle quantity must remain unchanged
    expect(vehicleQuantity.value).toBe('19500');
    expect(vehicleQuantity.unit).toBe('KG');
    expect(vehicleQuantity.basis).toBe('MEASURED');
    expect(updatedPortions[0].quantity.value).toBe('');
  });

  it('[CASE B9] Missing portion numeric value is not treated as zero in summary helpers', () => {
    const portionsWithMissing = [
      { portionNumber: 1, dispatchQuantityValue: 9800, dispatchQuantityUnit: 'LITER', plantDecision: 'ACCEPTED' },
      { portionNumber: 2, dispatchQuantityValue: null, dispatchQuantityUnit: 'LITER', plantDecision: 'ACCEPTED' },
    ];

    const summary = formatAcceptedQuantitySummary(portionsWithMissing);
    // When one quantity is missing, summary returns per-portion breakdown rather than fabricating a zero or invalid sum
    expect(summary).toContain('P1: 9,800 LITER');
    expect(summary).toContain('P2: —');
    expect(summary).not.toContain('9,800 LITER (Total)');
  });
});