const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  console.log('Setting up ZMCC Manager accounts for Hasilpur and Jhang in PostgreSQL...');

  const passwordHash = await bcrypt.hash('zone123', 10);

  // 1. Fetch procurement sources
  const hasilpur = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-HASILPUR' } });
  const jhang = await prisma.procurementSource.findUnique({ where: { code: 'ZMCC-JHANG' } });

  if (!hasilpur || !jhang) {
    throw new Error('Procurement sources ZMCC-HASILPUR or ZMCC-JHANG not found');
  }

  // 2. Upsert zmcc.manager.hasilpur
  await prisma.user.upsert({
    where: { username: 'zmcc.manager.hasilpur' },
    update: {
      full_name: 'ZMCC Manager - Hasilpur',
      role: 'ZMCC_MANAGER',
      department: 'Milk Procurement (Hasilpur)',
      scope_type: 'SOURCE',
      procurement_source_id: hasilpur.id,
      password_hash: passwordHash,
      is_active: true,
    },
    create: {
      username: 'zmcc.manager.hasilpur',
      email: 'zmcc.manager.hasilpur@shakarganj.com.pk',
      full_name: 'ZMCC Manager - Hasilpur',
      role: 'ZMCC_MANAGER',
      department: 'Milk Procurement (Hasilpur)',
      scope_type: 'SOURCE',
      procurement_source_id: hasilpur.id,
      password_hash: passwordHash,
      is_active: true,
    },
  });
  console.log('✅ Upserted user: zmcc.manager.hasilpur');

  // Keep zmcc.manager.north updated as Hasilpur manager for script compatibility
  await prisma.user.updateMany({
    where: { username: 'zmcc.manager.north' },
    data: {
      full_name: 'ZMCC Manager - Hasilpur',
      role: 'ZMCC_MANAGER',
      department: 'Milk Procurement (Hasilpur)',
      scope_type: 'SOURCE',
      procurement_source_id: hasilpur.id,
      password_hash: passwordHash,
      is_active: true,
    },
  });

  // 3. Upsert zmcc.manager.jhang
  const jhangManager = await prisma.user.upsert({
    where: { username: 'zmcc.manager.jhang' },
    update: {
      full_name: 'ZMCC Manager - Jhang',
      role: 'ZMCC_MANAGER',
      department: 'Milk Procurement (Jhang)',
      scope_type: 'SOURCE',
      procurement_source_id: jhang.id,
      password_hash: passwordHash,
      is_active: true,
    },
    create: {
      username: 'zmcc.manager.jhang',
      email: 'zmcc.manager.jhang@shakarganj.com.pk',
      full_name: 'ZMCC Manager - Jhang',
      role: 'ZMCC_MANAGER',
      department: 'Milk Procurement (Jhang)',
      scope_type: 'SOURCE',
      procurement_source_id: jhang.id,
      password_hash: passwordHash,
      is_active: true,
    },
  });
  console.log('✅ Upserted user: zmcc.manager.jhang');

  // 4. Ensure Jhang has a clean active tank
  const existingJhangTank = await prisma.zmccTank.findFirst({ where: { zmcc_id: jhang.id } });
  if (existingJhangTank) {
    await prisma.zmccTank.update({
      where: { id: existingJhangTank.id },
      data: {
        tank_code: 'TK-JHG-01',
        tank_name: 'Jhang Main Chilling Tank',
        capacity_liters: 15000.0,
        is_active: true,
      },
    });
  } else {
    await prisma.zmccTank.create({
      data: {
        zmcc_id: jhang.id,
        tank_code: 'TK-JHG-01',
        tank_name: 'Jhang Main Chilling Tank',
        capacity_liters: 15000.0,
        is_active: true,
        created_by: jhangManager.id,
      },
    });
  }
  console.log('✅ Ensured Jhang Chilling Tank TK-JHG-01 exists');

  // 5. Ensure Jhang Route & Area exist so Jhang dashboard has data
  let jhangRoute = await prisma.zmccRoute.findFirst({
    where: { zmcc_id: jhang.id, route_code: 'RT-JHG-001' },
  });
  if (!jhangRoute) {
    jhangRoute = await prisma.zmccRoute.create({
      data: {
        zmcc_id: jhang.id,
        route_code: 'RT-JHG-001',
        name: 'Jhang Sadar Rural Route',
        origin: 'Jhang Sadar Sub-Div',
        destination: 'ZMCC Jhang',
        is_active: true,
        created_by: jhangManager.id,
      },
    });
  }

  let jhangArea = await prisma.zmccArea.findFirst({
    where: { zmcc_id: jhang.id, area_code: 'AR-JHG-01' },
  });
  if (!jhangArea) {
    jhangArea = await prisma.zmccArea.create({
      data: {
        zmcc_id: jhang.id,
        route_id: jhangRoute.id,
        area_code: 'AR-JHG-01',
        name: 'Jhang Sadar Collection Area',
        created_by: jhangManager.id,
      },
    });
  }

  // Ensure Jhang Milk Source exists
  let jhangSource = await prisma.zmccMilkSource.findFirst({
    where: { zmcc_id: jhang.id, erp_code: 'MS-JHG-01' },
  });
  if (!jhangSource) {
    jhangSource = await prisma.zmccMilkSource.create({
      data: {
        zmcc_id: jhang.id,
        erp_code: 'MS-JHG-01',
        name: 'Jhang Direct Farmer Supply',
        is_active: true,
        created_by: jhangManager.id,
      },
    });
  }

  const chillerShakarganj = await prisma.chillerOwnership.findFirst({ where: { ownership_code: 'SHAKARGANJ' } });

  // Add 2 realistic shops for Jhang
  const jhangShops = [
    {
      code: 'SHP-000021',
      name: 'Hussain Dairy Center Jhang',
      owner: 'Malik Khadim Hussain',
      phone: '0300-3344556',
      cnic: '33202-3344556-1',
      lat: 31.2785,
      lon: 72.3312,
    },
    {
      code: 'SHP-000022',
      name: 'Chenab Milk Collection Point',
      owner: 'Rana Zulfiqar Ali',
      phone: '0302-7788990',
      cnic: '33202-7788990-2',
      lat: 31.2850,
      lon: 72.3420,
    },
  ];

  for (const s of jhangShops) {
    const existing = await prisma.zmccShop.findUnique({ where: { shop_code: s.code } });
    if (!existing) {
      await prisma.zmccShop.create({
        data: {
          shop_code: s.code,
          shop_name: s.name,
          owner_name: s.owner,
          phone_number: s.phone,
          cnic: s.cnic,
          area_id: jhangArea.id,
          route_id: jhangRoute.id,
          zmcc_id: jhang.id,
          milk_source_id: jhangSource.id,
          chiller_ownership_id: chillerShakarganj?.id || 1n,
          latitude: s.lat,
          longitude: s.lon,
          is_active: true,
          approval_status: 'ACTIVE',
          geotag_status: 'VERIFIED',
          created_by: jhangManager.id,
        },
      });
      console.log(`✅ Created Jhang shop: ${s.code} - ${s.name}`);
    }
  }

  console.log('✅ ZMCC Manager accounts and Jhang operational data created successfully!');
}

main()
  .catch((e) => {
    console.error('Error creating ZMCC managers:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
