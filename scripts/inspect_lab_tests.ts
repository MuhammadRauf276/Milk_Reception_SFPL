import { prisma } from '../src/backend/core/db';

async function main() {
  const tests = await prisma.labTest.findMany();
  console.log('--- LAB TESTS IN DATABASE ---');
  tests.forEach((t) => {
    console.log(`ID: ${t.id}, Code: ${t.testCode}, Name: ${t.testName}, Scope: ${t.testScope}, Unit: ${t.unit}`);
  });
}

main().finally(() => prisma.$disconnect());
