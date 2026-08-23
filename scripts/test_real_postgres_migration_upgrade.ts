import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: testDbUrl ? { db: { url: testDbUrl } } : undefined,
});

async function runRealPostgresMigrationUpgradeTest() {
  console.log('==================================================');
  console.log('REAL POSTGRESQL MIGRATION UPGRADE TEST');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}]`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] ${detail || ''}`);
      failed++;
    }
  }

  const testSchemaName = `mig_test_${Date.now()}`;

  async function executeMultiStatementSql(rawSql: string) {
    const statements: string[] = [];
    let current = '';
    let inDollarBlock = false;

    for (let i = 0; i < rawSql.length; i++) {
      if (rawSql.slice(i, i + 2) === '$$') {
        inDollarBlock = !inDollarBlock;
        current += '$$';
        i++;
      } else if (rawSql[i] === ';' && !inDollarBlock) {
        if (current.trim()) statements.push(current.trim());
        current = '';
      } else {
        current += rawSql[i];
      }
    }
    if (current.trim()) statements.push(current.trim());

    for (const stmt of statements) {
      if (stmt.trim()) {
        await prisma.$executeRawUnsafe(stmt);
      }
    }
  }

  try {
    // 1. Create an isolated temporary test schema
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${testSchemaName}";`);

    // 2. Build legacy pre-migration schema inside testSchemaName
    await executeMultiStatementSql(`
      CREATE TABLE "${testSchemaName}"."vehicle_visit" (
        "id" BIGSERIAL PRIMARY KEY,
        "visit_number" VARCHAR(50) NOT NULL,
        "vehicle_number" VARCHAR(50) NOT NULL,
        "current_status" VARCHAR(50) DEFAULT 'DISPATCHED',
        "operational_date" DATE NOT NULL
      );

      CREATE TABLE "${testSchemaName}"."visit_portion" (
        "id" BIGSERIAL PRIMARY KEY,
        "visit_id" BIGINT NOT NULL,
        "portion_number" INT NOT NULL,
        "declared_quantity_value" DECIMAL(10,2),
        "declared_quantity_unit" VARCHAR(50),
        "current_status" VARCHAR(50) DEFAULT 'DISPATCHED',
        "plant_decision" VARCHAR(50) DEFAULT 'PENDING'
      );

      CREATE TABLE "${testSchemaName}"."dispatch_info" (
        "id" BIGSERIAL PRIMARY KEY,
        "portion_id" BIGINT NOT NULL,
        "dispatch_number" VARCHAR(50) NOT NULL,
        "dispatch_timestamp" TIMESTAMP NOT NULL
      );
    `);

    // 3. Insert genuine legacy fixtures into the isolated schema
    // Visit 1: Single portions A, B, C, D
    await executeMultiStatementSql(`
      INSERT INTO "${testSchemaName}"."vehicle_visit" ("id", "visit_number", "vehicle_number", "operational_date")
      VALUES (1001, 'VV-LEGACY-0001', 'LES-1001', '2026-08-20');

      -- Fixture A: 9500 KG
      INSERT INTO "${testSchemaName}"."visit_portion" ("id", "visit_id", "portion_number", "declared_quantity_value", "declared_quantity_unit")
      VALUES (2001, 1001, 1, 9500.00, 'KG');

      -- Fixture B: 10000 LITER
      INSERT INTO "${testSchemaName}"."visit_portion" ("id", "visit_id", "portion_number", "declared_quantity_value", "declared_quantity_unit")
      VALUES (2002, 1001, 2, 10000.00, 'LITER');

      -- Fixture C: NULL quantity / NULL unit
      INSERT INTO "${testSchemaName}"."visit_portion" ("id", "visit_id", "portion_number", "declared_quantity_value", "declared_quantity_unit")
      VALUES (2003, 1001, 3, NULL, NULL);

      -- Fixture D: Value 8500 with NULL unit
      INSERT INTO "${testSchemaName}"."visit_portion" ("id", "visit_id", "portion_number", "declared_quantity_value", "declared_quantity_unit")
      VALUES (2004, 1001, 4, 8500.00, NULL);

      -- Visit 2: Fixture E - Multiple portions with incompatible units (mixed KG + LITER)
      INSERT INTO "${testSchemaName}"."vehicle_visit" ("id", "visit_number", "vehicle_number", "operational_date")
      VALUES (1002, 'VV-LEGACY-0002', 'LES-1002', '2026-08-20');

      INSERT INTO "${testSchemaName}"."visit_portion" ("id", "visit_id", "portion_number", "declared_quantity_value", "declared_quantity_unit")
      VALUES (2005, 1002, 1, 9500.00, 'KG');

      INSERT INTO "${testSchemaName}"."visit_portion" ("id", "visit_id", "portion_number", "declared_quantity_value", "declared_quantity_unit")
      VALUES (2006, 1002, 2, 10000.00, 'LITER');

      INSERT INTO "${testSchemaName}"."dispatch_info" ("id", "portion_id", "dispatch_number", "dispatch_timestamp")
      VALUES (3001, 2005, 'DISP-VV-LEGACY-0002-P1', NOW());
      INSERT INTO "${testSchemaName}"."dispatch_info" ("id", "portion_id", "dispatch_number", "dispatch_timestamp")
      VALUES (3002, 2006, 'DISP-VV-LEGACY-0002-P2', NOW());
    `);

    // 4. Load the ACTUAL migration SQL files
    const mig1Path = path.join(
      process.cwd(),
      'prisma/migrations/20260822120000_dispatch_quantity_domain/migration.sql'
    );
    const mig2Path = path.join(
      process.cwd(),
      'prisma/migrations/20260822143000_vehicle_dispatch_quantity_authority/migration.sql'
    );

    const mig1SqlRaw = fs.readFileSync(mig1Path, 'utf8');
    const mig2SqlRaw = fs.readFileSync(mig2Path, 'utf8');

    // Adapt table references in migration SQL to target testSchemaName
    const adaptSql = (sql: string) => {
      return sql
        .replace(/"visit_portion"/g, `"${testSchemaName}"."visit_portion"`)
        .replace(/"dispatch_info"/g, `"${testSchemaName}"."dispatch_info"`)
        .replace(/"vehicle_visit"/g, `"${testSchemaName}"."vehicle_visit"`);
    };

    // 5. Execute Migration 1
    await executeMultiStatementSql(adaptSql(mig1SqlRaw));

    // 6. Execute Migration 2
    await executeMultiStatementSql(adaptSql(mig2SqlRaw));

    // 7. Query migrated rows directly from PostgreSQL and assert all requirements
    const portions: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        "id",
        "visit_id",
        "portion_number",
        "dispatch_quantity_value"::text as val,
        "dispatch_quantity_unit"::text as unit,
        "dispatch_quantity_basis"::text as basis,
        "dispatch_measurement_method"::text as method
      FROM "${testSchemaName}"."visit_portion"
      ORDER BY "id" ASC;
    `);

    const pA = portions.find((p) => p.id.toString() === '2001');
    const pB = portions.find((p) => p.id.toString() === '2002');
    const pC = portions.find((p) => p.id.toString() === '2003');
    const pD = portions.find((p) => p.id.toString() === '2004');
    const pE1 = portions.find((p) => p.id.toString() === '2005');
    const pE2 = portions.find((p) => p.id.toString() === '2006');

    // Assert Fixture A: 9500 KG preserved exactly
    assert(
      pA && pA.val === '9500.00' && pA.unit === 'KG' && pA.basis === null && pA.method === null,
      'MIG-PRESERVE-A: 9500 KG preserved as 9500.00 KG with null basis/method'
    );

    // Assert Fixture B: 10000 LITER preserved exactly
    assert(
      pB && pB.val === '10000.00' && pB.unit === 'LITER' && pB.basis === null && pB.method === null,
      'MIG-PRESERVE-B: 10000 LITER preserved as 10000.00 LITER with null basis/method'
    );

    // Assert Fixture C: NULL remains NULL
    assert(
      pC && pC.val === null && pC.unit === null && pC.basis === null && pC.method === null,
      'MIG-PRESERVE-C: NULL quantity/unit remains NULL'
    );

    // Assert Fixture D: Value 8500 with NULL unit preserved as 8500 with NULL unit (NOT forced to KG)
    assert(
      pD && pD.val === '8500.00' && pD.unit === null,
      'MIG-PRESERVE-D: Value with NULL unit preserved as 8500.00 with NULL unit (never forced to KG)'
    );

    // Assert Fixture E: Mixed portions preserved independently
    assert(
      pE1 && pE1.val === '9500.00' && pE1.unit === 'KG' &&
      pE2 && pE2.val === '10000.00' && pE2.unit === 'LITER',
      'MIG-PRESERVE-E: Multi-portion visit portions preserved independently'
    );

    // Check VehicleVisit rows
    const visits: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        "id",
        "vehicle_dispatch_quantity_value"::text as val,
        "vehicle_dispatch_quantity_unit"::text as unit
      FROM "${testSchemaName}"."vehicle_visit"
      ORDER BY "id" ASC;
    `);

    const v1 = visits.find((v) => v.id.toString() === '1001');
    const v2 = visits.find((v) => v.id.toString() === '1002');

    assert(
      v1 && v1.val === null && v1.unit === null,
      'MIG-VEHICLE-1: Historical vehicle quantity remains NULL when no vehicle-level quantity existed'
    );
    assert(
      v2 && v2.val === null && v2.unit === null,
      'MIG-VEHICLE-2: Multi-portion visit does NOT fabricate a vehicle total from mixed portions'
    );

    // Assert Column Schema: legacy declared_quantity_* columns are gone
    const portionCols: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = '${testSchemaName}' AND table_name = 'visit_portion';
    `);
    const colNames = portionCols.map((c) => c.column_name);

    assert(
      !colNames.includes('declared_quantity_value') && !colNames.includes('declared_quantity_unit'),
      'MIG-SCHEMA-1: Legacy declared_quantity_* columns successfully dropped from visit_portion'
    );
    assert(
      colNames.includes('dispatch_quantity_value') && colNames.includes('dispatch_quantity_unit'),
      'MIG-SCHEMA-2: Canonical dispatch_quantity_* columns exist on visit_portion'
    );

    // Assert Column Schema: dispatch_info has NO vehicle_quantity_* columns
    const dispatchInfoCols: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = '${testSchemaName}' AND table_name = 'dispatch_info';
    `);
    const dispColNames = dispatchInfoCols.map((c) => c.column_name);

    assert(
      !dispColNames.includes('vehicle_quantity_value') &&
      !dispColNames.includes('vehicle_quantity_unit') &&
      !dispColNames.includes('vehicle_quantity_basis') &&
      !dispColNames.includes('vehicle_measurement_method'),
      'MIG-SCHEMA-3: Temporary vehicle quantity columns successfully dropped from dispatch_info'
    );

    console.log(`\n========================================`);
    console.log(`REAL POSTGRESQL MIGRATION TEST: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running PostgreSQL migration upgrade test:', err);
    process.exit(1);
  } finally {
    // Clean up temporary schema
    try {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchemaName}" CASCADE;`);
    } catch {}
    await prisma.$disconnect();
  }
}

runRealPostgresMigrationUpgradeTest();
