require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully.');

    // 1. Drop problematic constraints that block Prisma db push / drop index
    console.log('Dropping blocking constraints if they exist...');
    await client.query(`
      ALTER TABLE IF EXISTS "zmcc_lab_result" DROP CONSTRAINT IF EXISTS "zmcc_lab_result_portion_id_test_id_key";
      ALTER TABLE IF EXISTS "zmcc_milk_source" DROP CONSTRAINT IF EXISTS "zmcc_milk_source_id_zmcc_id_key";
    `);
    console.log('Constraints dropped or verified clean.');

    // 2. Add weighing fields to visit_portion
    console.log('Adding visit_portion weighing columns...');
    await client.query(`
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_kg" DECIMAL(12,3);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "first_weight_by_user_id" BIGINT;
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_kg" DECIMAL(12,3);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_at" TIMESTAMP(6);
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "second_weight_by_user_id" BIGINT;
      ALTER TABLE IF EXISTS "visit_portion" ADD COLUMN IF NOT EXISTS "net_weight_kg" DECIMAL(12,3);
    `);
    console.log('visit_portion weighing columns verified.');

    // 3. Add foreign keys safely
    console.log('Verifying foreign keys...');
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_first_weight_by_user_id_fkey') THEN
          ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_first_weight_by_user_id_fkey" 
            FOREIGN KEY ("first_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_portion_second_weight_by_user_id_fkey') THEN
          ALTER TABLE "visit_portion" ADD CONSTRAINT "visit_portion_second_weight_by_user_id_fkey" 
            FOREIGN KEY ("second_weight_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    console.log('Foreign keys verified.');

    console.log('\n>>> Database fixes applied successfully! <<<');
  } catch (err) {
    console.error('Error fixing database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
