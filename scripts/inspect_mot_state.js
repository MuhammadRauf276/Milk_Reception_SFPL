const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const routes = await prisma.zmccRoute.findMany({ select: { id: true, route_code: true, name: true, zmcc_id: true } });
  const areas = await prisma.zmccArea.findMany({ select: { id: true, area_code: true, name: true, route_id: true } });
  const shops = await prisma.zmccShop.findMany({ select: { id: true, shop_code: true, shop_name: true, area_id: true, route_id: true, is_active: true } });
  const profiles = await prisma.motProfile.findMany();
  const vehicles = await prisma.motVehicle.findMany();
  const chillers = await prisma.chillerOwnership.findMany({ select: { id: true, ownership_code: true, name: true } });
  const sources = await prisma.zmccMilkSource.findMany({ select: { id: true, erp_code: true, name: true } });
  const journeys = await prisma.motJourney.findMany({
    select: {
      id: true,
      journey_number: true,
      status: true,
      mot_profile_id: true,
      mot_vehicle_id: true,
      route_id: true,
      created_at: true,
      stops: {
        select: {
          id: true,
          shop_id: true,
          planned_sequence: true,
          status: true,
          shop_name_snapshot: true,
        }
      }
    }
  });
  const users = await prisma.user.findMany({
    where: { role: { in: ['MOT_OFFICER', 'ZMCC_MANAGER', 'PHE_OPERATOR'] } },
    select: { id: true, username: true, role: true, full_name: true }
  });

  console.log(JSON.stringify({
    routes,
    areas,
    shops,
    profiles,
    vehicles,
    chillers,
    sources,
    journeys,
    users
  }, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
