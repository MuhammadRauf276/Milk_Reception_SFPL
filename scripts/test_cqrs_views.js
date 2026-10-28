require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function runTests() {
  console.log('--- 1. Testing Live MOT Collection Feed ---');
  const motRows = await prisma.$queryRawUnsafe(
    'SELECT collection_number, route_code, shop_name, gross_liters, fat, lr, snf, at_13ts_liters FROM vw_mot_collection_feed LIMIT 3'
  );
  console.log('Sample MOT Collection rows:', motRows);

  console.log('\n--- 2. Testing Live HC Supplier Inward Feed ---');
  const hcRows = await prisma.$queryRawUnsafe(
    'SELECT zmcc_token, supplier_name, accepted_gross_liters, final_decision, rmr_receipt_number FROM vw_hc_supplier_inward_feed LIMIT 3'
  );
  console.log('Sample HC Supplier rows:', hcRows);

  console.log('\n--- 3. Testing Daily Procurement Rollup (Materialized View) ---');
  const rollupRows = await prisma.$queryRawUnsafe(
    'SELECT zmcc_name, operational_date, route_name, journey_count, total_shop_collections, total_gross_liters, avg_fat_percentage, avg_lr_reading, avg_snf_percentage, total_at_13ts_liters FROM mv_daily_procurement_rollup LIMIT 5'
  );
  console.log('Sample Daily Rollup rows:', rollupRows);

  console.log('\n--- 4. Testing Plant Transit Reconciliation (Materialized View) ---');
  const transitRows = await prisma.$queryRawUnsafe(
    'SELECT visit_number, vehicle_number, zmcc_name, dispatch_gross_liters, sent_gross_liters, received_gross_liters, gross_variance_liters FROM mv_plant_transit_reconciliation LIMIT 3'
  );
  console.log('Sample Plant Transit Reconciliation rows:', transitRows);

  console.log('\n--- 5. Testing Non-blocking CONCURRENT Refresh ---');
  const start = Date.now();
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_procurement_rollup;');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_plant_transit_reconciliation;');
  console.log(`Concurrent refresh completed in ${Date.now() - start}ms!`);
}

runTests()
  .then(() => console.log('\nALL CQRS VIEW TESTS PASSED SUCCESSFULLY!'))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
