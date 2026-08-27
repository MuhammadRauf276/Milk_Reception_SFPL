import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { clearTestDatabase, seedStandardTestLabCatalog, createTestZmccSource } from '../fixtures/testFixtures';
import { getOrAssignDispatchTests, getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

describe('Stable Lab Test Assignment & Snapshotting (Vitest Integration)', () => {
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

  it('atomically creates frozen Dispatch LabTestAssignment snapshot on initial fetch', async () => {
    const source = await createTestZmccSource(prisma, 'ZMCC_SNAP_01');

    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-TEST-SNAP-${Date.now()}-1`,
        vehicle_number: 'TEST-SNAP-VEH-01',
        procurement_source_id: source.id,
        current_status: 'DISPATCHED',
      },
    });

    // 1. First call creates snapshot
    const initialAssignments = await getOrAssignDispatchTests(prisma, visit.id);
    expect(initialAssignments.length).toBe(4); // 4 seeded active tests

    // 2. Add a new master test AFTER snapshot creation
    await prisma.labTest.create({
      data: {
        testCode: 'LT-000099',
        testName: 'New Master Test (Post-Dispatch)',
        testScope: 'BOTH',
        unit: 'PPM',
        resultType: 'NUMERIC',
        isRequired: true,
        displayOrder: 99,
        isActive: true,
      },
    });

    // 3. Re-fetching existing visit returns the EXACT SAME 4 snapshotted tests (isolated)
    const existingVisitAssignments = await getOrAssignDispatchTests(prisma, visit.id);
    expect(existingVisitAssignments.length).toBe(4);
    expect(existingVisitAssignments.some((a) => a.test_code_snapshot === 'LT-000099')).toBe(false);

    // 4. A brand new visit created NOW receives the updated 5-test catalog
    const newVisit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-TEST-SNAP-${Date.now()}-2`,
        vehicle_number: 'TEST-SNAP-VEH-02',
        procurement_source_id: source.id,
        current_status: 'DISPATCHED',
      },
    });

    const newVisitAssignments = await getOrAssignDispatchTests(prisma, newVisit.id);
    expect(newVisitAssignments.length).toBe(5);
    expect(newVisitAssignments.some((a) => a.test_code_snapshot === 'LT-000099')).toBe(true);
  });

  it('preserves snapshot test name and options when master test is renamed or modified', async () => {
    const source = await createTestZmccSource(prisma, 'ZMCC_SNAP_02');

    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-TEST-SNAP-${Date.now()}-3`,
        vehicle_number: 'TEST-SNAP-VEH-03',
        procurement_source_id: source.id,
        current_status: 'ARRIVED',
      },
    });

    // Create Plant QA snapshot
    const initialPlantAssignments = await getOrAssignPlantQATests(prisma, visit.id);
    const alcoholAssignment = initialPlantAssignments.find((a) => a.test_code_snapshot === 'LT-000010');
    expect(alcoholAssignment).toBeDefined();
    expect(alcoholAssignment?.test_name_snapshot).toBe('Alcohol Test (68%)');

    // Mutate master test name and options in master catalog
    await prisma.labTest.update({
      where: { testCode: 'LT-000010' },
      data: {
        testName: 'Renamed Alcohol Test (72%)',
        resultOptions: [
          { value: 'PASS', label: 'Pass', isPassing: true, displayOrder: 1 },
          { value: 'FAIL', label: 'Fail', isPassing: false, displayOrder: 2 },
        ],
      },
    });

    // In-flight visit snapshot preserves original test name and options
    const reloadedPlantAssignments = await getOrAssignPlantQATests(prisma, visit.id);
    const reloadedAlcohol = reloadedPlantAssignments.find((a) => a.test_code_snapshot === 'LT-000010');
    expect(reloadedAlcohol?.test_name_snapshot).toBe('Alcohol Test (68%)');

    const options = reloadedAlcohol?.result_options_snapshot as any[];
    expect(options[0].value).toBe('OK');
    expect(options[1].value).toBe('NOT_OK');
  });
});
