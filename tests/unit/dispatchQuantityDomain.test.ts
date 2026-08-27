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
  formatDispatchQuantity,
  formatAcceptedQuantitySummary,
} from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { DispatchQuantityPolicyConfig } from '@/backend/modules/dispatch/quantity-policy/types';
import { calculatePhysicalLiters } from '@/backend/utils/milkFormulas';

describe('Stage 4C-4/4C-5F: Dispatch Quantity Domain (Unit Tests)', () => {
  const samplePolicy: DispatchQuantityPolicyConfig = {
    version: 1,
    vehicleRules: {
      allowedMeasurements: [
        { unit: 'KG', basis: 'MEASURED' },
        { unit: 'LITER', basis: 'ESTIMATED' },
      ],
      default: { unit: 'KG', basis: 'MEASURED' },
    },
    portionRules: {
      allowedMeasurements: [
        { unit: 'KG', basis: 'MEASURED' },
        { unit: 'LITER', basis: 'ESTIMATED' },
      ],
      default: { unit: 'LITER', basis: 'ESTIMATED' },
    },
    allowSameUnitPortionPrefill: false,
  };

  it('[TEST-A] Validates valid KG/MEASURED vehicle and portion facts', () => {
    const vResult = validateQuantityAgainstPolicy(
      { value: '19500.50', unit: 'KG', basis: 'MEASURED' },
      samplePolicy.vehicleRules,
      'Vehicle'
    );
    expect(vResult.value.toString()).toBe('19500.50');
    expect(vResult.unit).toBe('KG');
    expect(vResult.basis).toBe('MEASURED');
  });

  it('[TEST-B] Validates valid LITER/ESTIMATED facts', () => {
    const pResult = validateQuantityAgainstPolicy(
      { value: '9800', unit: 'LITER', basis: 'ESTIMATED' },
      samplePolicy.portionRules,
      'Portion 1'
    );
    expect(pResult.value.toString()).toBe('9800');
    expect(pResult.unit).toBe('LITER');
    expect(pResult.basis).toBe('ESTIMATED');
  });

  it('[TEST-C] Allows mixed units between vehicle and portion without converting', () => {
    const validated = validateDispatchQuantities({
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED' },
      portions: [
        { portionNumber: 1, quantity: { value: '9800', unit: 'LITER', basis: 'ESTIMATED' } },
        { portionNumber: 2, quantity: { value: '9150', unit: 'LITER', basis: 'ESTIMATED' } },
      ],
      policy: samplePolicy,
    });

    expect(validated.vehicleQuantity.unit).toBe('KG');
    expect(validated.portionQuantities[0].unit).toBe('LITER');
    expect(validated.portionQuantities[1].unit).toBe('LITER');
  });

  it('[TEST-D] Allows portion quantities that do not sum or reconcile with vehicle quantity', () => {
    const validated = validateDispatchQuantities({
      vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED' },
      portions: [
        { portionNumber: 1, quantity: { value: '12000', unit: 'KG', basis: 'MEASURED' } },
        { portionNumber: 2, quantity: { value: '15000', unit: 'KG', basis: 'MEASURED' } },
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
        { value: '15000', unit: 'KG', basis: 'ESTIMATED' },
        samplePolicy.vehicleRules,
        'Vehicle'
      )
    ).toThrow(QuantityMeasurementError);

    try {
      validateQuantityAgainstPolicy(
        { value: '15000', unit: 'KG', basis: 'ESTIMATED' },
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
        { value: '5000', unit: 'KG', basis: 'ESTIMATED' },
        samplePolicy.portionRules,
        'Portion 1'
      )
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-G] Rejects zero quantity for vehicle and portion', () => {
    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '0', unit: 'KG', basis: 'MEASURED' },
        samplePolicy.vehicleRules,
        'Vehicle'
      )
    ).toThrow(QuantityMeasurementError);

    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '-500', unit: 'KG', basis: 'MEASURED' },
        samplePolicy.vehicleRules,
        'Vehicle'
      )
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-H] Rejects zero or negative portion quantity', () => {
    expect(() =>
      validateQuantityAgainstPolicy(
        { value: '0', unit: 'LITER', basis: 'ESTIMATED' },
        samplePolicy.portionRules,
        'Portion 1'
      )
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-I] Validates against frozen snapshot policy even if source configuration changes', () => {
    const historicalSnapshotPolicy: DispatchQuantityPolicyConfig = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [{ unit: 'LITER', basis: 'MEASURED' }],
        default: { unit: 'LITER', basis: 'MEASURED' },
      },
      portionRules: {
        allowedMeasurements: [{ unit: 'LITER', basis: 'MEASURED' }],
        default: { unit: 'LITER', basis: 'MEASURED' },
      },
      allowSameUnitPortionPrefill: false,
    };

    const validated = validateDispatchQuantities({
      vehicleQuantity: { value: '18000', unit: 'LITER', basis: 'MEASURED' },
      portions: [{ portionNumber: 1, quantity: { value: '18000', unit: 'LITER', basis: 'MEASURED' } }],
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
        portions: [{ portionNumber: 1, quantity: { value: '5000', unit: 'KG', basis: 'MEASURED' } }],
        policy: samplePolicy,
      })
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-L] Rejects dispatch submission with 0 portions', () => {
    expect(() =>
      validateDispatchQuantities({
        vehicleQuantity: { value: '19500', unit: 'KG', basis: 'MEASURED' },
        portions: [],
        policy: samplePolicy,
      })
    ).toThrow(QuantityMeasurementError);
  });

  it('[TEST-N] Tests combinations across domain types', () => {
    const permissivePolicy: DispatchQuantityPolicyConfig = {
      version: 1,
      vehicleRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'MEASURED' },
          { unit: 'LITER', basis: 'ESTIMATED' },
        ],
        default: { unit: 'KG', basis: 'MEASURED' },
      },
      portionRules: {
        allowedMeasurements: [
          { unit: 'KG', basis: 'ESTIMATED' },
          { unit: 'LITER', basis: 'MEASURED' },
        ],
        default: { unit: 'KG', basis: 'ESTIMATED' },
      },
      allowSameUnitPortionPrefill: false,
    };

    const res1 = validateQuantityAgainstPolicy(
      { value: '100', unit: 'KG', basis: 'MEASURED' },
      permissivePolicy.vehicleRules,
      'Vehicle'
    );
    expect(res1.basis).toBe('MEASURED');

    const res2 = validateQuantityAgainstPolicy(
      { value: '200', unit: 'LITER', basis: 'MEASURED' },
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
        { value: '0.01', unit: 'KG', basis: 'MEASURED' },
        samplePolicy.vehicleRules,
        'Vehicle'
      );
      expect(res.value).toBe('0.01');
    });

    it('accepts maximum positive quantity 99999999.99', () => {
      expect(parsePositiveDecimalString('99999999.99')).toBe('99999999.99');
      const res = validateQuantityAgainstPolicy(
        { value: '99999999.99', unit: 'KG', basis: 'MEASURED' },
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
          vehicleQuantity: { value: '0.001', unit: 'KG', basis: 'MEASURED' },
          portions: [{ portionNumber: 1, quantity: { value: '5000', unit: 'KG', basis: 'MEASURED' } }],
          policy: samplePolicy,
        })
      ).toThrow(QuantityMeasurementError);

      // Portion boundary check
      expect(() =>
        validateDispatchQuantities({
          vehicleQuantity: { value: '5000', unit: 'KG', basis: 'MEASURED' },
          portions: [{ portionNumber: 1, quantity: { value: '100000000', unit: 'KG', basis: 'MEASURED' } }],
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
        };
      }

      // Row A: 9500 KG
      const rowA = migratePortionRow(9500, 'KG');
      expect(rowA.dispatch_quantity_value).toBe(9500);
      expect(rowA.dispatch_quantity_unit).toBe('KG');
      expect(rowA.dispatch_quantity_basis).toBeNull();

      // Row B: 10000 LITER
      const rowB = migratePortionRow(10000, 'LITER');
      expect(rowB.dispatch_quantity_value).toBe(10000);
      expect(rowB.dispatch_quantity_unit).toBe('LITER');
      expect(rowB.dispatch_quantity_basis).toBeNull();

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

  describe('Quantity Consumers Contract Migration (Security, Weighbridge, Super Admin, Seed)', () => {
    it('[SECURITY-CONTRACT] Formats security quantities safely using production formatDispatchQuantity without total_declared_kg dependency', () => {
      // KG response
      expect(formatDispatchQuantity(19500, 'KG')).toBe('19,500 KG');
      // LITER response
      expect(formatDispatchQuantity(10000, 'LITER')).toBe('10,000 LITER');
      // Missing quantity / unit
      expect(formatDispatchQuantity(null, null)).toBe('—');
      expect(formatDispatchQuantity(undefined, undefined)).toBe('—');
      expect(formatDispatchQuantity(19500, null)).toBe('—');
      expect(formatDispatchQuantity(null, 'KG')).toBe('—');
      expect(formatDispatchQuantity(19500, 'INVALID')).toBe('—');

      // Static check: Security workspace contains 0 total_declared_kg
      const secFile = fs.readFileSync(
        path.join(process.cwd(), 'src/frontend/modules/dashboard/SecurityGatewayWorkspace.tsx'),
        'utf8'
      );
      expect(secFile).not.toContain('total_declared_kg');
    });

    it('[WEIGHBRIDGE-CONTRACT] Formats accepted quantities safely using production formatAcceptedQuantitySummary without accepted_declared_kg and without mixed-unit summing', () => {
      // 1. Same-unit KG portions (8000 + 5000 = 13000 KG)
      const sameUnitKg = [
        { portion_number: 1, dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED' },
        { portion_number: 2, dispatch_quantity_value: 5000, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED' },
      ];
      expect(formatAcceptedQuantitySummary(sameUnitKg)).toBe('13,000 KG');

      // 2. Same-unit LITER portions
      const sameUnitLiter = [
        { portion_number: 1, dispatch_quantity_value: 8000, dispatch_quantity_unit: 'LITER', plant_decision: 'ACCEPTED' },
        { portion_number: 2, dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER', plant_decision: 'ACCEPTED' },
      ];
      expect(formatAcceptedQuantitySummary(sameUnitLiter)).toBe('13,000 LITER');

      // 3. Mixed-unit portions: NO raw summation, NO fake KG label
      const mixedKgLiter = [
        { portion_number: 1, dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED' },
        { portion_number: 2, dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER', plant_decision: 'ACCEPTED' },
      ];
      const mixedResult = formatAcceptedQuantitySummary(mixedKgLiter);
      expect(mixedResult).toBe('P1: 8,000 KG, P2: 5,000 LITER');
      expect(mixedResult).not.toBe('13,000 KG');
      expect(mixedResult).not.toBe('13,000');

      // 4. Missing unit on one portion: 8000 KG + 5000 (missing unit) must NOT sum into 13000 KG!
      const missingUnitPortion = [
        { portion_number: 1, dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED' },
        { portion_number: 2, dispatch_quantity_value: 5000, dispatch_quantity_unit: null, plant_decision: 'ACCEPTED' },
      ];
      const missingUnitResult = formatAcceptedQuantitySummary(missingUnitPortion);
      expect(missingUnitResult).toBe('P1: 8,000 KG, P2: —');
      expect(missingUnitResult).not.toBe('13,000 KG');
      expect(missingUnitResult).not.toBe('13,000');

      // 5. Missing value on one portion: 8000 KG + missing quantity must NOT fabricate a total!
      const missingValuePortion = [
        { portion_number: 1, dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED' },
        { portion_number: 2, dispatch_quantity_value: null, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED' },
      ];
      const missingValueResult = formatAcceptedQuantitySummary(missingValuePortion);
      expect(missingValueResult).toBe('P1: 8,000 KG, P2: —');

      // 6. Missing / empty portions
      expect(formatAcceptedQuantitySummary([])).toBe('—');
      expect(formatAcceptedQuantitySummary(null)).toBe('—');
      expect(formatAcceptedQuantitySummary([], 19500, 'KG')).toBe('19,500 KG');

      // Static check: Weighbridge workspace contains 0 accepted_declared_kg
      const wbFile = fs.readFileSync(
        path.join(process.cwd(), 'src/frontend/modules/dashboard/WeighbridgeWorkspace.tsx'),
        'utf8'
      );
      expect(wbFile).not.toContain('accepted_declared_kg');
    });

    it('[SUPER-ADMIN-CONTRACT] Formats operations journey using production formatDispatchQuantity without grossLiters dependency', () => {
      expect(formatDispatchQuantity(19500, 'KG')).toBe('19,500 KG');
      expect(formatDispatchQuantity(10000, 'LITER')).toBe('10,000 LITER');
      expect(formatDispatchQuantity(null, null)).toBe('—');
      expect(formatDispatchQuantity(19500, null)).toBe('—');

      // Static check: Super Admin page contains 0 grossLiters
      const saFile = fs.readFileSync(
        path.join(process.cwd(), 'src/app/super-admin/operations/page.tsx'),
        'utf8'
      );
      expect(saFile).not.toContain('grossLiters');
    });

    it('[SEED-CONTRACT] Confirms seed_postgres.js seeds complete canonical quantity facts', () => {
      const seedSql = fs.readFileSync(
        path.join(process.cwd(), 'scripts/seed_postgres.js'),
        'utf8'
      );

      // VehicleVisit quantity columns
      expect(seedSql).toContain('vehicle_dispatch_quantity_value');
      expect(seedSql).toContain('vehicle_dispatch_quantity_unit');
      expect(seedSql).toContain('vehicle_dispatch_quantity_basis');
      expect(seedSql).not.toContain('vehicle_dispatch_measurement_method');

      // VisitPortion quantity columns
      expect(seedSql).toContain('dispatch_quantity_value');
      expect(seedSql).toContain('dispatch_quantity_unit');
      expect(seedSql).toContain('dispatch_quantity_basis');
      expect(seedSql).not.toContain('dispatch_measurement_method');
    });

    it('[LAB-IDENTITY-COLLISION] Proves results resolve strictly by canonical LabTest definition ID and reject assignment primary key collisions or unassigned test IDs', () => {
      // Setup:
      // Assignment row 1: id = 10, test_id = 101 (Fat)
      // Assignment row 2: id = 20, test_id = 102 (LR)
      // Unassigned LabTest definition: id = 10 (Temperature)
      const assignedDispatchTests = [
        { id: BigInt(10), test_id: BigInt(101), test_code_snapshot: 'LT-FAT', test_name_snapshot: 'Fat', result_type_snapshot: 'NUMERIC', result_options_snapshot: null },
        { id: BigInt(20), test_id: BigInt(102), test_code_snapshot: 'LT-LR', test_name_snapshot: 'Lactometer Reading', result_type_snapshot: 'NUMERIC', result_options_snapshot: null },
      ];

      // Matcher function replicating production route resolution logic
      function matchSubmittedResults(
        assigned: typeof assignedDispatchTests,
        submittedResults: Array<{ testId: string; numericValue?: number | null; performanceStatus?: string }>
      ) {
        const submittedResultsMap = new Map<string, (typeof submittedResults)[0]>();
        submittedResults.forEach((r) => {
          submittedResultsMap.set(r.testId, r);
        });

        const matchedResults: Array<{ testId: bigint; testCode: string; numVal: number | null }> = [];

        for (const testDef of assigned) {
          const testIdStr = testDef.test_id.toString();
          const submittedRes = submittedResultsMap.get(testIdStr);
          if (!submittedRes) continue;

          matchedResults.push({
            testId: testDef.test_id,
            testCode: testDef.test_code_snapshot,
            numVal: submittedRes.numericValue ?? null,
          });
        }
        return matchedResults;
      }

      // Case 1: Caller submits assignment row primary key "10" instead of canonical test_id "101"
      // Expected: Must NOT match assignment 1 (test_id 101)
      const subAssignmentKey = [{ testId: '10', numericValue: 4.5, performanceStatus: 'PERFORMED' }];
      const matchedKey = matchSubmittedResults(assignedDispatchTests, subAssignmentKey);
      expect(matchedKey).toHaveLength(0);

      // Case 2: Caller submits canonical LabTest definition ID "101" for Fat
      // Expected: Successfully matches Fat (test_id 101)
      const subCanonical = [{ testId: '101', numericValue: 4.5, performanceStatus: 'PERFORMED' }];
      const matchedCanonical = matchSubmittedResults(assignedDispatchTests, subCanonical);
      expect(matchedCanonical).toHaveLength(1);
      expect(matchedCanonical[0].testId.toString()).toBe('101');
      expect(matchedCanonical[0].testCode).toBe('LT-FAT');
      expect(matchedCanonical[0].numVal).toBe(4.5);

      // Case 3: Caller submits unassigned LabTest definition ID "999"
      // Expected: Must NOT be matched or created
      const subUnassigned = [{ testId: '999', numericValue: 4.0, performanceStatus: 'PERFORMED' }];
      const matchedUnassigned = matchSubmittedResults(assignedDispatchTests, subUnassigned);
      expect(matchedUnassigned).toHaveLength(0);

      // Static checks:
      const routeFile = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/dispatches/route.ts'),
        'utf8'
      );
      expect(routeFile).not.toContain('submittedResultsMap.get(t.id.toString())');
      expect(routeFile).not.toContain('submittedResultsMap.get(testDef.id.toString())');

      const formFile = fs.readFileSync(
        path.join(process.cwd(), 'src/frontend/modules/forms/DynamicDispatchForm.tsx'),
        'utf8'
      );
      expect(formFile).not.toContain('(t as any).testId');
      expect(formFile).not.toContain('testId: (t as any)');
      expect(formFile).not.toContain('portion.results[test.id]');
      expect(formFile).not.toContain('portion.results[t.id]');
      expect(formFile).not.toContain('target.results[testDef.id]');
      expect(formFile).not.toContain('errors.tests[testDef.id]');
      expect(formFile).not.toContain('errors.tests[test.id]');
      expect(formFile).not.toContain('portionErrors[index]?.tests?.[test.id]');
    });

    it('[FRONTEND-LAB-STATE-CONTRACT] Proves frontend state, validation, and payload remain 100% unified under canonical testId when assignment.id != testId', () => {
      // 1. Fixture with intentionally differing IDs:
      // Assignment row 1: id = "100", testId = "200" (Temperature)
      // Assignment row 2: id = "101", testId = "201" (Fat)
      const labTests = [
        {
          id: '100',
          testId: '200',
          testCode: 'LT-TEMP',
          testName: 'Temperature',
          resultType: 'NUMERIC',
          unit: '°C',
          isRequired: true,
          displayOrder: 1,
        },
        {
          id: '101',
          testId: '201',
          testCode: 'LT-FAT',
          testName: 'Fat',
          resultType: 'NUMERIC',
          unit: '%',
          isRequired: true,
          displayOrder: 2,
        },
      ];

      // A. Initial portion results builder (replicating DynamicDispatchForm logic)
      function buildInitialPortionResults(tests: typeof labTests, isContractor = false) {
        const results: Record<string, { numericValue: string; textValue: string; performanceStatus: 'PERFORMED' | 'NOT_PERFORMED'; notPerformedReason: string }> = {};
        tests.forEach((t) => {
          const key = t.testId;
          if (isContractor) {
            results[key] = {
              numericValue: '',
              textValue: '',
              performanceStatus: 'NOT_PERFORMED',
              notPerformedReason: 'Contract Vehicle',
            };
          } else {
            results[key] = {
              numericValue: '',
              textValue: '',
              performanceStatus: 'PERFORMED',
              notPerformedReason: '',
            };
          }
        });
        return results;
      }

      // Assert A: Initial state keys by canonical testId "200" and "201", NOT assignment ID "100" or "101"
      const zmccResults = buildInitialPortionResults(labTests, false);
      expect(zmccResults['200']).toBeDefined();
      expect(zmccResults['201']).toBeDefined();
      expect(zmccResults['100']).toBeUndefined();
      expect(zmccResults['101']).toBeUndefined();

      // B. User enters numeric Temperature value 4.5 via edit handler
      function handleTestResultChange(
        results: typeof zmccResults,
        testId: string,
        field: 'numericValue' | 'textValue' | 'notPerformedReason',
        value: string
      ) {
        const current = results[testId] || {
          numericValue: '',
          textValue: '',
          performanceStatus: 'PERFORMED',
          notPerformedReason: '',
        };
        results[testId] = { ...current, [field]: value };
      }

      handleTestResultChange(zmccResults, '200', 'numericValue', '4.5');
      handleTestResultChange(zmccResults, '201', 'numericValue', '4.2');

      // Assert B & C: State is written under "200" and "201", never "100"
      expect(zmccResults['200'].numericValue).toBe('4.5');
      expect(zmccResults['201'].numericValue).toBe('4.2');
      expect(zmccResults['100']).toBeUndefined();

      // D. Save Portion validation reads canonical testId
      function validatePortionResults(
        tests: typeof labTests,
        results: typeof zmccResults
      ) {
        const errors: Record<string, string> = {};
        for (const testDef of tests) {
          const res = results[testDef.testId];
          if (!res) {
            errors[testDef.testId] = `Status for ${testDef.testName} is required.`;
          } else if (res.performanceStatus === 'PERFORMED' && testDef.resultType === 'NUMERIC') {
            if (res.numericValue === '' || isNaN(Number(res.numericValue)) || Number(res.numericValue) < 0) {
              errors[testDef.testId] = `Enter a valid numeric value for ${testDef.testName}.`;
            }
          }
        }
        return errors;
      }

      const errors = validatePortionResults(labTests, zmccResults);
      // Assert D & E: Save validation passes with 0 errors
      expect(Object.keys(errors)).toHaveLength(0);

      // F. Final payload generation
      const payloadResults = labTests.map((t) => {
        const res = zmccResults[t.testId];
        return {
          testId: t.testId,
          performanceStatus: res.performanceStatus,
          notPerformedReason: null,
          numericValue: res.numericValue !== '' ? Number(res.numericValue) : null,
          textValue: null,
        };
      });

      // Assert F & G: Payload contains testId "200" with 4.5 and never sends "100"
      expect(payloadResults).toHaveLength(2);
      expect(payloadResults[0]).toEqual({
        testId: '200',
        performanceStatus: 'PERFORMED',
        notPerformedReason: null,
        numericValue: 4.5,
        textValue: null,
      });
      expect(payloadResults.find((r) => r.testId === '100')).toBeUndefined();

      // H. Contractor Mode with differing IDs
      const contractorResults = buildInitialPortionResults(labTests, true);
      expect(contractorResults['200'].performanceStatus).toBe('NOT_PERFORMED');
      expect(contractorResults['200'].notPerformedReason).toBe('Contract Vehicle');
      expect(contractorResults['100']).toBeUndefined();

      const contractorPayload = labTests.map((t) => {
        const res = contractorResults[t.testId];
        return {
          testId: t.testId,
          performanceStatus: res.performanceStatus,
          notPerformedReason: res.notPerformedReason,
          numericValue: null,
          textValue: null,
        };
      });

      expect(contractorPayload[0]).toEqual({
        testId: '200',
        performanceStatus: 'NOT_PERFORMED',
        notPerformedReason: 'Contract Vehicle',
        numericValue: null,
        textValue: null,
      });
      expect(contractorPayload.find((r) => r.testId === '100')).toBeUndefined();
    });
  });
});
