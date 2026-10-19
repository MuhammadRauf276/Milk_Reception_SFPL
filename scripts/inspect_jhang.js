const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const jhang = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-JHANG' } });
  console.log('Jhang source:', jhang);

  if (!jhang) return;

  const tanks = await prisma.zmccTank.findMany({ where: { zmcc_id: jhang.id } });
  const routes = await prisma.zmccRoute.findMany({ where: { zmcc_id: jhang.id } });
  const areas = await prisma.zmccArea.findMany({ where: { zmcc_id: jhang.id } });
  const shops = await prisma.zmccShop.findMany({ where: { zmcc_id: jhang.id } });
  const users = await prisma.user.findMany({ where: { procurement_source_id: jhang.id } });

  console.log(JSON.stringify({
    tanks: tanks.map(t => ({ id: t.id.toString(), code: t.tank_code, name: t.tank_name })),
    routes: routes.map(r => ({ id: r.id.toString(), code: r.route_code, name: r.name })),
    areas: areas.map(a => ({ id: a.id.toString(), code: a.area_code, name: a.name })),
    shops: shops.map(s => ({ id: s.id.toString(), code: s.shop_code, name: s.shop_name })),
    users: users.map(u => ({ id: u.id.toString(), username: u.username, role: u.role, name: u.full_name }))
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
