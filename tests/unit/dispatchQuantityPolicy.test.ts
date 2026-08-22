import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_DISPATCH_QUANTITY_POLICY,
  DispatchQuantityPolicyConfig,
} from '@/backend/modules/dispatch/quantity-policy/types';
import {
  validateQuantityPolicy,
} from '@/backend/modules/dispatch/quantity-policy/validation';

describe('Stage 4C-3: Dispatch Quantity Policy Domain (Unit)', () => {
  it('[TEST-A] Default policy is structurally valid', () => {
    const validated = validateQuantityPolicy(DEFAULT_DISPATCH_QUANTITY_POLICY);
    expect(validated.version).toBe(1);
    expect(validated.vehicleRules.allowedUnits).toContain('KG');
    expect(validated.vehicleRules.allowedUnits).toContain('LITER');
    expect(validated.vehicleRules.allowedBases).toContain('ESTIMATED');
    expect(validated.vehicleRules.allowedBases).toContain('MEASURED');
    expect(validated.allowSameUnitPortionPrefill).toBe(true);
  });

  it('[TEST-B] Validation rejects defaultUnit not present in allowedUnits', () => {
    const invalidPolicy = {
      version: 1,
      vehicleRules: {
        allowedUnits: ['LITER'],
        allowedBases: ['ESTIMATED'],
        allowedMethods: ['MANUAL_ESTIMATE'],
        defaultUnit: 'KG', // Invalid: KG not in allowedUnits
        defaultBasis: 'ESTIMATED',
        defaultMethod: 'MANUAL_ESTIMATE',
      },
      portionRules: {
        allowedUnits: ['KG'],
        allowedBases: ['ESTIMATED'],
        allowedMethods: ['MANUAL_ESTIMATE'],
        defaultUnit: 'KG',
        defaultBasis: 'ESTIMATED',
        defaultMethod: 'MANUAL_ESTIMATE',
      },
      allowSameUnitPortionPrefill: true,
    };

    expect(() => validateQuantityPolicy(invalidPolicy)).toThrow(/Default vehicle unit/);
  });

  it('[TEST-B2] Validation rejects defaultBasis not present in allowedBases', () => {
    const invalidPolicy = {
      version: 1,
      vehicleRules: {
        allowedUnits: ['KG'],
        allowedBases: ['ESTIMATED'],
        allowedMethods: ['MANUAL_ESTIMATE'],
        defaultUnit: 'KG',
        defaultBasis: 'MEASURED', // Invalid
        defaultMethod: 'MANUAL_ESTIMATE',
      },
      portionRules: {
        allowedUnits: ['KG'],
        allowedBases: ['ESTIMATED'],
        allowedMethods: ['MANUAL_ESTIMATE'],
        defaultUnit: 'KG',
        defaultBasis: 'ESTIMATED',
        defaultMethod: 'MANUAL_ESTIMATE',
      },
      allowSameUnitPortionPrefill: true,
    };

    expect(() => validateQuantityPolicy(invalidPolicy)).toThrow(/Default vehicle basis/);
  });

  it('[TEST-B3] Validation rejects empty allowed units or methods', () => {
    const invalidPolicy = {
      version: 1,
      vehicleRules: {
        allowedUnits: [], // Invalid: empty
        allowedBases: ['ESTIMATED'],
        allowedMethods: ['MANUAL_ESTIMATE'],
        defaultUnit: 'KG',
        defaultBasis: 'ESTIMATED',
        defaultMethod: 'MANUAL_ESTIMATE',
      },
      portionRules: {
        allowedUnits: ['KG'],
        allowedBases: ['ESTIMATED'],
        allowedMethods: ['MANUAL_ESTIMATE'],
        defaultUnit: 'KG',
        defaultBasis: 'ESTIMATED',
        defaultMethod: 'MANUAL_ESTIMATE',
      },
      allowSameUnitPortionPrefill: true,
    };

    expect(() => validateQuantityPolicy(invalidPolicy)).toThrow();
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

    // Assert that source_type or CONTRACTOR / ZMCC is not branch logic in quantity policy engine
    expect(serviceCode).not.toContain('source_type ===');
    expect(serviceCode).not.toContain('CONTRACTOR');
    expect(serviceCode).not.toContain('ZMCC');

    expect(validationCode).not.toContain('source_type ===');
    expect(validationCode).not.toContain('CONTRACTOR');
    expect(validationCode).not.toContain('ZMCC');
  });
});

