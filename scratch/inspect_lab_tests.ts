import { prisma } from '../src/backend/core/db';

async function inspect() {
  const tests = await prisma.labTest.findMany({
    where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } },
    orderBy: [{ displayOrder: 'asc' }, { testName: 'asc' }],
  });

  console.log('Total DISPATCH/BOTH tests count:', tests.length);
  tests.forEach((t) => {
    console.log(`[ID: ${t.id}] ${t.testCode} | ${t.testName} | type: ${t.resultType} | required: ${t.isRequired} | unit: ${t.unit}`);
  });
}

inspect().then(() => process.exit(0));
