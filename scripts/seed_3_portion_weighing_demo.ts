import { prisma } from '../src/backend/core/db';
import { Prisma } from '@prisma/client';

async function seed3PortionWeighingDemo() {
  const zmcc = await prisma.procurementSource.findUnique({
    where: { id: BigInt(1) },
  });

  if (!zmcc) {
    throw new Error('ZMCC ID 1 not found');
  }

  const zmccId = zmcc.id;
  console.log(`Using ZMCC: ${zmcc.name} (ID: ${zmccId.toString()})`);

  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  const adminId: bigint = admin ? admin.id : BigInt(1);

  // 1. Find existing supplier at this ZMCC
  let supplier = await prisma.zmccLocalSupplier.findFirst({
    where: { zmcc_id: zmccId, is_active: true },
  });

  if (!supplier) {
    supplier = await prisma.zmccLocalSupplier.create({
      data: {
        local_supplier_code: 'ZLS-000300',
        name: 'DEMO - Al-Madina Mega Dairy Farm (3 Compartments)',
        phone: '0300-9998877',
        cnic: '31202-9998877-1',
        is_active: true,
        zmcc: { connect: { id: zmccId } },
        creator: { connect: { id: adminId } },
      },
    });
  }

  // 2. Clean existing demo arrival if already present
  const existingArr = await prisma.zmccLocalSupplierArrival.findFirst({
    where: { zmcc_token: 'DEMO-SCN-TK-HAS-HC-3PORTION' },
    include: { lab_session: { include: { portions: true } } },
  });

  if (existingArr) {
    if (existingArr.lab_session) {
      await prisma.zmccLabPortion.deleteMany({ where: { lab_session_id: existingArr.lab_session.id } });
      await prisma.zmccLabSession.delete({ where: { id: existingArr.lab_session.id } });
    }
    await prisma.zmccLocalSupplierArrival.delete({ where: { id: existingArr.id } });
  }

  const now = new Date();
  const arrivalTime = new Date(now.getTime() - 45 * 60 * 1000); // 45 mins ago

  // 3. Create Arrival
  const arrival = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: zmccId,
      local_supplier_id: supplier.id,
      vehicle_number: 'DEMO-SCN-LEK-8833',
      zmcc_token: 'DEMO-SCN-TK-HAS-HC-3PORTION',
      rmr_number: '957339900',
      arrival_timestamp: arrivalTime,
      arrival_date: arrivalTime,
      gate_exit_required: true,
      client_event_id: `DEMO-SCN-evt-arr-hc-HAS-3P-${Date.now()}`,
      recorded_by_user_id: adminId,
    },
  });

  // 4. Create Lab Session (COMPLETED, ACCEPTED, 3 Portions)
  const session = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: zmccId,
      arrival_type: 'HC',
      local_supplier_arrival_id: arrival.id,
      status: 'COMPLETED',
      decision: 'ACCEPTED',
      final_decision: 'ACCEPTED',
      test_mode: 'PORTION_WISE',
      started_by_user_id: adminId,
      started_at: new Date(arrivalTime.getTime() + 5 * 60 * 1000),
      completed_by_user_id: adminId,
      completed_at: new Date(arrivalTime.getTime() + 30 * 60 * 1000),
      final_decided_by_user_id: adminId,
      final_decided_at: new Date(arrivalTime.getTime() + 30 * 60 * 1000),
      final_decision_reason: 'All 3 portions accepted by Zonal Lab Attendant.',
      system_quality_outcome: 'PASS',
      manager_review_status: 'NONE',
      density: new Prisma.Decimal('1.0285'),
      gross_liters: new Prisma.Decimal('9435.00'),
      snf: new Prisma.Decimal('8.78'),
      ts: new Prisma.Decimal('12.88'),
      at_13ts_liters: new Prisma.Decimal('9348.00'),
    },
  });

  // 5. Create 3 Accepted Portions
  const portionsData = [
    {
      num: 1,
      qty: '3500.00',
      lr: '28.50',
      fat: '4.10',
      snf: '8.78',
      ts: '12.88',
      density: '1.0285',
      grossLiters: '3403.00',
      at13: '3371.00',
    },
    {
      num: 2,
      qty: '3200.00',
      lr: '28.20',
      fat: '3.90',
      snf: '8.68',
      ts: '12.58',
      density: '1.0282',
      grossLiters: '3112.00',
      at13: '3012.00',
    },
    {
      num: 3,
      qty: '3000.00',
      lr: '28.80',
      fat: '4.30',
      snf: '8.87',
      ts: '13.17',
      density: '1.0288',
      grossLiters: '2916.00',
      at13: '2954.00',
    },
  ];

  for (const p of portionsData) {
    await prisma.zmccLabPortion.create({
      data: {
        lab_session_id: session.id,
        portion_number: p.num,
        status: 'ACCEPTED',
        system_outcome: 'PASS',
        person_decision: 'ACCEPT',
        final_decision: 'ACCEPTED',
        review_status: 'NONE',
        quantity_value: new Prisma.Decimal(p.qty),
        quantity_unit: 'KG',
        lr: new Prisma.Decimal(p.lr),
        fat: new Prisma.Decimal(p.fat),
        snf: new Prisma.Decimal(p.snf),
        ts: new Prisma.Decimal(p.ts),
        density: new Prisma.Decimal(p.density),
        gross_liters: new Prisma.Decimal(p.grossLiters),
        at_13ts_liters: new Prisma.Decimal(p.at13),
        calculation_version: '1.0',
        decided_at: new Date(arrivalTime.getTime() + 25 * 60 * 1000),
        created_by_user_id: adminId,
      },
    });
  }

  console.log('Successfully seeded 3-Portion Accepted Vehicle for Weighing Tab:');
  console.log(`- Token: ${arrival.zmcc_token}`);
  console.log(`- Vehicle: ${arrival.vehicle_number}`);
  console.log(`- Supplier: ${supplier.name}`);
  console.log(`- Session ID: ${session.id.toString()}`);
  console.log('- 3 Portions: #1 (3,500 KG), #2 (3,200 KG), #3 (3,000 KG) - Total 9,700 KG');
  console.log('- Ready to Weigh: Appears in Weighbridge Workspace / Weighing Tab');
}

seed3PortionWeighingDemo()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
