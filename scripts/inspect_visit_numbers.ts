import { prisma } from '../src/backend/core/db';

async function inspectVisits() {
  const count = await prisma.vehicleVisit.count();
  console.log(`Total VehicleVisit rows in DB: ${count}`);

  const visits = await prisma.vehicleVisit.findMany({
    select: {
      id: true,
      visit_number: true,
      operational_date: true,
      created_at: true,
    },
    orderBy: { id: 'asc' },
    take: 20,
  });

  console.log('Sample VehicleVisit records:');
  visits.forEach((v) => {
    console.log({
      id: v.id.toString(),
      visit_number: v.visit_number,
      operational_date: v.operational_date ? v.operational_date.toISOString().split('T')[0] : null,
      created_at: v.created_at.toISOString(),
    });
  });
}

inspectVisits()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
