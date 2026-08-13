const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const visit = await prisma.vehicleVisit.findFirst({
    where: { vehicle_number: 'LHR-3341', token_number: 'TK-9044' },
    include: { portions: true, gate_log: true, weight_ticket: true }
  });

  console.log('=== VISIT 44 DATABASE RECORD ===');
  console.log('ID:', visit.id.toString());
  console.log('current_status:', JSON.stringify(visit.current_status));
  console.log('gate_log:', visit.gate_log ? { entry_timestamp: visit.gate_log.entry_timestamp } : null);
  console.log('weight_ticket:', visit.weight_ticket);
  console.log('portions:', visit.portions.map(p => ({
    id: p.id.toString(),
    portion_number: p.portion_number,
    declared_quantity_kg: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : null,
    plant_decision: JSON.stringify(p.plant_decision)
  })));

  // Test exact Prisma query
  const queryResult = await prisma.vehicleVisit.findMany({
    where: {
      OR: [
        { current_status: 'READY_FOR_GROSS' },
        {
          gate_log: { entry_timestamp: { not: null } },
          weight_ticket: { is: null },
          portions: { some: { plant_decision: 'ACCEPTED' } },
          current_status: { in: ['PLANT_QA', 'READY_FOR_GROSS'] }
        }
      ],
      vehicle_number: 'LHR-3341',
      token_number: 'TK-9044'
    },
    include: { portions: true }
  });

  console.log('\n=== PRISMA QUERY MATCH RESULT ===');
  console.log('Matched count:', queryResult.length);
  if (queryResult.length > 0) {
    console.log('Matched visit status:', queryResult[0].current_status);
  }

  // Test case-insensitive vs case-sensitive Prisma query
  const csQuery = await prisma.vehicleVisit.findMany({
    where: { portions: { some: { plant_decision: 'ACCEPTED' } }, id: visit.id }
  });
  console.log('\nPrisma query with plant_decision="ACCEPTED" match count:', csQuery.length);

  const csQueryTitle = await prisma.vehicleVisit.findMany({
    where: { portions: { some: { plant_decision: 'Accepted' } }, id: visit.id }
  });
  console.log('Prisma query with plant_decision="Accepted" match count:', csQueryTitle.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
