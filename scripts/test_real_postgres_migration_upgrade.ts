import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: testDbUrl ? { db: { url: testDbUrl } } : undefined,
});

async function runRealPostgresMigrationUpgradeTest() {
  console.log('==================================================');
  console.log('REAL POSTGRESQL MIGRATION UPGRADE TEST (13/13)');
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
    await prisma.$executeRawUnsafe(`SET search_path TO "${testSchemaName}", public;`);

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
    const mig3Path = path.join(
      process.cwd(),
      'prisma/migrations/20260824120000_remove_dispatch_measurement_method/migration.sql'
    );

    const mig1SqlRaw = fs.readFileSync(mig1Path, 'utf8');
    const mig2SqlRaw = fs.readFileSync(mig2Path, 'utf8');
    const mig3SqlRaw = fs.readFileSync(mig3Path, 'utf8');

    // Adapt table and type references in migration SQL to target testSchemaName
    const adaptSql = (sql: string) => {
      return sql
        .replace(/"visit_portion"/g, `"${testSchemaName}"."visit_portion"`)
        .replace(/"dispatch_info"/g, `"${testSchemaName}"."dispatch_info"`)
        .replace(/"vehicle_visit"/g, `"${testSchemaName}"."vehicle_visit"`)
        .replace(/"QuantityUnit"/g, `"${testSchemaName}"."QuantityUnit"`)
        .replace(/"MeasurementBasis"/g, `"${testSchemaName}"."MeasurementBasis"`)
        .replace(/"MeasurementMethod"/g, `"${testSchemaName}"."MeasurementMethod"`);
    };

    // 5. Execute Migration 11
    await executeMultiStatementSql(adaptSql(mig1SqlRaw));

    // 6. Execute Migration 12
    await executeMultiStatementSql(adaptSql(mig2SqlRaw));

    // 7. PRE-MIGRATION 13 HISTORICAL STATE VERIFICATION
    const pre13Enum: any[] = await prisma.$queryRawUnsafe(`
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE t.typname = 'MeasurementMethod' AND n.nspname = '${testSchemaName}';
    `);
    assert(
      pre13Enum.length > 0,
      'PRE-MIG-13-1: MeasurementMethod enum exists in database after migration 12'
    );

    const pre13PortionCols: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${testSchemaName}' AND table_name = 'visit_portion';
    `);
    const pre13PColNames = pre13PortionCols.map((c) => c.column_name);
    assert(
      pre13PColNames.includes('dispatch_measurement_method'),
      'PRE-MIG-13-2: visit_portion.dispatch_measurement_method exists after migration 12'
    );
    assert(
      pre13PColNames.includes('dispatch_quantity_value') &&
      pre13PColNames.includes('dispatch_quantity_unit') &&
      pre13PColNames.includes('dispatch_quantity_basis'),
      'PRE-MIG-13-3: visit_portion canonical quantity columns (value/unit/basis) exist after migration 12'
    );

    const pre13VisitCols: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${testSchemaName}' AND table_name = 'vehicle_visit';
    `);
    const pre13VColNames = pre13VisitCols.map((c) => c.column_name);
    assert(
      pre13VColNames.includes('vehicle_dispatch_measurement_method'),
      'PRE-MIG-13-4: vehicle_visit.vehicle_dispatch_measurement_method exists after migration 12'
    );
    assert(
      pre13VColNames.includes('vehicle_dispatch_quantity_value') &&
      pre13VColNames.includes('vehicle_dispatch_quantity_unit') &&
      pre13VColNames.includes('vehicle_dispatch_quantity_basis'),
      'PRE-MIG-13-5: vehicle_visit canonical quantity columns (value/unit/basis) exist after migration 12'
    );

    // 8. Execute Migration 13 (remove_dispatch_measurement_method)
    await executeMultiStatementSql(adaptSql(mig3SqlRaw));

    // 9. Query migrated rows directly from PostgreSQL and assert all post-13 requirements
    const portions: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        "id",
        "visit_id",
        "portion_number",
        "dispatch_quantity_value"::text as val,
        "dispatch_quantity_unit"::text as unit,
        "dispatch_quantity_basis"::text as basis
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
      pA && pA.val === '9500.00' && pA.unit === 'KG' && pA.basis === null,
      'MIG-PRESERVE-A: 9500 KG preserved as 9500.00 KG with null basis after migration 13'
    );

    // Assert Fixture B: 10000 LITER preserved exactly
    assert(
      pB && pB.val === '10000.00' && pB.unit === 'LITER' && pB.basis === null,
      'MIG-PRESERVE-B: 10000 LITER preserved as 10000.00 LITER with null basis after migration 13'
    );

    // Assert Fixture C: NULL remains NULL
    assert(
      pC && pC.val === null && pC.unit === null && pC.basis === null,
      'MIG-PRESERVE-C: NULL quantity/unit remains NULL after migration 13'
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
        "vehicle_dispatch_quantity_unit"::text as unit,
        "vehicle_dispatch_quantity_basis"::text as basis
      FROM "${testSchemaName}"."vehicle_visit"
      ORDER BY "id" ASC;
    `);

    const v1 = visits.find((v) => v.id.toString() === '1001');
    const v2 = visits.find((v) => v.id.toString() === '1002');

    assert(
      v1 && v1.val === null && v1.unit === null && v1.basis === null,
      'MIG-VEHICLE-1: Historical vehicle quantity remains NULL when no vehicle-level quantity existed'
    );
    assert(
      v2 && v2.val === null && v2.unit === null && v2.basis === null,
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
      colNames.includes('dispatch_quantity_value') &&
      colNames.includes('dispatch_quantity_unit') &&
      colNames.includes('dispatch_quantity_basis'),
      'MIG-SCHEMA-2: Canonical dispatch_quantity_* columns (value/unit/basis) exist on visit_portion'
    );
    assert(
      !colNames.includes('dispatch_measurement_method'),
      'MIG-SCHEMA-2B: dispatch_measurement_method column successfully dropped from visit_portion'
    );

    const vehicleCols: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = '${testSchemaName}' AND table_name = 'vehicle_visit';
    `);
    const vehColNames = vehicleCols.map((c) => c.column_name);
    assert(
      vehColNames.includes('vehicle_dispatch_quantity_value') &&
      vehColNames.includes('vehicle_dispatch_quantity_unit') &&
      vehColNames.includes('vehicle_dispatch_quantity_basis'),
      'MIG-SCHEMA-2C: Canonical vehicle_dispatch_quantity_* columns (value/unit/basis) exist on vehicle_visit'
    );
    assert(
      !vehColNames.includes('vehicle_dispatch_measurement_method'),
      'MIG-SCHEMA-2D: vehicle_dispatch_measurement_method column successfully dropped from vehicle_visit'
    );

    // Check enum MeasurementMethod is dropped
    const post13Enum: any[] = await prisma.$queryRawUnsafe(`
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE t.typname = 'MeasurementMethod' AND n.nspname = '${testSchemaName}';
    `);
    assert(
      post13Enum.length === 0,
      'MIG-SCHEMA-2E: MeasurementMethod enum type successfully dropped from PostgreSQL'
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

    // Migration count check (31 tracked migrations)
    const migrationDirs = fs.readdirSync(path.join(process.cwd(), 'prisma/migrations'))
      .filter((f) => fs.statSync(path.join(process.cwd(), 'prisma/migrations', f)).isDirectory());
    assert(
      migrationDirs.length === 31,
      'MIG-COUNT-1: Repository contains exactly 31 tracked migrations',
      `Found ${migrationDirs.length} migrations`
    );
    assert(
      migrationDirs.includes('20260912120000_milk_test_policy_assignment'),
      'MIG-STAGE6GA: 20260912120000_milk_test_policy_assignment migration is present'
    );
    assert(
      migrationDirs.includes('20260912180000_mot_journey_summary'),
      'MIG-STAGE6GB: 20260912180000_mot_journey_summary migration is present'
    );
    assert(
      migrationDirs.includes('20260912210000_zmcc_final_milk_metrics'),
      'MIG-STAGE6GC: 20260912210000_zmcc_final_milk_metrics migration is present'
    );
    assert(
      migrationDirs.includes('20260913120000_zmcc_tank_receipt_and_ledger'),
      'MIG-STAGE6GD: 20260913120000_zmcc_tank_receipt_and_ledger migration is present'
    );
    assert(
      migrationDirs.includes('20260914100000_contractor_rmr_and_single_active_tank'),
      'MIG-STAGE6GD1: 20260914100000_contractor_rmr_and_single_active_tank migration is present'
    );
    assert(
      migrationDirs.includes('20260914160000_user_email_foundation'),
      'MIG-STAGE6GD2: 20260914160000_user_email_foundation migration is present'
    );
    assert(
      migrationDirs.includes('20260915100000_zmcc_local_supplier_directory_and_arrival'),
      'MIG-STAGE6GD3-25: 20260915100000_zmcc_local_supplier_directory_and_arrival migration is present'
    );
    assert(
      migrationDirs.includes('20260915120000_zmcc_gate_exit_and_canonical_local_supplier'),
      'MIG-STAGE6GD3-26: 20260915120000_zmcc_gate_exit_and_canonical_local_supplier migration is present'
    );
    assert(
      migrationDirs.includes('20260917080000_vehicle_dispatch_density_and_gross_liters'),
      'MIG-STAGE6GE-27: 20260917080000_vehicle_dispatch_density_and_gross_liters migration is present'
    );
    assert(
      migrationDirs.includes('20260917120000_vehicle_dispatch_dual_truth_and_tank_at13ts'),
      'MIG-STAGE6GE-28: 20260917120000_vehicle_dispatch_dual_truth_and_tank_at13ts migration is present'
    );
    assert(
      migrationDirs.includes('20260917130000_repair_zmcc_lab_correction_schema_drift'),
      'MIG-STAGE6GE-29: 20260917130000_repair_zmcc_lab_correction_schema_drift migration is present'
    );
    assert(
      migrationDirs.includes('20260918120000_stage_6g_f_plant_final_dual_reconciliation'),
      'MIG-STAGE6GF-30: 20260918120000_stage_6g_f_plant_final_dual_reconciliation migration is present'
    );
    assert(
      migrationDirs.includes('20260918140000_stage_6g_g_paper_references_and_corrections'),
      'MIG-STAGE6GG-31: 20260918140000_stage_6g_g_paper_references_and_corrections migration is present'
    );

    // =========================================================================
    // STAGE 6G-D.3: ACTUAL POSTGRESQL MIGRATION EXECUTION & UPGRADE REGRESSION
    // =========================================================================
    console.log('\n--- STAGE 6G-D.3 REAL POSTGRESQL MIGRATION UPGRADE TEST ---');
    const d3Schema = `mig_test_d3_${Date.now()}`;
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${d3Schema}";`);
    await prisma.$executeRawUnsafe(`SET search_path TO "${d3Schema}", public;`);

    try {
      // Build minimum compatible pre-D.3 schema
      await executeMultiStatementSql(`
        CREATE TABLE "${d3Schema}"."procurement_source" (
          "id" BIGSERIAL PRIMARY KEY,
          "code" VARCHAR(50) NOT NULL UNIQUE,
          "name" VARCHAR(150) NOT NULL,
          "source_type" VARCHAR(50) NOT NULL,
          "is_active" BOOLEAN NOT NULL DEFAULT true
        );

        CREATE TABLE "${d3Schema}"."users" (
          "id" BIGSERIAL PRIMARY KEY,
          "username" VARCHAR(100) NOT NULL UNIQUE,
          "email" VARCHAR(254),
          "role" VARCHAR(50) NOT NULL,
          "is_active" BOOLEAN NOT NULL DEFAULT true
        );

        CREATE TABLE "${d3Schema}"."zmcc_mot_arrival" (
          "id" BIGSERIAL PRIMARY KEY,
          "zmcc_id" BIGINT NOT NULL REFERENCES "${d3Schema}"."procurement_source"("id"),
          "route_milk_token" VARCHAR(100) NOT NULL,
          "zmcc_token" VARCHAR(100) NOT NULL UNIQUE
        );

        CREATE TABLE "${d3Schema}"."zmcc_contractor_arrival" (
          "id" BIGSERIAL PRIMARY KEY,
          "zmcc_id" BIGINT NOT NULL REFERENCES "${d3Schema}"."procurement_source"("id"),
          "contractor_source_id" BIGINT NOT NULL REFERENCES "${d3Schema}"."procurement_source"("id"),
          "rmr_number" VARCHAR(100) NOT NULL,
          "vehicle_number" VARCHAR(50) NOT NULL,
          "zmcc_token" VARCHAR(100) NOT NULL UNIQUE
        );

        CREATE TABLE "${d3Schema}"."zmcc_lab_session" (
          "id" BIGSERIAL PRIMARY KEY,
          "zmcc_id" BIGINT NOT NULL REFERENCES "${d3Schema}"."procurement_source"("id"),
          "arrival_type" VARCHAR(50) NOT NULL,
          "mot_arrival_id" BIGINT REFERENCES "${d3Schema}"."zmcc_mot_arrival"("id"),
          "contractor_arrival_id" BIGINT REFERENCES "${d3Schema}"."zmcc_contractor_arrival"("id"),
          "status" VARCHAR(50) NOT NULL DEFAULT 'IN_PROGRESS',
          "started_by_user_id" BIGINT NOT NULL REFERENCES "${d3Schema}"."users"("id"),
          "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "zmcc_lab_session_arrival_check" CHECK (
            ("mot_arrival_id" IS NOT NULL AND "contractor_arrival_id" IS NULL AND "arrival_type" = 'MOT') OR
            ("mot_arrival_id" IS NULL AND "contractor_arrival_id" IS NOT NULL AND "arrival_type" = 'CONTRACTOR')
          ),
          CONSTRAINT "zmcc_lab_session_arrival_type_check" CHECK ("arrival_type" IN ('MOT', 'CONTRACTOR'))
        );
      `);

      // Insert pre-D.3 fixtures
      await executeMultiStatementSql(`
        INSERT INTO "${d3Schema}"."procurement_source" ("id", "code", "name", "source_type", "is_active")
        VALUES (1, 'ZMCC-001', 'ZMCC Sahiwal', 'ZMCC', true), (2, 'CON-001', 'Contractor Alpha', 'CONTRACTOR', true);

        INSERT INTO "${d3Schema}"."users" ("id", "username", "email", "role", "is_active")
        VALUES (1, 'admin_user', 'admin@example.com', 'SUPER_ADMIN', true);

        INSERT INTO "${d3Schema}"."zmcc_mot_arrival" ("id", "zmcc_id", "route_milk_token", "zmcc_token")
        VALUES (101, 1, 'RMT-101', 'ZT-MOT-20260915-0001');

        INSERT INTO "${d3Schema}"."zmcc_contractor_arrival" ("id", "zmcc_id", "contractor_source_id", "rmr_number", "vehicle_number", "zmcc_token")
        VALUES (201, 1, 2, 'RMR-201', 'LHR 1234', 'ZT-CON-20260915-0001');

        INSERT INTO "${d3Schema}"."zmcc_lab_session" ("id", "zmcc_id", "arrival_type", "mot_arrival_id", "status", "started_by_user_id")
        VALUES (301, 1, 'MOT', 101, 'IN_PROGRESS', 1);

        INSERT INTO "${d3Schema}"."zmcc_lab_session" ("id", "zmcc_id", "arrival_type", "contractor_arrival_id", "status", "started_by_user_id")
        VALUES (302, 1, 'CONTRACTOR', 201, 'IN_PROGRESS', 1);
      `);

      // Read ACTUAL D.3 migration file
      const d3MigrationPath = path.join(process.cwd(), 'prisma/migrations/20260915100000_zmcc_local_supplier_directory_and_arrival/migration.sql');
      const d3MigrationSql = fs.readFileSync(d3MigrationPath, 'utf8');

      // Execute actual D.3 migration inside d3Schema
      await executeMultiStatementSql(d3MigrationSql);

      // Verify pre-D.3 fixtures survived unchanged
      const preD3Mot: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "${d3Schema}"."zmcc_lab_session" WHERE id = 301`);
      assert(
        preD3Mot.length === 1 && preD3Mot[0].arrival_type === 'MOT' && BigInt(preD3Mot[0].mot_arrival_id) === BigInt(101),
        'MIG-D3-PRESERVE-1: Pre-D.3 MOT lab session facts survived migration unchanged'
      );

      const preD3Con: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "${d3Schema}"."zmcc_lab_session" WHERE id = 302`);
      assert(
        preD3Con.length === 1 && preD3Con[0].arrival_type === 'CONTRACTOR' && BigInt(preD3Con[0].contractor_arrival_id) === BigInt(201),
        'MIG-D3-PRESERVE-2: Pre-D.3 Contractor lab session facts survived migration unchanged'
      );

      assert(
        preD3Mot[0].local_supplier_arrival_id === null && preD3Con[0].local_supplier_arrival_id === null,
        'MIG-D3-PRESERVE-3: Pre-D.3 lab sessions retain NULL local_supplier_arrival_id (no fabrication)'
      );

      // Verify D.3 structures exist
      const tablesRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name FROM information_schema.tables WHERE table_schema = '${d3Schema}'
      `);
      const tableNames = tablesRes.map((t) => t.table_name);
      assert(tableNames.includes('zmcc_local_supplier'), 'MIG-D3-TABLE-1: zmcc_local_supplier table created');
      assert(tableNames.includes('zmcc_local_supplier_arrival'), 'MIG-D3-TABLE-2: zmcc_local_supplier_arrival table created');

      const seqRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = '${d3Schema}' AND sequence_name = 'zmcc_local_supplier_code_seq'
      `);
      assert(seqRes.length === 1, 'MIG-D3-SEQ-1: zmcc_local_supplier_code_seq sequence exists');

      const labColsRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name FROM information_schema.columns WHERE table_schema = '${d3Schema}' AND table_name = 'zmcc_lab_session' AND column_name = 'local_supplier_arrival_id'
      `);
      assert(labColsRes.length === 1, 'MIG-D3-COL-1: local_supplier_arrival_id column exists on zmcc_lab_session');

      // Verify RMR constraint and leading zeros preserved
      await executeMultiStatementSql(`
        INSERT INTO "${d3Schema}"."zmcc_local_supplier" ("id", "local_supplier_code", "zmcc_id", "name", "erp_mapping_status", "is_active", "created_by_user_id", "updated_at")
        VALUES (501, 'ZLS-000001', 1, 'Supplier Zero', 'PENDING', true, 1, CURRENT_TIMESTAMP);

        INSERT INTO "${d3Schema}"."zmcc_local_supplier_arrival" (
          "id", "zmcc_id", "local_supplier_id", "rmr_number", "vehicle_number", "arrival_timestamp", "arrival_date",
          "zmcc_token", "client_event_id", "recorded_by_user_id", "updated_at"
        ) VALUES (
          601, 1, 501, '007890', 'LHR 1234', CURRENT_TIMESTAMP, CURRENT_DATE,
          'ZT-LS-20260915-0001', 'evt-d3-test-1', 1, CURRENT_TIMESTAMP
        );
      `);
      const rmrRecord: any[] = await prisma.$queryRawUnsafe(`
        SELECT rmr_number FROM "${d3Schema}"."zmcc_local_supplier_arrival" WHERE id = 601
      `);
      assert(
        rmrRecord[0]?.rmr_number === '007890',
        'MIG-D3-RMR-PRESERVE: Leading-zero RMR "007890" preserved exactly as text'
      );

      // Verify RMR digits check rejects non-numeric
      let rmrRejected = false;
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "${d3Schema}"."zmcc_local_supplier_arrival" (
            "id", "zmcc_id", "local_supplier_id", "rmr_number", "vehicle_number", "arrival_timestamp", "arrival_date",
            "zmcc_token", "client_event_id", "recorded_by_user_id", "updated_at"
          ) VALUES (
            602, 1, 501, 'RMR-XYZ', 'LHR 1234', CURRENT_TIMESTAMP, CURRENT_DATE,
            'ZT-LS-20260915-0002', 'evt-d3-test-2', 1, CURRENT_TIMESTAMP
          );
        `);
      } catch {
        rmrRejected = true;
      }
      assert(rmrRejected, 'MIG-D3-RMR-CHECK: zmcc_local_supplier_arrival_rmr_digits_check rejects non-numeric RMR');

      // Execute actual Migration 26 (Gate Exit & Canonical Local Supplier)
      const d3Migration26Path = path.join(process.cwd(), 'prisma/migrations/20260915120000_zmcc_gate_exit_and_canonical_local_supplier/migration.sql');
      const d3Migration26Sql = fs.readFileSync(d3Migration26Path, 'utf8');
      await executeMultiStatementSql(d3Migration26Sql);

      // Verify ERP mapping status check constraint rejects BROKEN
      let erpBrokenRejected = false;
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "${d3Schema}"."zmcc_local_supplier" ("id", "local_supplier_code", "zmcc_id", "name", "erp_mapping_status", "is_active", "created_by_user_id", "updated_at")
          VALUES (502, 'ZLS-000002', 1, 'Supplier Invalid ERP', 'BROKEN', true, 1, CURRENT_TIMESTAMP);
        `);
      } catch {
        erpBrokenRejected = true;
      }
      assert(erpBrokenRejected, 'MIG-D3-ERP-CHECK-1: zmcc_local_supplier_erp_mapping_status_check rejects "BROKEN"');

      // Verify PENDING and VERIFIED are allowed structurally by DB
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${d3Schema}"."zmcc_local_supplier" ("id", "local_supplier_code", "zmcc_id", "name", "erp_mapping_status", "is_active", "created_by_user_id", "updated_at")
        VALUES (503, 'ZLS-000003', 1, 'Supplier Verified ERP', 'VERIFIED', true, 1, CURRENT_TIMESTAMP);
      `);
      const verifiedSupplier: any[] = await prisma.$queryRawUnsafe(`
        SELECT erp_mapping_status FROM "${d3Schema}"."zmcc_local_supplier" WHERE id = 503
      `);
      assert(
        verifiedSupplier[0]?.erp_mapping_status === 'VERIFIED',
        'MIG-D3-ERP-CHECK-2: zmcc_local_supplier_erp_mapping_status_check permits "VERIFIED" structurally'
      );

      // Verify historical pre-migration rows cutover: gate_exit_required = false, exit_timestamp IS NULL
      const preFeatureMot: any[] = await prisma.$queryRawUnsafe(`
        SELECT gate_exit_required, exit_timestamp, exit_recorded_by_user_id, exit_client_event_id
        FROM "${d3Schema}"."zmcc_mot_arrival" WHERE id = 101
      `);
      assert(
        preFeatureMot.length === 1 &&
        preFeatureMot[0].gate_exit_required === false &&
        preFeatureMot[0].exit_timestamp === null &&
        preFeatureMot[0].exit_recorded_by_user_id === null &&
        preFeatureMot[0].exit_client_event_id === null,
        'MIG-D3-CUTOVER-MOT: Pre-feature MOT arrival has gate_exit_required = false and NULL exit fields'
      );

      const preFeatureLs: any[] = await prisma.$queryRawUnsafe(`
        SELECT gate_exit_required, exit_timestamp, exit_recorded_by_user_id, exit_client_event_id
        FROM "${d3Schema}"."zmcc_local_supplier_arrival" WHERE id = 601
      `);
      assert(
        preFeatureLs.length === 1 &&
        preFeatureLs[0].gate_exit_required === false &&
        preFeatureLs[0].exit_timestamp === null &&
        preFeatureLs[0].exit_recorded_by_user_id === null &&
        preFeatureLs[0].exit_client_event_id === null,
        'MIG-D3-CUTOVER-LS: Pre-feature Local Supplier arrival has gate_exit_required = false and NULL exit fields'
      );

      // Verify newly inserted rows default to gate_exit_required = true
      await executeMultiStatementSql(`
        INSERT INTO "${d3Schema}"."zmcc_mot_arrival" ("id", "zmcc_id", "route_milk_token", "zmcc_token")
        VALUES (102, 1, 'RMT-102', 'ZT-MOT-20260915-0002');

        INSERT INTO "${d3Schema}"."zmcc_local_supplier_arrival" (
          "id", "zmcc_id", "local_supplier_id", "rmr_number", "vehicle_number", "arrival_timestamp", "arrival_date",
          "zmcc_token", "client_event_id", "recorded_by_user_id", "updated_at"
        ) VALUES (
          603, 1, 501, '007891', 'LHR 9999', CURRENT_TIMESTAMP, CURRENT_DATE,
          'ZT-LS-20260915-0003', 'evt-d3-test-3', 1, CURRENT_TIMESTAMP
        );
      `);

      const postFeatureMot: any[] = await prisma.$queryRawUnsafe(`
        SELECT gate_exit_required, exit_timestamp FROM "${d3Schema}"."zmcc_mot_arrival" WHERE id = 102
      `);
      assert(
        postFeatureMot.length === 1 && postFeatureMot[0].gate_exit_required === true && postFeatureMot[0].exit_timestamp === null,
        'MIG-D3-DEFAULT-MOT: Post-migration MOT arrival defaults gate_exit_required = true'
      );

      const postFeatureLs: any[] = await prisma.$queryRawUnsafe(`
        SELECT gate_exit_required, exit_timestamp FROM "${d3Schema}"."zmcc_local_supplier_arrival" WHERE id = 603
      `);
      assert(
        postFeatureLs.length === 1 && postFeatureLs[0].gate_exit_required === true && postFeatureLs[0].exit_timestamp === null,
        'MIG-D3-DEFAULT-LS: Post-migration Local Supplier arrival defaults gate_exit_required = true'
      );

      // Verify exit columns exist on both tables
      const motExitCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = '${d3Schema}' AND table_name = 'zmcc_mot_arrival'
        AND column_name IN ('gate_exit_required', 'exit_timestamp', 'exit_recorded_by_user_id', 'exit_client_event_id', 'exit_submitted_at', 'exit_correction_count');
      `);
      assert(motExitCols.length === 6, 'MIG-D3-COLS-MOT: All 6 exit columns exist on zmcc_mot_arrival');

      const lsExitCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = '${d3Schema}' AND table_name = 'zmcc_local_supplier_arrival'
        AND column_name IN ('gate_exit_required', 'exit_timestamp', 'exit_recorded_by_user_id', 'exit_client_event_id', 'exit_submitted_at', 'exit_correction_count');
      `);
      assert(lsExitCols.length === 6, 'MIG-D3-COLS-LS: All 6 exit columns exist on zmcc_local_supplier_arrival');

      // Verify Lab check constraints allow LOCAL_SUPPLIER shape
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${d3Schema}"."zmcc_lab_session" ("id", "zmcc_id", "arrival_type", "local_supplier_arrival_id", "status", "started_by_user_id")
        VALUES (303, 1, 'LOCAL_SUPPLIER', 601, 'IN_PROGRESS', 1);
      `);
      const labLs: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "${d3Schema}"."zmcc_lab_session" WHERE id = 303
      `);
      assert(
        labLs.length === 1 && labLs[0].arrival_type === 'LOCAL_SUPPLIER' && BigInt(labLs[0].local_supplier_arrival_id) === BigInt(601),
        'MIG-D3-LAB-CHECK-1: zmcc_lab_session_arrival_check permits LOCAL_SUPPLIER arrival shape'
      );

      // Verify invalid lab arrival combination is rejected
      let invalidLabRejected = false;
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "${d3Schema}"."zmcc_lab_session" ("id", "zmcc_id", "arrival_type", "mot_arrival_id", "local_supplier_arrival_id", "status", "started_by_user_id")
          VALUES (304, 1, 'LOCAL_SUPPLIER', 101, 601, 'IN_PROGRESS', 1);
        `);
      } catch {
        invalidLabRejected = true;
      }
      assert(invalidLabRejected, 'MIG-D3-LAB-CHECK-2: zmcc_lab_session_arrival_check rejects conflicting arrival IDs');
    } finally {
      try {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${d3Schema}" CASCADE;`);
      } catch {}
    }

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
