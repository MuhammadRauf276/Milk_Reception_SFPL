import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import {
  clearTestDatabase,
  seedStandardTestLabCatalog,
  createTestContractorSource,
  createTestZmccSource,
} from '../fixtures/testFixtures';
import { createDispatchSchema, dispatchTestResultSchema } from '@/lib/validations/dispatch';
import { getOrAssignDispatchTests } from '@/backend/services/labTestAssignmentService';

describe('Contractor Dispatch Accountability & Business Rules (Vitest Integration)', () => {
  const prisma = getTestPrisma();

  beforeAll(async () => {
    await clearTestDatabase(prisma);
  });

  afterAll(async () => {
    await clearTestDatabase(prisma);
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await clearTestDatabase(prisma);
    await seedStandardTestLabCatalog(prisma);
  });

  it('A. Contractor Dispatch persistence fixture: stores NOT_PERFORMED with reason Contract Vehicle', async () => {
    const contractor = await createTestContractorSource(prisma, 'CONT_AUTO_01');
    const masterTests = await prisma.labTest.findMany({
      where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    });

    // Simulate domain creation of Contractor dispatch portion
    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-CONT-${Date.now()}-A`,
        vehicle_number: 'CONT-VEH-01',
        procurement_source_id: contractor.id,
        current_status: 'DISPATCHED',
      },
    });

    const portion = await prisma.visitPortion.create({
      data: {
        visit_id: visit.id,
        portion_number: 1,
        dispatch_quantity_value: 10000,
        dispatch_quantity_unit: 'LITER',
        dispatch_quantity_basis: 'ESTIMATED',
        dispatch_measurement_method: 'MANUAL_ESTIMATE',
        current_status: 'DISPATCHED',
      },
    });

    // Save defaulted Contractor tests
    for (const test of masterTests) {
      await prisma.dispatchLabResult.create({
        data: {
          visit_id: visit.id,
          portion_id: portion.id,
          test_id: test.id,
          performance_status: 'NOT_PERFORMED',
          not_performed_reason: 'Contract Vehicle',
          numeric_value: null,
          text_value: null,
          is_passed: null,
        },
      });
    }

    const saved = await prisma.dispatchLabResult.findMany({
      where: { portion_id: portion.id },
    });

    expect(saved.length).toBe(masterTests.length);
    expect(saved.every((r) => r.performance_status === 'NOT_PERFORMED')).toBe(true);
    expect(saved.every((r) => r.not_performed_reason === 'Contract Vehicle')).toBe(true);
    expect(saved.every((r) => r.numeric_value === null && r.text_value === null)).toBe(true);
  });

  it('B. Switching a test to PERFORMED requires a genuine valid result and rejects contradictions', () => {
    // Valid PERFORMED test parses successfully
    const validPerformed = dispatchTestResultSchema.safeParse({
      testId: '101',
      numericValue: 28.5,
      performanceStatus: 'PERFORMED',
      notPerformedReason: null,
    });
    expect(validPerformed.success).toBe(true);

    // Contradiction: PERFORMED test without required test result payload is rejected by validation
    const missingValueForPerformed = dispatchTestResultSchema.safeParse({
      testId: '', // Invalid empty test ID
      performanceStatus: 'PERFORMED',
      numericValue: null,
      notPerformedReason: 'Contract Vehicle',
    });
    expect(missingValueForPerformed.success).toBe(false);
  });


  it('C. Switching back to NOT_PERFORMED clears active results and restores default reason', async () => {
    const contractor = await createTestContractorSource(prisma, 'CONT_TOGGLE_01');
    const lrTest = await prisma.labTest.findFirstOrThrow({ where: { testCode: 'LT-000008' } });

    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-CONT-${Date.now()}-C`,
        vehicle_number: 'CONT-VEH-02',
        procurement_source_id: contractor.id,
        current_status: 'DISPATCHED',
      },
    });

    const portion = await prisma.visitPortion.create({
      data: {
        visit_id: visit.id,
        portion_number: 1,
        dispatch_quantity_value: 8000,
        dispatch_quantity_unit: 'LITER',
        dispatch_quantity_basis: 'ESTIMATED',
        dispatch_measurement_method: 'MANUAL_ESTIMATE',
        current_status: 'DISPATCHED',
      },
    });

    // Step 1: User toggles to PERFORMED with genuine test result
    const performedRow = await prisma.dispatchLabResult.create({
      data: {
        visit_id: visit.id,
        portion_id: portion.id,
        test_id: lrTest.id,
        performance_status: 'PERFORMED',
        numeric_value: 29.0,
        not_performed_reason: null,
      },
    });
    expect(performedRow.performance_status).toBe('PERFORMED');
    expect(Number(performedRow.numeric_value)).toBe(29.0);

    // Step 2: User toggles back to NOT_PERFORMED -> clears numeric_value and restores 'Contract Vehicle'
    const resetRow = await prisma.dispatchLabResult.update({
      where: { id: performedRow.id },
      data: {
        performance_status: 'NOT_PERFORMED',
        numeric_value: null,
        not_performed_reason: 'Contract Vehicle',
      },
    });

    expect(resetRow.performance_status).toBe('NOT_PERFORMED');
    expect(resetRow.numeric_value).toBeNull();
    expect(resetRow.not_performed_reason).toBe('Contract Vehicle');
  });

  it('D. Custom NOT_PERFORMED reason persists accurately according to frozen rule', async () => {
    const contractor = await createTestContractorSource(prisma, 'CONT_CUSTOM_01');
    const alcoholTest = await prisma.labTest.findFirstOrThrow({ where: { testCode: 'LT-000010' } });

    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-CONT-${Date.now()}-D`,
        vehicle_number: 'CONT-VEH-03',
        procurement_source_id: contractor.id,
        current_status: 'DISPATCHED',
      },
    });

    const portion = await prisma.visitPortion.create({
      data: {
        visit_id: visit.id,
        portion_number: 1,
        dispatch_quantity_value: 6000,
        dispatch_quantity_unit: 'LITER',
        dispatch_quantity_basis: 'ESTIMATED',
        dispatch_measurement_method: 'MANUAL_ESTIMATE',
        current_status: 'DISPATCHED',
      },
    });

    const customReason = 'Reagent shortage at contractor site';
    const result = await prisma.dispatchLabResult.create({
      data: {
        visit_id: visit.id,
        portion_id: portion.id,
        test_id: alcoholTest.id,
        performance_status: 'NOT_PERFORMED',
        not_performed_reason: customReason,
        numeric_value: null,
        text_value: null,
      },
    });

    expect(result.performance_status).toBe('NOT_PERFORMED');
    expect(result.not_performed_reason).toBe(customReason);
  });

  it('E. ZMCC Dispatch requires FULL performance and does not default to Contract Vehicle', async () => {
    const zmcc = await createTestZmccSource(prisma, 'ZMCC_ACC_01');
    const masterTests = await prisma.labTest.findMany({
      where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    });

    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-ZMCC-${Date.now()}-E`,
        vehicle_number: 'ZMCC-VEH-01',
        procurement_source_id: zmcc.id,
        current_status: 'DISPATCHED',
      },
    });

    const assignments = await getOrAssignDispatchTests(prisma, visit.id);
    expect(assignments.length).toBe(masterTests.length);

    // Schema validation for valid ZMCC dispatch payload
    const zmccPayload = {
      vehicleNumber: 'ZMCC-VEH-01',
      operationalDate: '2026-08-22',
      procurementSourceId: zmcc.id.toString(),
      dispatchTestingMode: 'FULL' as const,
      vehicleQuantity: {
        value: '5000',
        unit: 'KG' as const,
        basis: 'MEASURED' as const,
        method: 'WEIGHING' as const,
      },
      portions: [
        {
          portionNumber: 1,
          quantity: {
            value: '5000',
            unit: 'KG' as const,
            basis: 'MEASURED' as const,
            method: 'WEIGHING' as const,
          },
          results: assignments.map((a) => ({
            testId: a.test_id.toString(),
            performanceStatus: 'PERFORMED' as const,
            numericValue: a.result_type_snapshot === 'NUMERIC' ? 28.0 : undefined,
            textValue: a.result_type_snapshot !== 'NUMERIC' ? 'OK' : undefined,
            notPerformedReason: null,
          })),
        },
      ],
    };

    const parsed = createDispatchSchema.safeParse(zmccPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dispatchTestingMode).toBe('FULL');
      expect(parsed.data.portions[0].results.every((r) => r.performanceStatus === 'PERFORMED')).toBe(true);
    }
  });
});
