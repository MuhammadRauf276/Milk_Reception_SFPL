import { PrismaClient } from '@prisma/client';
import { assertSafeTestDatabase } from '../helpers/testDbSafety';

export async function clearTestDatabase(prisma: PrismaClient): Promise<void> {
  // Enforce strict test database safety guard BEFORE executing deletions
  assertSafeTestDatabase({ isDestructive: true });

  // Clear tables in reverse dependency order
  await prisma.dispatchLabResult.deleteMany();
  await prisma.plantLabResult.deleteMany();
  await prisma.labTestAssignment.deleteMany();
  await prisma.qATestingSessionEvent.deleteMany();
  await prisma.qATestingSession.deleteMany();
  await prisma.weightTicket.deleteMany();
  await prisma.gateLog.deleteMany();
  await prisma.unloadingLog.deleteMany();
  await prisma.siloInventoryTransaction.deleteMany();
  await prisma.visitPortion.deleteMany();
  await prisma.vehicleVisit.deleteMany();
  await prisma.qAWarning.deleteMany();
  await prisma.labTestRule.deleteMany();
  await prisma.labTest.deleteMany();
  await prisma.user.deleteMany();
  await prisma.silo.deleteMany();
  await prisma.procurementSource.deleteMany();
}

export async function seedStandardTestLabCatalog(prisma: PrismaClient): Promise<void> {
  // 1. Quantitative LR
  await prisma.labTest.create({
    data: {
      testCode: 'LT-000008',
      testName: 'Lactometer Reading (LR)',
      testScope: 'BOTH',
      unit: 'CLR',
      resultType: 'NUMERIC',
      isRequired: true,
      displayOrder: 1,
      isActive: true,
    },
  });

  // 2. Quantitative Fat %
  await prisma.labTest.create({
    data: {
      testCode: 'LT-000001',
      testName: 'Fat Percentage',
      testScope: 'BOTH',
      unit: '%',
      resultType: 'NUMERIC',
      isRequired: true,
      displayOrder: 2,
      isActive: true,
    },
  });

  // 3. Categorical OK_NOT_OK (e.g. Alcohol Test)
  await prisma.labTest.create({
    data: {
      testCode: 'LT-000010',
      testName: 'Alcohol Test (68%)',
      testScope: 'BOTH',
      unit: 'Quality',
      resultType: 'OK_NOT_OK',
      isRequired: true,
      displayOrder: 3,
      isActive: true,
      resultOptions: [
        { value: 'OK', label: 'OK', isPassing: true, displayOrder: 1 },
        { value: 'NOT_OK', label: 'Not OK', isPassing: false, displayOrder: 2 },
      ],
    },
  });

  // 4. Categorical POSITIVE_NEGATIVE (e.g. Antibiotic Test)
  await prisma.labTest.create({
    data: {
      testCode: 'LT-000020',
      testName: 'Antibiotic Residue Test',
      testScope: 'BOTH',
      unit: 'Presence',
      resultType: 'POSITIVE_NEGATIVE',
      isRequired: true,
      displayOrder: 4,
      isActive: true,
      resultOptions: [
        { value: 'NEGATIVE', label: 'Negative', isPassing: true, displayOrder: 1 },
        { value: 'POSITIVE', label: 'Positive', isPassing: false, displayOrder: 2 },
      ],
    },
  });
}

export async function createTestContractorSource(prisma: PrismaClient, code = 'TEST_CONT_01') {
  return await prisma.procurementSource.create({
    data: {
      code,
      name: `Test Contractor Source (${code})`,
      source_type: 'CONTRACTOR',
      is_active: true,
    },
  });
}

export async function createTestZmccSource(prisma: PrismaClient, code = 'TEST_ZMCC_01') {
  return await prisma.procurementSource.create({
    data: {
      code,
      name: `Test ZMCC Source (${code})`,
      source_type: 'ZMCC',
      is_active: true,
    },
  });
}
