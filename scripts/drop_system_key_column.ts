import { prisma } from '../src/backend/core/db';

async function dropSystemKeyColumn() {
  console.log('==================================================');
  console.log('SAFE DATABASE MIGRATION: REMOVING system_key COLUMN');
  console.log('==================================================\n');

  // 1. Drop index on system_key if exists
  console.log('1. Dropping lab_test_system_key_key index if exists...');
  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS lab_test_system_key_key;
  `);

  // 2. Drop column system_key if exists
  console.log('2. Dropping system_key column from lab_test table if exists...');
  await prisma.$executeRawUnsafe(`
    ALTER TABLE lab_test DROP COLUMN IF EXISTS system_key;
  `);

  console.log('\n✅ Successfully dropped system_key column from PostgreSQL!');

  // Verify remaining columns and rows
  const count = await prisma.labTest.count();
  console.log(`Total LabTest rows in database: ${count}`);
}

dropSystemKeyColumn()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
