import { prisma } from '../src/backend/core/db';

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, username: true, role: true, full_name: true } });
  const sources = await prisma.procurementSource.findMany({ select: { id: true, name: true, code: true } });
  const silos = await prisma.silo.findMany({ select: { id: true, silo_code: true, silo_name: true, capacity_liters: true } });
  const tests = await prisma.labTest.findMany({ where: { isActive: true } });

  console.log('=== USERS ===');
  console.log(users);

  console.log('=== PROCUREMENT SOURCES ===');
  console.log(sources);

  console.log('=== SILOS ===');
  console.log(silos);

  console.log('=== ACTIVE LAB TESTS ===');
  console.log(tests.map(t => ({ id: t.id, name: t.testName, scope: t.testScope, type: t.resultType })));
}

main().catch(console.error);
