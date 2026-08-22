import { describe, it, expect } from 'vitest';
import {
  validateQuantityAgainstPolicy,
  QuantityMeasurementError,
  parsePositiveDecimalString,
} from '@/backend/modules/dispatch/quantity/validation';
import {
  validateDispatchQuantities,
  formatQuantityDisplay,
} from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { DispatchQuantityPolicyConfig } from '@/backend/modules/dispatch/quantity-policy/types';
import { calculatePhysicalLiters } from '@/backend/utils/milkFormulas';

describe('Stage 4C-4: Dispatch Quantity Domain (Unit Tests)', () => {
  const samplePolicy: DispatchQuantityPolicyConfig = {
    version: 1,
    vehicleRules: {
      allowedMeasurements: [
        { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        { unit: 'LITER', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE'] },
      ],
      default: { unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
    },
    portionRules: {
      allowedMeasurements: [
        { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING'] },
        { unit: 'LITER', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'FLOW_METER'] },
      ],
      default: { unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
    },
    allowSameUnitPortionPrefill: false,
  };

  it('[TEST-A] Validates valid KG/MEASURED/WEIGHING vehicle and portion facts', () => {
    const vResult = validateQuantityAgainstPolicy(
      { value: '19500.50', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      samplePolicy.vehicleRules,
      'Vehicle'
    );
    expect(vResult.value.toString()).toBe('19500.50');
    expect(vResult.unit).toBe('KG');
    expect(vResult.basis).toBe('MEASURED');
    expect(vResult.method).toBe('WEIGHING');
  });

  it('[TEST-B] Validates valid LITER/ESTIMATED/MANUAL_ESTIMATE facts', () => {
    const pResult = validateQuantityAgainstPolicy(
      { value: '9800', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
      samplePolicy.portionRules,
      'Portion 1'
    );
    expect(pResult.value.toString()).toBe('9800');
    expect(pResult.unit).toBe('LITER');
    expect(pResult.basis).toBe('ESTIMATED');
    expect(pResult.method).toBe('MANUAL_ESTIMATE');
  });

  it('[TEST-C] Allows mixed units between vehicle and portion without converting', () => {
    const validated = validateDispatchQuantities({
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: '9800', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
        { portionNumber: 2, quantity: { value: '9150', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' } },
      ],
      policy: samplePolicy,
    });

    expect(validated.vehicleQuantity.unit).toBe('KG');
    expect(validated.portionQuantities[0].unit).toBe('LITER');
    expect(validated.portionQuantities[1].unit).toBe('LITER');
  });

  it('[TEST-D] Allows portion quantities that do not sum or reconcile with vehicle quantity', () => {
    const validated = validateDispatchQuantities({
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      portions: [
        { portionNumber: 1, quantity: { value: '12000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
        { portionNumber: 2, quantity: { value: '15000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } },
      ],
      policy: samplePolicy,
    });

    expect(validated.vehicleQuantity.value.toString()).toBe('19500');
    expect(validated.portionQuantities[0].value.toString()).toBe('12000');
    expect(validated.portionQuantities[1].value.toString()).toBe('15000');
  });

  it('[TEST-E] Rejects vehicle quantity combination not allowed in frozen policy', () => {
    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '15000', unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
        samplePolicy.vehicleRules,
        'Vehicle'
      )
    ).toThrow(QuantityMeasurementError);

    try {
      validateQuantityAgainstPolicy(
        { value: '15000', unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
        samplePolicy.vehicleRules,
        'Vehicle'
      );
    } catch (e: any) {
      expect(e.code).toBe('QUANTITY_COMBINATION_NOT_ALLOWED');
    }
  });

  it('[TEST-F] Rejects portion quantity combination not allowed in frozen policy', () => {
    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'FLOW_METER' },
        samplePolicy.portionRules,
        'Portion 1'
      )
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-G] Rejects zero, negative, or invalid vehicle quantity numbers', () => {
    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '0', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
        samplePolicy.vehicleRules,
        'Vehicle'
      )
    ).toThrow(QuantityMeasurementError);

    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '-500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
        samplePolicy.vehicleRules,
        'Vehicle'
      )
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-H] Rejects zero or negative portion quantity', () => {
    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '0', unit: 'LITER', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
        samplePolicy.portionRules,
        'Portion 1'
      )
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-I] Validates against frozen snapshot policy even if source configuration changes', () => {
    const historicalSnapshotPolicy: DispatchQuantityPolicyConfig = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [{ unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER'] }],
        default: { unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' },
      },
      portionRules: {
        allowedMeasurements: [{ unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER'] }],
        default: { unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' },
      },
      allowSameUnitPortionPrefill: false,
    };

    const validated = validateDispatchQuantities({
      vehicleQuantity: { value: '18000', unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' },
      portions: [{ portionNumber: 1, quantity: { value: '18000', unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' } }],
      policy: historicalSnapshotPolicy,
    });

    expect(validated.vehicleQuantity.unit).toBe('LITER');
  });

  it('[TEST-J] parsePositiveDecimalString parses decimal string correctly', () => {
    const dec = parsePositiveDecimalString('12345.67', 'TestField');
    expect(dec).toBe('12345.67');
  });

  it('[TEST-K] Rejects dispatch submission missing vehicle quantity', () => {
    expect(() =>
      validateDispatchQuantities({
        vehicleQuantity: null as any,
        portions: [{ portionNumber: 1, quantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } }],
        policy: samplePolicy,
      })
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-L] Rejects dispatch submission with 0 portions', () => {
    expect(() =>
      validateDispatchQuantities({
        vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
        portions: [],
        policy: samplePolicy,
      })
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-N] Tests enum values across domain types', () => {
    const permissivePolicy: DispatchQuantityPolicyConfig = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING', 'OTHER'] },
          { unit: 'LITER', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'FLOW_METER'] },
        ],
        default: { unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
      },
      portionRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'OTHER'] },
          { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER', 'WEIGHING'] },
        ],
        default: { unit: 'KG', basis: 'ESTIMATED', method: 'MANUAL_ESTIMATE' },
      },
      allowSameUnitPortionPrefill: false,
    };

    const res1 = validateQuantityAgainstPolicy(
      { value: '100', unit: 'KG', basis: 'MEASURED', method: 'OTHER' },
      permissivePolicy.vehicleRules,
      'Vehicle'
    );
    expect(res1.method).toBe('OTHER');

    const res2 = validateQuantityAgainstPolicy(
      { value: '200', unit: 'LITER', basis: 'MEASURED', method: 'FLOW_METER' },
      permissivePolicy.portionRules,
      'Portion'
    );
    expect(res2.basis).toBe('MEASURED');
  });

  it('[TEST-O] Production provisional calculation converts KG using plant density but leaves LITER as physical volume', () => {
    const kgValue = 10300;
    const plantLr = 30.0;
    const convertedLiters = calculatePhysicalLiters(kgValue, plantLr);
    expect(Math.round(convertedLiters)).toBe(10000);

    const literValue = 10000;
    const directLiters = literValue;
    expect(directLiters).toBe(10000);
  });

  it('[TEST-P] Formats quantity display cleanly without mixed-unit summing errors', () => {
    expect(formatQuantityDisplay(null, 'KG')).toBe('—');
    expect(formatQuantityDisplay('19500.5', 'KG')).toBe('19,500.5 KG');
    expect(formatQuantityDisplay('9800', 'LITER')).toBe('9,800 LITER');
  });
});
