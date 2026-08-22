import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_DISPATCH_QUANTITY_POLICY,
  getAllowedUnits,
  getAllowedBases,
  getAllowedMethods,
  isCombinationAllowed,
} from '@/backend/modules/dispatch/quantity-policy/types';
import {
  validateQuantityPolicy,
} from '@/backend/modules/dispatch/quantity-policy/validation';

describe('Stage 4C-3A: Dispatch Quantity Policy Contract Hardening (Unit)', () => {
  it('[TEST-A] Exact allowed measurement combinations succeed validation', () => {
    const validPolicy = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
          { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER'] },
          { unit: 'KG', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE'] },
        ],
        default: {
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
      },
      portionRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        ],
        default: {
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
      },
      allowSameUnitPortionPrefill: true,
    };

    const validated = validateQuantityPolicy(validPolicy);
    expect(validated.version).toBe(1);
    expect(validated.vehicleRules.default.unit).toBe('KG');
    expect(validated.vehicleRules.default.basis).toBe('MEASURED');
    expect(validated.vehicleRules.default.method).toBe('WEIGHING');

    // Derived helpers
    expect(getAllowedUnits(validated.vehicleRules.allowedMeasurements)).toEqual(['KG', 'LITER']);
    expect(getAllowedBases(validated.vehicleRules.allowedMeasurements, 'KG')).toEqual(['MEASURED', 'ESTIMATED']);
    expect(getAllowedMethods(validated.vehicleRules.allowedMeasurements, 'KG', 'MEASURED')).toEqual(['WEIGHING']);
    expect(getAllowedMethods(validated.vehicleRules.allowedMeasurements, 'LITER', 'MEASURED')).toEqual(['FLOW_METER']);
  });

  it('[TEST-B] Unconfigured measurement combination is rejected by combination checker', () => {
    const allowed = [
      { unit: 'KG' as const, basis: 'MEASURED' as const, methods: ['WEIGHING' as const] },
      { unit: 'LITER' as const, basis: 'MEASURED' as const, methods: ['FLOW_METER' as const] },
    ];

    // Allowed
    expect(isCombinationAllowed(allowed, { unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' })).toBe(true);
    expect(isCombinationAllowed(allowed, { unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' })).toBe(true);

    // Unconfigured combinations
    expect(isCombinationAllowed(allowed, { unit: 'KG', basis: 'MEASURED', method: 'FLOW_METER' })).toBe(false);
    expect(isCombinationAllowed(allowed, { unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' })).toBe(false);
    expect(isCombinationAllowed(allowed, { unit: 'LITER', basis: 'MEASURED', method: 'WEIGHING' })).toBe(false);
  });

  it('[TEST-C] Validation rejects default vehicle combination if not in allowed combinations', () => {
    const invalidPolicy = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        ],
        default: {
          unit: 'LITER', // Invalid: LITER not in allowedMeasurements
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
      },
      portionRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        ],
        default: {
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
      },
      allowSameUnitPortionPrefill: true,
    };

    expect(() => validateQuantityPolicy(invalidPolicy)).toThrow(/Default vehicle measurement/);
  });

  it('[TEST-D] Validation rejects default portion combination if not in allowed combinations', () => {
    const invalidPolicy = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        ],
        default: {
          unit: 'KG',
          basis: 'MEASURED',
          method: 'WEIGHING',
        },
      },
      portionRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        ],
        default: {
          unit: 'KG',
          basis: 'MEASURED',
          method: 'FLOW_METER', // Invalid: FLOW_METER not in portion allowed methods
        },
      },
      allowSameUnitPortionPrefill: true,
    };

    expect(() => validateQuantityPolicy(invalidPolicy)).toThrow(/Default portion measurement/);
  });

  it('[TEST-E] Default policy is structurally valid with allowed combinations', () => {
    const validated = validateQuantityPolicy(DEFAULT_DISPATCH_QUANTITY_POLICY);
    expect(validated.version).toBe(1);
    expect(isCombinationAllowed(validated.vehicleRules.allowedMeasurements, validated.vehicleRules.default)).toBe(true);
    expect(isCombinationAllowed(validated.portionRules.allowedMeasurements, validated.portionRules.default)).toBe(true);
  });

  it('[TEST-J] Static scan confirms 0 runtime source-type branching in quantity policy service', () => {
    const serviceCode = fs.readFileSync(
      path.join(process.cwd(), 'src/backend/modules/dispatch/quantity-policy/quantityPolicyService.ts'),
      'utf8'
    );
    const validationCode = fs.readFileSync(
      path.join(process.cwd(), 'src/backend/modules/dispatch/quantity-policy/validation.ts'),
      'utf8'
    );

    expect(serviceCode).not.toContain('source_type ===');
    expect(serviceCode).not.toContain('CONTRACTOR');
    expect(serviceCode).not.toContain('ZMCC');

    expect(validationCode).not.toContain('source_type ===');
    expect(validationCode).not.toContain('CONTRACTOR');
    expect(validationCode).not.toContain('ZMCC');
  });
});

