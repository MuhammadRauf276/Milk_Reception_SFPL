import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('==================================================');
  console.log('LIVE POSTGRESQL INDEX INVENTORY (pg_indexes)');
  console.log('==================================================\n');

  const tables = [
    'vehicle_visit',
    'visit_portion',
    'dispatch_info',
    'gate_log',
    'dispatch_lab_result',
    'plant_lab_result',
    'weight_ticket',
    'unloading_log',
    'silo_inventory_transaction',
    'audit_log',
    'qa_warning',
  ];

  for (const t of tables) {
    const indexes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${t}' ORDER BY indexname;`
    );
    console.log(`Table: [${t}] (${indexes.length} indexes)`);
    indexes.forEach((idx: any) => {
      console.log(`  - ${idx.indexname.padEnd(45)} :: ${idx.indexdef}`);
    });
    console.log('');
  }

  console.log('==================================================');
  console.log('INDEX INVENTORY COMPLETE');
  console.log('==================================================');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
