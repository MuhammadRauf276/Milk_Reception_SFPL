import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('==================================================');
  console.log('POSTGRESQL EXPLAIN (ANALYZE, BUFFERS) INDEX AUDIT');
  console.log('==================================================\n');

  const visitCount = await prisma.vehicleVisit.count();
  const portionCount = await prisma.visitPortion.count();
  const resultCount = await prisma.plantLabResult.count();
  const auditCount = await prisma.auditLog.count();
  const txCount = await prisma.siloInventoryTransaction.count();

  console.log(`Current DB Table Row Counts:`);
  console.log(`- VehicleVisit: ${visitCount} rows`);
  console.log(`- VisitPortion: ${portionCount} rows`);
  console.log(`- PlantLabResult: ${resultCount} rows`);
  console.log(`- AuditLog: ${auditCount} rows`);
  console.log(`- SiloInventoryTransaction: ${txCount} rows\n`);

  // Query 1: VehicleVisit status queue
  const q1 = await prisma.$queryRawUnsafe<any[]>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "vehicle_visit" WHERE "current_status" = 'READY_FOR_GROSS' ORDER BY "created_at" DESC;`
  );
  console.log('--- Query 1: VehicleVisit (current_status, created_at) ---');
  q1.forEach((r: any) => console.log(r['QUERY PLAN']));
  console.log('');

  // Query 2: VisitPortion visit lookup
  const q2 = await prisma.$queryRawUnsafe<any[]>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "visit_portion" WHERE "visit_id" = 1;`
  );
  console.log('--- Query 2: VisitPortion (visit_id) ---');
  q2.forEach((r: any) => console.log(r['QUERY PLAN']));
  console.log('');

  // Query 3: PlantLabResult portion lookup
  const q3 = await prisma.$queryRawUnsafe<any[]>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "plant_lab_result" WHERE "portion_id" = 1;`
  );
  console.log('--- Query 3: PlantLabResult (portion_id) ---');
  q3.forEach((r: any) => console.log(r['QUERY PLAN']));
  console.log('');

  // Query 4: AuditLog record lookup
  const q4 = await prisma.$queryRawUnsafe<any[]>(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "audit_log" WHERE "table_name" = 'vehicle_visit' AND "record_id" = 1;`
  );
  console.log('--- Query 4: AuditLog (table_name, record_id) ---');
  q4.forEach((r: any) => console.log(r['QUERY PLAN']));
  console.log('');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
