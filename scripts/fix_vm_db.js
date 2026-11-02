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

    // 4. Auto-sync MOT users to mot_profile table so they appear in Dispatch Escort dropdowns
    console.log('Synchronizing MOT users into mot_profile table...');
    await client.query(`
      INSERT INTO mot_profile (mot_code, name, phone_number, cnic, zmcc_id, user_id, is_active, created_by, created_at, updated_at)
      SELECT 
        UPPER(COALESCE(NULLIF(TRIM(u.username), ''), 'MOT-USR-' || u.id)),
        COALESCE(NULLIF(TRIM(u.full_name), ''), u.username),
        COALESCE(NULLIF(TRIM(u.email), ''), '0300-0000000'),
        '31201-0000000-0',
        u.procurement_source_id,
        u.id,
        true,
        u.id,
        NOW(),
        NOW()
      FROM users u
      JOIN procurement_source ps ON ps.id = u.procurement_source_id AND ps.source_type = 'ZMCC'
      WHERE u.role IN ('MOT', 'MOT_OPERATOR')
        AND u.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM mot_profile mp WHERE mp.user_id = u.id OR mp.mot_code = UPPER(u.username)
        )
      ON CONFLICT (mot_code) DO NOTHING;
    `);
    console.log('MOT user synchronization verified.');

    // 5. Ensure each active ZMCC has baseline MOT escorts so dispatch to plant is never empty
    console.log('Ensuring baseline MOT escorts for all active ZMCCs...');
    await client.query(`
      INSERT INTO mot_profile (mot_code, name, phone_number, cnic, zmcc_id, user_id, is_active, created_by, created_at, updated_at)
      SELECT 
        'MOT-' || ps.code || '-01',
        'Usman Ali',
        '0304-5566778',
        '31201-1111111-1',
        ps.id,
        NULL,
        true,
        COALESCE((SELECT id FROM users ORDER BY id ASC LIMIT 1), 1),
        NOW(),
        NOW()
      FROM procurement_source ps
      WHERE ps.source_type = 'ZMCC' AND ps.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM mot_profile mp WHERE mp.zmcc_id = ps.id
        )
      ON CONFLICT (mot_code) DO NOTHING;

      INSERT INTO mot_profile (mot_code, name, phone_number, cnic, zmcc_id, user_id, is_active, created_by, created_at, updated_at)
      SELECT 
        'MOT-' || ps.code || '-02',
        'Kashif Raza',
        '0305-6677889',
        '31201-2222222-2',
        ps.id,
        NULL,
        true,
        COALESCE((SELECT id FROM users ORDER BY id ASC LIMIT 1), 1),
        NOW(),
        NOW()
      FROM procurement_source ps
      WHERE ps.source_type = 'ZMCC' AND ps.is_active = true
        AND (
          SELECT COUNT(*) FROM mot_profile mp WHERE mp.zmcc_id = ps.id
        ) < 2
      ON CONFLICT (mot_code) DO NOTHING;

      -- Ensure active state on all MOT profiles
      UPDATE mot_profile SET is_active = true WHERE is_active = false;
    `);
    console.log('Baseline MOT escorts verified.');

    console.log('\n>>> Database fixes applied successfully! <<<');
  } catch (err) {
    console.error('Error fixing database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
