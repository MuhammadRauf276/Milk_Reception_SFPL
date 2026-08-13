import { prisma } from '../src/backend/core/db';

async function auditBL() {
  console.log('--- AUDITING SECTION BL ITEMS ---');

  const allLabTests = await prisma.labTest.findMany({ where: { isActive: true } });
  const dispatchTests = allLabTests.filter((t) => t.testScope === 'DISPATCH' || t.testScope === 'BOTH');
  const plantTests = allLabTests.filter((t) => t.testScope === 'PLANT' || t.testScope === 'BOTH');
  const requiredDispatch = dispatchTests.filter((t) => t.isRequired);
  const requiredPlant = plantTests.filter((t) => t.isRequired);

  console.log(`Total Active LabTests: ${allLabTests.length}`);
  console.log(`Dispatch Scope Tests: ${dispatchTests.length} (Required: ${requiredDispatch.length})`);
  console.log(`Plant Scope Tests: ${plantTests.length} (Required: ${requiredPlant.length})`);

  const sampleVisit = await prisma.vehicleVisit.findFirst();
  console.log('Sample Visit Operational Date:', sampleVisit?.operational_date);

  const sampleTransaction = await prisma.siloInventoryTransaction.findFirst();
  console.log('Sample Silo Inventory Operational Timestamp:', sampleTransaction?.operational_timestamp);

  await prisma.$disconnect();
}

auditBL();
