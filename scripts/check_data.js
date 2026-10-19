const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const shops = await prisma.zmccShop.findMany();
  console.log('Shops in DB:', shops.map(x => ({ id: x.id.toString(), code: x.shop_code, name: x.shop_name })));

  const routes = await prisma.zmccRoute.findMany();
  console.log('Routes in DB:', routes.map(x => ({ id: x.id.toString(), code: x.route_code, name: x.name })));

  const areas = await prisma.zmccArea.findMany();
  console.log('Areas in DB:', areas.map(x => ({ id: x.id.toString(), code: x.area_code, name: x.name })));

  const vehicles = await prisma.motVehicle.findMany();
  console.log('Vehicles in DB:', vehicles.map(x => ({ id: x.id.toString(), num: x.vehicle_number })));

  const suppliers = await prisma.zmccLocalSupplier.findMany();
  console.log('Suppliers in DB:', suppliers.map(x => ({ id: x.id.toString(), code: x.local_supplier_code, name: x.name })));

  const profiles = await prisma.motProfile.findMany();
  console.log('MOT Profiles in DB:', profiles.map(x => ({ id: x.id.toString(), code: x.mot_code, name: x.name })));

  const users = await prisma.user.findMany({ where: { username: { contains: 'mot' } } });
  console.log('MOT users in DB:', users.map(x => ({ id: x.id.toString(), username: x.username, name: x.full_name })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
