const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const visits = await prisma.vehicleVisit.findMany({
    where: {
      OR: [
        { vehicle_number: { contains: 'LHR', mode: 'insensitive' } },
        { token_number: { contains: '9044', mode: 'insensitive' } },
        { vehicle_number: { contains: '3341', mode: 'insensitive' } },
        { current_status: 'READY_FOR_GROSS' }
      ]
    },
    include: {
      portions: true,
      gate_log: true,
      weight_ticket: true
    }
  });

  console.log('FOUND VISITS COUNT:', visits.length);
  visits.forEach(v => {
    console.log(`Visit ID=${v.id}, Vehicle=${v.vehicle_number}, Token=${v.token_number}, Status=${v.current_status}`);
    console.log('  Portions:', v.portions.map(p => ({
      portion_number: p.portion_number,
      declared_quantity_kg: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0,
      plant_decision: p.plant_decision
    })));
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
