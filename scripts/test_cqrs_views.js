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

  // The two materialized views were removed on 17 Nov 2026 (never read by the app; reports use live queries).
}

runTests()
  .then(() => console.log('\nALL CQRS VIEW TESTS PASSED SUCCESSFULLY!'))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
