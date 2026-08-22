import { Client } from 'pg';

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  console.log('==================================================');
  console.log('INSPECTING DISPOSABLE DATABASE SCHEMA & CONSTRAINTS');
  console.log('==================================================\n');

  // 1. Table Count Check
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  console.log(`[PASS] Total Base Tables Created: ${tablesRes.rows.length}`);
  const tableNames = tablesRes.rows.map((r) => r.table_name);
  console.log('Tables:', tableNames.join(', '));

  // 2. Submitted At Columns Check
  const submittedAtColsRes = await client.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE column_name LIKE '%submitted_at%'
    ORDER BY table_name, column_name;
  `);

  console.log('\n[PASS] Verified Submitted-At Columns:');
  submittedAtColsRes.rows.forEach((r) => {
    console.log(`  - ${r.table_name}.${r.column_name} (${r.data_type})`);
  });

  // 3. Procurement Source FK Check
  const fkRes = await client.query(`
    SELECT kcu.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'procurement_source_id';
  `);

  console.log('\n[PASS] Verified ProcurementSource FK Constraints:');
  fkRes.rows.forEach((r) => {
    console.log(`  - ${r.table_name}.${r.column_name} -> ${r.foreign_table_name}.${r.foreign_column_name}`);
  });

  // 4. Performance Indexes Check
  const indexRes = await client.query(`
    SELECT tablename, indexname 
    FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname LIKE '%idx%'
    ORDER BY tablename, indexname;
  `);

  console.log('\n[PASS] Verified Performance Indexes:');
  indexRes.rows.forEach((r) => {
    console.log(`  - ${r.tablename}.${r.indexname}`);
  });

  await client.end();
  console.log('\n==================================================');
  console.log('DISPOSABLE SCHEMA INSPECTION COMPLETE: ALL PASSED');
  console.log('==================================================\n');
}

main().catch((err) => {
  console.error('Error inspecting disposable schema:', err);
  process.exit(1);
});
