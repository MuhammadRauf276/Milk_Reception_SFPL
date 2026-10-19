const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  console.log('Sanitizing operational and master data in PostgreSQL...');

  // 1. Update MOT User
  const motUser = await prisma.user.updateMany({
    where: { username: 'mot.driver' },
    data: { full_name: 'Muhammad Tariq' },
  });
  console.log(`Updated MOT User: ${motUser.count}`);

  // 2. Update MOT Profile
  const motProf = await prisma.motProfile.updateMany({
    where: { mot_code: 'DEMO-MOT-HAS-01' },
    data: {
      mot_code: 'MOT-HAS-001',
      name: 'Muhammad Tariq',
    },
  });
  console.log(`Updated MOT Profile: ${motProf.count}`);

  // 3. Update MOT Vehicle
  const motVeh = await prisma.motVehicle.updateMany({
    where: { vehicle_number: 'DEMO-BWP-5522' },
    data: { vehicle_number: 'BWP-5522' },
  });
  console.log(`Updated MOT Vehicle: ${motVeh.count}`);

  // 4. Update ZMCC Routes
  await prisma.zmccRoute.updateMany({
    where: { route_code: 'DEMO-R-HAS-01' },
    data: { route_code: 'RT-HAS-001', name: 'Hasilpur Rural Route 01' },
  });
  await prisma.zmccRoute.updateMany({
    where: { route_code: 'RT-ZMCC-HASILPUR-002' },
    data: { route_code: 'RT-HAS-002', name: 'Hasilpur Express Route' },
  });
  console.log('Updated Routes to RT-HAS-001 and RT-HAS-002');

  // 5. Update ZMCC Areas
  await prisma.zmccArea.updateMany({
    where: { area_code: 'DEMO-AREA-HAS-01' },
    data: { area_code: 'AR-HAS-01', name: 'Hasilpur East Rural Area' },
  });
  await prisma.zmccArea.updateMany({
    where: { area_code: 'AR-RT-ZMCC-HASILPUR-002-01' },
    data: { area_code: 'AR-HAS-02', name: 'Chak 124 North Area' },
  });
  console.log('Updated Areas to AR-HAS-01 and AR-HAS-02');

  // 6. Update ZMCC Milk Source
  await prisma.zmccMilkSource.updateMany({
    where: { erp_code: 'DEMO-MS-HAS-01' },
    data: { erp_code: 'MS-HAS-01', name: 'Direct Farm Collection Source' },
  });
  console.log('Updated Milk Source to MS-HAS-01');

  // 7. Update ZMCC Shops
  await prisma.zmccShop.updateMany({
    where: { shop_code: 'DEMO-SH-HAS-01' },
    data: { shop_code: 'SHP-000001', shop_name: 'Al-Madina Milk Center' },
  });
  console.log('Updated Shop DEMO-SH-HAS-01 to SHP-000001');

  // 8. Update Local Suppliers
  const suppliersMap = [
    { id: 13, name: 'Ali Hassan Milk Center', ref: 'LS-HAS-001' },
    { id: 38, name: 'Hassan Dairy Collection', ref: 'LS-HAS-002' },
    { id: 39, name: 'Haji Rauf Dairy Supplies', ref: 'LS-HAS-003' },
    { id: 40, name: 'Haji Ahmad Milk Suppliers', ref: 'LS-HAS-004' },
    { id: 41, name: 'Bashir Milk Collection Center', ref: 'LS-HAS-005' },
    { id: 42, name: 'Chaudhry Dairy & Cattle Farm', ref: 'LS-HAS-006' },
    { id: 43, name: 'Rehman Dairy Supplies', ref: 'LS-HAS-007' },
    { id: 44, name: 'Sharif & Sons Dairy Farm', ref: 'LS-HAS-008' },
    { id: 45, name: 'Chaudhry Rauf Dairy Farm', ref: 'LS-HAS-009' },
  ];

  for (const s of suppliersMap) {
    try {
      await prisma.zmccLocalSupplier.update({
        where: { id: BigInt(s.id) },
        data: {
          name: s.name,
          erp_reference: s.ref,
        },
      });
    } catch {
      // ignore if id not found
    }
  }
  console.log('Updated Local Suppliers to clean realistic names and codes');

  // 9. Update Snapshots in MotJourneyStop
  await prisma.motJourneyStop.updateMany({
    where: { shop_code_snapshot: 'DEMO-SH-HAS-01' },
    data: { shop_code_snapshot: 'SHP-000001' },
  });
  await prisma.motJourneyStop.updateMany({
    where: { shop_name_snapshot: 'DEMO - Al-Madina Milk Center' },
    data: { shop_name_snapshot: 'Al-Madina Milk Center' },
  });
  await prisma.motJourneyStop.updateMany({
    where: { area_code_snapshot: 'DEMO-AREA-HAS-01' },
    data: { area_code_snapshot: 'AR-HAS-01' },
  });
  console.log('Updated MotJourneyStop snapshots');

  // 10. Clean notes in Tank Receipts and MotCollectionRecord
  const tankReceipts = await prisma.zmccTankReceipt.findMany();
  for (const tr of tankReceipts) {
    if (tr.notes && tr.notes.includes('Demo ')) {
      await prisma.zmccTankReceipt.update({
        where: { id: tr.id },
        data: { notes: tr.notes.replace(/Demo\s*/g, '') },
      });
    }
  }

  const collections = await prisma.motShopCollection.findMany();
  for (const c of collections) {
    if (c.collection_notes && c.collection_notes.includes('Demo ')) {
      await prisma.motShopCollection.update({
        where: { id: c.id },
        data: { collection_notes: c.collection_notes.replace(/Demo\s*/g, '') },
      });
    }
  }

  console.log('Cleaned notes in Tank Receipts & Collection Records');
  console.log('All data successfully sanitized!');
}

main()
  .catch((e) => {
    console.error('Error during data sanitization:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
