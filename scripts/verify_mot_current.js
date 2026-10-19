const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const motUser = await prisma.user.findFirst({ where: { username: 'mot.driver' } });
  const motProfile = await prisma.motProfile.findUnique({
    where: { user_id: motUser.id },
  });

  console.log('MOT User:', { id: motUser.id.toString(), username: motUser.username, name: motUser.full_name });
  console.log('Linked MOT Profile:', { id: motProfile.id.toString(), code: motProfile.mot_code, name: motProfile.name });

  const activeJourney = await prisma.motJourney.findFirst({
    where: {
      mot_profile_id: motProfile.id,
      status: 'COLLECTING',
    },
    include: {
      zmcc: { select: { id: true, code: true, name: true } },
      route: { select: { id: true, route_code: true, name: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      stops: {
        include: {
          shop: { select: { id: true, shop_code: true, shop_name: true, owner_name: true, phone_number: true } },
          collection: {
            include: { sms_outbox: true },
          },
        },
        orderBy: { planned_sequence: 'asc' },
      },
      locations: {
        orderBy: { device_recorded_at: 'asc' },
      },
    },
  });

  if (!activeJourney) {
    console.error('ERROR: No active COLLECTING journey found!');
    return;
  }

  console.log('ACTIVE JOURNEY VERIFIED:');
  console.log(`  - Journey Number: ${activeJourney.journey_number}`);
  console.log(`  - Status: ${activeJourney.status}`);
  console.log(`  - Route: ${activeJourney.route.name} (${activeJourney.route.route_code})`);
  console.log(`  - Vehicle: ${activeJourney.mot_vehicle.vehicle_number}`);
  console.log(`  - Total Stops: ${activeJourney.stops.length}`);
  console.log(`  - GPS Locations Tracked: ${activeJourney.locations.length}`);
  console.log('  - Stops:');
  for (const s of activeJourney.stops) {
    console.log(`    [Seq ${s.planned_sequence}] ${s.shop_name_snapshot} (${s.shop_code_snapshot}) -> Status: ${s.status} ${s.collection ? `[Collected: ${s.collection.quantity_value} L]` : '[Ready for Collection]'}`);
  }

  // Also check total shops in DB
  const allShops = await prisma.zmccShop.findMany({ select: { shop_code: true, shop_name: true, approval_status: true } });
  console.log(`\nTotal Shops in DB: ${allShops.length}`);
  for (const sh of allShops) {
    console.log(`  - ${sh.shop_code}: ${sh.shop_name} [${sh.approval_status}]`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
