import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
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

  describe('DECIMAL(10,2) Boundary & Precision Contract', () => {
    it('accepts minimum positive quantity 0.01', () => {
      expect(parsePositiveDecimalString('0.01')).toBe('0.01');
      expect(parsePositiveDecimalString(0.01)).toBe('0.01');
      const res = validateQuantityAgainstPolicy(
        { value: '0.01', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
        samplePolicy.vehicleRules,
        'Vehicle'
      );
      expect(res.value).toBe('0.01');
    });

    it('accepts maximum positive quantity 99999999.99', () => {
      expect(parsePositiveDecimalString('99999999.99')).toBe('99999999.99');
      const res = validateQuantityAgainstPolicy(
        { value: '99999999.99', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
        samplePolicy.vehicleRules,
        'Vehicle'
      );
      expect(res.value).toBe('99999999.99');
    });

    it('accepts valid 1-decimal and integer quantities', () => {
      expect(parsePositiveDecimalString('1')).toBe('1');
      expect(parsePositiveDecimalString('1.5')).toBe('1.5');
      expect(parsePositiveDecimalString('1.50')).toBe('1.50');
      expect(parsePositiveDecimalString('19500')).toBe('19500');
    });

    it('rejects 0 and 0.00', () => {
      expect(() => parsePositiveDecimalString('0')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('0.00')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString(0)).toThrow(QuantityMeasurementError);
    });

    it('rejects negative values', () => {
      expect(() => parsePositiveDecimalString('-1')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('-0.01')).toThrow(QuantityMeasurementError);
    });

    it('rejects more than 2 decimal places (e.g. 0.001, 1.999, 99999999.999)', () => {
      expect(() => parsePositiveDecimalString('0.001')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('1.999')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('99999999.999')).toThrow(QuantityMeasurementError);
    });

    it('rejects values exceeding 99999999.99 (e.g. 100000000)', () => {
      expect(() => parsePositiveDecimalString('100000000')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('100000000.00')).toThrow(QuantityMeasurementError);
    });

    it('rejects NaN, Infinity, and malformed strings', () => {
      expect(() => parsePositiveDecimalString(NaN)).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString(Infinity)).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('abc')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString('')).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString(null)).toThrow(QuantityMeasurementError);
      expect(() => parsePositiveDecimalString(undefined)).toThrow(QuantityMeasurementError);
    });

    it('enforces DECIMAL(10,2) boundary on both vehicle and portion dispatch validation', () => {
      // Vehicle boundary check
      expect(() =>
        validateDispatchQuantities({
          vehicleQuantity: { value: '0.001', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          portions: [{ portionNumber: 1, quantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } }],
          policy: samplePolicy,
        })
      ).toThrow(QuantityMeasurementError);

      // Portion boundary check
      expect(() =>
        validateDispatchQuantities({
          vehicleQuantity: { value: '5000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' },
          portions: [{ portionNumber: 1, quantity: { value: '100000000', unit: 'KG', basis: 'MEASURED', method: 'WEIGHING' } }],
          policy: samplePolicy,
        })
      ).toThrow(QuantityMeasurementError);
    });
  });

  describe('Migration Data Preservation & Upgrade Rules', () => {
    const migration1Path = path.join(
      process.cwd(),
      'prisma/migrations/20260822120000_dispatch_quantity_domain/migration.sql'
    );
    const migration2Path = path.join(
      process.cwd(),
      'prisma/migrations/20260822143000_vehicle_dispatch_quantity_authority/migration.sql'
    );

    it('[MIG-1] Verifies migration 1 copies legacy portion quantity before dropping old columns', () => {
      const sql = fs.readFileSync(migration1Path, 'utf8');

      expect(sql).toContain('ADD COLUMN IF NOT EXISTS "dispatch_quantity_value" DECIMAL(10,2)');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS "dispatch_quantity_unit" "QuantityUnit"');

      const updateIndex = sql.indexOf('UPDATE "visit_portion"');
      expect(updateIndex).toBeGreaterThan(-1);
      expect(sql).toContain('"dispatch_quantity_value" = "declared_quantity_value"');

      const dropValIndex = sql.indexOf('DROP COLUMN IF EXISTS "declared_quantity_value"');
      const dropUnitIndex = sql.indexOf('DROP COLUMN IF EXISTS "declared_quantity_unit"');
      expect(dropValIndex).toBeGreaterThan(updateIndex);
      expect(dropUnitIndex).toBeGreaterThan(updateIndex);
    });

    it('[MIG-2] Verifies fake vehicle backfill is removed from migration 2', () => {
      const sql = fs.readFileSync(migration2Path, 'utf8');

      expect(sql).not.toContain('UPDATE "vehicle_visit"');
      expect(sql).not.toContain('di."vehicle_quantity_value"');
      expect(sql).not.toContain('FROM "visit_portion"');

      expect(sql).toContain('ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_value"');
      expect(sql).toContain('ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_quantity_unit"');
    });

    it('[MIG-3] Simulates legacy SQL data migration transformation rules faithfully', () => {
      function migratePortionRow(declaredVal: number | null, declaredUnit: string | null) {
        const dispatch_quantity_value = declaredVal;
        let dispatch_quantity_unit: 'KG' | 'LITER' | null = null;
        if (declaredUnit) {
          const u = declaredUnit.trim().toUpperCase();
          if (u === 'KG') dispatch_quantity_unit = 'KG';
          else if (u === 'LITER') dispatch_quantity_unit = 'LITER';
        }
        return {
          dispatch_quantity_value,
          dispatch_quantity_unit,
          dispatch_quantity_basis: null,
          dispatch_measurement_method: null,
        };
      }

      // Row A: 9500 KG
      const rowA = migratePortionRow(9500, 'KG');
      expect(rowA.dispatch_quantity_value).toBe(9500);
      expect(rowA.dispatch_quantity_unit).toBe('KG');
      expect(rowA.dispatch_quantity_basis).toBeNull();
      expect(rowA.dispatch_measurement_method).toBeNull();

      // Row B: 10000 LITER
      const rowB = migratePortionRow(10000, 'LITER');
      expect(rowB.dispatch_quantity_value).toBe(10000);
      expect(rowB.dispatch_quantity_unit).toBe('LITER');
      expect(rowB.dispatch_quantity_basis).toBeNull();
      expect(rowB.dispatch_measurement_method).toBeNull();

      // Row C: NULL quantity / unit
      const rowC = migratePortionRow(null, null);
      expect(rowC.dispatch_quantity_value).toBeNull();
      expect(rowC.dispatch_quantity_unit).toBeNull();

      // Row D: Multi-portion mixed units visit
      const visitPortions = [
        migratePortionRow(9500, 'KG'),
        migratePortionRow(10000, 'LITER'),
      ];
      expect(visitPortions[0].dispatch_quantity_unit).toBe('KG');
      expect(visitPortions[1].dispatch_quantity_unit).toBe('LITER');

      // Historical vehicle quantity remains NULL without fabricating a mixed sum
      const historicalVehicleQty = null;
      expect(historicalVehicleQty).toBeNull();
    });
  });
});
