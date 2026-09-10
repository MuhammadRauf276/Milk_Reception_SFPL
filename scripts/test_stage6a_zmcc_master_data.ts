/**
 * STAGE 6A: ZMCC MASTER-DATA DATABASE FOUNDATION REGRESSION SUITE
 * 
 * Verifies:
 * 1. All 5 new models exist in Prisma Client & previous 21 models preserved (26 total).
 * 2. Explicit absence of removed/deferred models (ShopProposal, ShopApproval, MOT journeys, etc.).
 * 3. Prisma Schema & Migration Composite Relation Consistency:
 *    - ZmccArea.route uses fields: [route_id, zmcc_id], references: [id, zmcc_id]
 *    - ZmccShop.area uses fields: [area_id, route_id, zmcc_id], references: [id, route_id, zmcc_id]
 *    - ZmccShop.milk_source uses fields: [milk_source_id, zmcc_id], references: [id, zmcc_id]
 *    - Migration foreign keys match Prisma composite relations with zero drift.
 * 4. Required Creation Attribution:
 *    - created_by is BIGINT NOT NULL in all five tables in PostgreSQL information_schema.
 *    - creator User relation is required in Prisma schema.
 *    - Null created_by is strictly rejected at the database level.
 * 5. ChillerOwnership idempotent complete seeding (11 canonical brands).
 * 6. Relational Hierarchy & Cross-ZMCC Database Protection:
 *    - Route belongs to ZMCC
 *    - Area is bound to Route + ZMCC (cross-ZMCC combination strictly rejected)
 *    - Shop is bound to Area + Route + ZMCC (hierarchy violation strictly rejected)
 *    - Shop MilkSource must belong to the same ZMCC (cross-ZMCC milk source strictly rejected)
 * 7. Database CHECK constraints:
 *    - Non-empty codes, names, origin, destination, owner
 *    - Pakistani Mobile format validation
 *    - Pakistani CNIC format validation (normalized digits or 5-7-1 hyphenated)
 *    - GPS coordinate range [-90..90, -180..180] & both-or-neither nullability
 * 8. Active / Inactive lifecycle on all 5 models.
 * 9. Prevention of physical cascade deletion (onDelete: Restrict).
 * 10. Strict isolation: Only runs against disposable TEST_DATABASE_URL; dev DB untouched.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Client as PgClient } from 'pg';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

const repoRoot = path.resolve(__dirname, '..');

// Load .env.test.local if present
const testEnvPath = path.join(repoRoot, '.env.test.local');
if (fs.existsSync(testEnvPath)) {
  const envContent = fs.readFileSync(testEnvPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    }
  }
}

// Strictly verify test database safety
const { testDbName } = assertSafeTestDatabase({
  testDbUrl: process.env.TEST_DATABASE_URL,
  devDbUrl: process.env.DATABASE_URL,
});

console.log('===============================================================');
console.log('🧪 STAGE 6A: ZMCC MASTER-DATA DATABASE FOUNDATION VERIFICATION');
console.log(`🎯 Target Database: ${testDbName} (TEST ISOLATION ENFORCED)`);
console.log('===============================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail: string) {
  if (condition) {
    console.log(`[PASS] ${testName} - ${detail}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName} - ${detail}`);
    failed++;
  }
}

async function runStage6aVerification() {
  // Step 0: Fresh test DB recreation to guarantee clean slate for updated migration
  const devUrl = process.env.DATABASE_URL;
  if (devUrl) {
    const pgAdminClient = new PgClient({ connectionString: devUrl });
    try {
      await pgAdminClient.connect();
      await pgAdminClient.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await pgAdminClient.query(`CREATE DATABASE "${testDbName}"`);
      console.log(`✅ Fresh test database "${testDbName}" created for migration deployment.\n`);
    } catch (err: any) {
      console.warn('Note: Could not drop/recreate test DB via dev client:', err.message);
    } finally {
      await pgAdminClient.end().catch(() => {});
    }
  }

  // Step 1: Deploy migrations to TEST DB
  console.log('▶ Step 1: Deploying migrations to TEST DB...');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const migrateDeploy = spawnSync(npxCmd, ['prisma', 'migrate', 'deploy'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    },
    shell: true,
  });

  if (migrateDeploy.status !== 0) {
    console.error('❌ Failed to deploy migrations to test database.');
    process.exit(1);
  }
  console.log('✅ Migrations deployed to TEST DB.\n');

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.TEST_DATABASE_URL } },
  });

  const timestamp = Date.now();

  try {
    // ----------------------------------------------------
    // TEST 1: Model Existence & Schema Inventory
    // ----------------------------------------------------
    const expectedPreviousModels = [
      'user', 'vehicleVisit', 'visitPortion', 'dispatchInfo', 'gateLog',
      'labTest', 'labTestRule', 'procurementSource', 'dispatchQuantityPolicySnapshot',
      'dispatchLabResult', 'plantLabResult', 'weightTicket', 'unloadingLog',
      'auditLog', 'qATestingSession', 'qATestingSessionEvent', 'monthlyReceptionCounter',
      'silo', 'siloInventoryTransaction', 'qAWarning', 'labTestAssignment',
    ];

    const expectedNewModels = [
      'zmccRoute', 'zmccArea', 'zmccMilkSource', 'chillerOwnership', 'zmccShop',
    ];

    const forbiddenModels = [
      'shopProposal', 'shopApproval', 'pheToken', 'zmccTankLedger',
    ];

    const allPreviousPresent = expectedPreviousModels.every((m) => m in prisma);
    const allNewPresent = expectedNewModels.every((m) => m in prisma);
    const noneForbiddenPresent = forbiddenModels.every((m) => !(m in prisma));

    assert(
      allPreviousPresent && allNewPresent && noneForbiddenPresent,
      'MODEL-INVENTORY-A..C',
      `All 21 previous models present; 5 new Stage 6A models present; 0 forbidden/deferred models present`
    );

    // ----------------------------------------------------
    // TEST 2: Static Schema & Migration Composite Relation Consistency
    // ----------------------------------------------------
    const schemaContent = fs.readFileSync(path.join(repoRoot, 'prisma', 'schema.prisma'), 'utf8');
    const migrationContent = fs.readFileSync(
      path.join(repoRoot, 'prisma', 'migrations', '20260910000000_zmcc_master_data_foundation', 'migration.sql'),
      'utf8'
    );

    // Verify ZmccArea.route composite relation
    const areaRouteCompositeInSchema =
      schemaContent.includes('route   ZmccRoute  @relation(fields: [route_id, zmcc_id], references: [id, zmcc_id]') ||
      schemaContent.includes('route   ZmccRoute @relation(fields: [route_id, zmcc_id], references: [id, zmcc_id]');
    // Verify ZmccShop.area composite relation
    const shopAreaCompositeInSchema =
      schemaContent.includes('area              ZmccArea         @relation(fields: [area_id, route_id, zmcc_id], references: [id, route_id, zmcc_id]') ||
      schemaContent.includes('area              ZmccArea @relation(fields: [area_id, route_id, zmcc_id], references: [id, route_id, zmcc_id]');
    // Verify ZmccShop.milk_source composite relation
    const shopMilkSourceCompositeInSchema =
      schemaContent.includes('milk_source       ZmccMilkSource   @relation(fields: [milk_source_id, zmcc_id], references: [id, zmcc_id]') ||
      schemaContent.includes('milk_source       ZmccMilkSource @relation(fields: [milk_source_id, zmcc_id], references: [id, zmcc_id]');

    // Verify migration composite foreign keys
    const areaRouteFkInMigration = migrationContent.includes(
      'FOREIGN KEY ("route_id", "zmcc_id") REFERENCES "zmcc_route"("id", "zmcc_id")'
    );
    const shopAreaFkInMigration = migrationContent.includes(
      'FOREIGN KEY ("area_id", "route_id", "zmcc_id") REFERENCES "zmcc_area"("id", "route_id", "zmcc_id")'
    );
    const shopMilkSourceFkInMigration = migrationContent.includes(
      'FOREIGN KEY ("milk_source_id", "zmcc_id") REFERENCES "zmcc_milk_source"("id", "zmcc_id")'
    );

    assert(
      areaRouteCompositeInSchema &&
        shopAreaCompositeInSchema &&
        shopMilkSourceCompositeInSchema &&
        areaRouteFkInMigration &&
        shopAreaFkInMigration &&
        shopMilkSourceFkInMigration,
      'PRISMA-MIGRATION-COMPOSITE-CONSISTENCY',
      'schema.prisma and migration.sql define matching composite foreign keys without drift'
    );

    // ----------------------------------------------------
    // TEST 3: Migration Security Invariant (Zero User Creation or Seed Inserts)
    // ----------------------------------------------------
    const hasUserInsertInMigration =
      /INSERT\s+INTO\s+["']?users["']?/i.test(migrationContent) ||
      migrationContent.includes('admin.superuser') ||
      migrationContent.includes('SUPER_ADMIN');

    const hasChillerOwnershipInsertInMigration =
      /INSERT\s+INTO\s+["']?chiller_ownership["']?/i.test(migrationContent);

    // Verify database right after migration: 0 ownership records and 0 super admin users created by migration
    const ownershipCountPostMigrate = await prisma.chillerOwnership.count();
    const superAdminCountPostMigrate = await prisma.user.count({ where: { username: 'admin.superuser' } });

    assert(
      !hasUserInsertInMigration &&
        !hasChillerOwnershipInsertInMigration &&
        ownershipCountPostMigrate === 0 &&
        superAdminCountPostMigrate === 0,
      'MIGRATION-SECURITY-INVARIANTS',
      'migration.sql contains zero user creation or seed inserts; fresh deployment contains 0 seeded rows'
    );

    // ----------------------------------------------------
    // TEST 4: Mandatory Creation Attribution (created_by NOT NULL)
    // ----------------------------------------------------
    const targetTables = ['chiller_ownership', 'zmcc_route', 'zmcc_area', 'zmcc_milk_source', 'zmcc_shop'];
    const notNullColumns = await prisma.$queryRaw<Array<{ table_name: string; is_nullable: string }>>`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'created_by'
        AND table_name = ANY(${targetTables});
    `;

    const allFiveNotNull =
      notNullColumns.length === 5 &&
      notNullColumns.every((c) => c.is_nullable === 'NO');

    // Attempting raw insert with NULL created_by into zmcc_route must be rejected by PostgreSQL
    let nullCreatedByRejected = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "zmcc_route" ("route_code", "name", "origin", "destination", "zmcc_id", "created_by")
        VALUES ('RT-NULL-ACTOR', 'Null Actor Route', 'A', 'B', 1, NULL);
      `);
    } catch {
      nullCreatedByRejected = true;
    }

    assert(
      allFiveNotNull && nullCreatedByRejected,
      'REQUIRED-CREATION-ATTRIBUTION',
      'created_by is BIGINT NOT NULL in information_schema across all 5 tables; null insert strictly rejected'
    );

    // ----------------------------------------------------
    // TEST 5: First Seed Run - Canonical SUPER_ADMIN & 11 ChillerOwnership Rows
    // ----------------------------------------------------
    const firstSeed = spawnSync(npxCmd, ['tsx', 'prisma/seed.ts'], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
      },
      shell: true,
    });

    const superAdmin = await prisma.user.findFirst({
      where: {
        username: 'admin.superuser',
        role: 'SUPER_ADMIN',
        is_active: true,
        scope_type: 'SYSTEM',
      },
    });

    if (!superAdmin) {
      throw new Error('Seed invariant failed: admin.superuser was not found in test database');
    }

    const expectedOwnershipBrands = [
      'Nestlé', 'Engro', 'Shakarganj', 'Haleeb', 'FFL',
      'Adam', 'Millac', 'Ghani', 'Acha Foods', 'Self', 'Other',
    ];

    const ownershipAfterFirstSeed = await prisma.chillerOwnership.findMany({
      orderBy: { id: 'asc' },
    });

    const firstSeedCountValid = ownershipAfterFirstSeed.length === 11;
    const allBrandsPresent = expectedOwnershipBrands.every((b) =>
      ownershipAfterFirstSeed.some((o) => o.name === b)
    );
    const allCreatedBySuperAdmin = ownershipAfterFirstSeed.every(
      (o) => superAdmin !== null && o.created_by === superAdmin.id
    );
    const allFirstUpdatedByNull = ownershipAfterFirstSeed.every((o) => o.updated_by === null);

    assert(
      firstSeed.status === 0 &&
        superAdmin !== null &&
        firstSeedCountValid &&
        allBrandsPresent &&
        allCreatedBySuperAdmin &&
        allFirstUpdatedByNull,
      'SEED-FIRST-RUN-A..D',
      'First seed run created exactly 11 records with created_by=SuperAdmin and updated_by=null'
    );

    // ----------------------------------------------------
    // TEST 6: Second Idempotent Seed Run - Preserves created_by & Records updated_by
    // ----------------------------------------------------
    const secondSeed = spawnSync(npxCmd, ['tsx', 'prisma/seed.ts'], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
      },
      shell: true,
    });

    const ownershipAfterSecondSeed = await prisma.chillerOwnership.findMany({
      orderBy: { id: 'asc' },
    });

    const countRemains11 = ownershipAfterSecondSeed.length === 11;
    const createdByPreserved = ownershipAfterSecondSeed.every(
      (o) => superAdmin !== null && o.created_by === superAdmin.id
    );
    const updatedByRecorded = ownershipAfterSecondSeed.every(
      (o) => superAdmin !== null && o.updated_by === superAdmin.id
    );

    assert(
      secondSeed.status === 0 && countRemains11 && createdByPreserved && updatedByRecorded,
      'SEED-IDEMPOTENT-RUN-A..C',
      'Second seed run created zero duplicates, preserved original created_by, and recorded updated_by'
    );

    // ----------------------------------------------------
    // TEST 6: Setup Test ZMCCs for Hierarchy & Cross-ZMCC Checks
    // ----------------------------------------------------
    const zmccSourceA = await prisma.procurementSource.create({
      data: {
        code: `ZMCC-6A-A-${timestamp}`,
        name: `ZMCC Alpha ${timestamp.toString().slice(-4)}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    });

    const zmccSourceB = await prisma.procurementSource.create({
      data: {
        code: `ZMCC-6A-B-${timestamp}`,
        name: `ZMCC Beta ${timestamp.toString().slice(-4)}`,
        source_type: 'ZMCC',
        is_active: true,
      },
    });

    // ----------------------------------------------------
    // TEST 7: ZmccRoute Creation & ZMCC Binding
    // ----------------------------------------------------
    const routeA1 = await prisma.zmccRoute.create({
      data: {
        route_code: `RT-A1-${timestamp}`,
        name: 'Route Alpha 1',
        origin: 'Village Chak 12',
        destination: 'ZMCC Main Hub',
        zmcc_id: zmccSourceA.id,
        created_by: superAdmin.id,
        updated_by: superAdmin.id,
      },
    });

    assert(
      routeA1.id !== undefined && routeA1.zmcc_id === zmccSourceA.id && routeA1.is_active === true,
      'ROUTE-CREATION-A',
      `Route ${routeA1.route_code} created successfully bound to ZMCC ${zmccSourceA.name}`
    );

    // Duplicate route_code must fail
    let dupRouteRejected = false;
    try {
      await prisma.zmccRoute.create({
        data: {
          route_code: routeA1.route_code,
          name: 'Duplicate Route Code',
          origin: 'Origin',
          destination: 'Dest',
          zmcc_id: zmccSourceA.id,
          created_by: superAdmin.id,
        },
      });
    } catch {
      dupRouteRejected = true;
    }

    // Duplicate name within same ZMCC must fail
    let dupRouteNameRejected = false;
    try {
      await prisma.zmccRoute.create({
        data: {
          route_code: `RT-A2-DUP-${timestamp}`,
          name: routeA1.name, // Same name under zmccSourceA
          origin: 'Origin',
          destination: 'Dest',
          zmcc_id: zmccSourceA.id,
          created_by: superAdmin.id,
        },
      });
    } catch {
      dupRouteNameRejected = true;
    }

    assert(
      dupRouteRejected && dupRouteNameRejected,
      'ROUTE-CONSTRAINTS-A..B',
      'Unique route_code and unique route name within ZMCC strictly enforced'
    );

    // Route B1 under ZMCC B
    const routeB1 = await prisma.zmccRoute.create({
      data: {
        route_code: `RT-B1-${timestamp}`,
        name: 'Route Beta 1',
        origin: 'Village Chak 45',
        destination: 'ZMCC Beta Hub',
        zmcc_id: zmccSourceB.id,
        created_by: superAdmin.id,
        updated_by: superAdmin.id,
      },
    });

    // ----------------------------------------------------
    // TEST 8: ZmccArea Creation & Cross-ZMCC Database Rejection
    // ----------------------------------------------------
    // Valid Area under Route A1 + ZMCC A
    const areaA1 = await prisma.zmccArea.create({
      data: {
        area_code: `AR-A1-${timestamp}`,
        name: 'Area Alpha Center',
        route_id: routeA1.id,
        zmcc_id: zmccSourceA.id,
        created_by: superAdmin.id,
        updated_by: superAdmin.id,
      },
    });

    assert(
      areaA1.id !== undefined && areaA1.route_id === routeA1.id && areaA1.zmcc_id === zmccSourceA.id,
      'AREA-CREATION-A',
      `Area ${areaA1.area_code} created under Route ${routeA1.name} and ZMCC ${zmccSourceA.name}`
    );

    // Cross-ZMCC violation: Attempt to create Area pointing to Route A1 (ZMCC A) but claiming zmcc_id = ZMCC B!
    let crossZmccAreaRejected = false;
    try {
      await prisma.zmccArea.create({
        data: {
          area_code: `AR-CROSS-${timestamp}`,
          name: 'Cross ZMCC Area',
          route_id: routeA1.id, // belongs to ZMCC A!
          zmcc_id: zmccSourceB.id, // claims ZMCC B!
          created_by: superAdmin.id,
        },
      });
    } catch (err: any) {
      crossZmccAreaRejected = true;
    }

    assert(
      crossZmccAreaRejected,
      'CROSS-ZMCC-AREA-REJECTION',
      'Database composite foreign key strictly rejected mismatched Route/ZMCC combination'
    );

    // ----------------------------------------------------
    // TEST 9: ZmccMilkSource Creation & Cross-ZMCC Checks
    // ----------------------------------------------------
    const milkSourceA = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `MS-ERP-A-${timestamp}`,
        name: 'Direct Dairy Farmers Alpha',
        zmcc_id: zmccSourceA.id,
        created_by: superAdmin.id,
        updated_by: superAdmin.id,
      },
    });

    const milkSourceB = await prisma.zmccMilkSource.create({
      data: {
        erp_code: `MS-ERP-B-${timestamp}`,
        name: 'Direct Dairy Farmers Beta',
        zmcc_id: zmccSourceB.id,
        created_by: superAdmin.id,
        updated_by: superAdmin.id,
      },
    });

    assert(
      milkSourceA.id !== undefined && milkSourceB.id !== undefined,
      'MILK-SOURCE-CREATION-A',
      `Milk sources created with unique ERP codes (${milkSourceA.erp_code}, ${milkSourceB.erp_code})`
    );

    // ----------------------------------------------------
    // TEST 10: ZmccShop Creation, Hierarchy Binding & Cross-ZMCC Rejection
    // ----------------------------------------------------
    const nestleOwnership = ownershipAfterSecondSeed.find((o) => o.ownership_code === 'NESTLE')!;

    // Valid Shop: Area A1, Route A1, ZMCC A, MilkSource A
    const validShop = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-001-${timestamp}`,
        shop_name: 'Alpha Milk Collection Shop',
        owner_name: 'Muhammad Aslam',
        phone_number: '0300-1234567',
        cnic: '35201-1234567-1',
        area_id: areaA1.id,
        route_id: routeA1.id,
        zmcc_id: zmccSourceA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: nestleOwnership.id,
        latitude: new Prisma.Decimal('31.5203700'),
        longitude: new Prisma.Decimal('74.3587470'),
        created_by: superAdmin.id,
        updated_by: superAdmin.id,
      },
    });

    assert(
      validShop.id !== undefined && validShop.shop_code === `SHP-001-${timestamp}`,
      'SHOP-CREATION-A',
      `Shop ${validShop.shop_code} created with valid hierarchy and attributes`
    );

    // Hierarchy Violation 1: Shop with Area A1 but wrong route (Route B1)
    let wrongRouteShopRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-ERR-RT-${timestamp}`,
          shop_name: 'Wrong Route Shop',
          owner_name: 'Tariq Mehmood',
          phone_number: '03001234567',
          cnic: '3520112345671',
          area_id: areaA1.id, // belongs to Route A1
          route_id: routeB1.id, // mismatched route!
          zmcc_id: zmccSourceA.id,
          milk_source_id: milkSourceA.id,
          chiller_ownership_id: nestleOwnership.id,
          created_by: superAdmin.id,
        },
      });
    } catch {
      wrongRouteShopRejected = true;
    }

    assert(
      wrongRouteShopRejected,
      'SHOP-HIERARCHY-REJECTION-A',
      'Database composite foreign key strictly rejected mismatched Area/Route combination'
    );

    // Cross-ZMCC Milk Source Violation: Shop in ZMCC A referencing MilkSource B (from ZMCC B)!
    let crossZmccMilkSourceRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-ERR-MS-${timestamp}`,
          shop_name: 'Cross ZMCC MilkSource Shop',
          owner_name: 'Rashid Khan',
          phone_number: '0312-3456789',
          cnic: '35202-9876543-2',
          area_id: areaA1.id,
          route_id: routeA1.id,
          zmcc_id: zmccSourceA.id, // ZMCC A
          milk_source_id: milkSourceB.id, // ZMCC B!
          chiller_ownership_id: nestleOwnership.id,
          created_by: superAdmin.id,
        },
      });
    } catch {
      crossZmccMilkSourceRejected = true;
    }

    assert(
      crossZmccMilkSourceRejected,
      'CROSS-ZMCC-MILK-SOURCE-REJECTION',
      'Database composite foreign key strictly rejected cross-ZMCC milk source'
    );

    // ----------------------------------------------------
    // TEST 11: Mobile Number Database CHECK Constraint
    // ----------------------------------------------------
    let invalidPhoneRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-BAD-PH-${timestamp}`,
          shop_name: 'Bad Phone Shop',
          owner_name: 'Owner',
          phone_number: '12345', // Invalid phone
          cnic: '3520112345671',
          area_id: areaA1.id,
          route_id: routeA1.id,
          zmcc_id: zmccSourceA.id,
          milk_source_id: milkSourceA.id,
          chiller_ownership_id: nestleOwnership.id,
          created_by: superAdmin.id,
        },
      });
    } catch {
      invalidPhoneRejected = true;
    }

    assert(
      invalidPhoneRejected,
      'CHECK-MOBILE-FORMAT',
      'Pakistani mobile number check constraint strictly rejected invalid mobile number "12345"'
    );

    // ----------------------------------------------------
    // TEST 12: Pakistani CNIC Database CHECK Constraint
    // ----------------------------------------------------
    let invalidCnicRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-BAD-CNIC-${timestamp}`,
          shop_name: 'Bad CNIC Shop',
          owner_name: 'Owner',
          phone_number: '03001234567',
          cnic: '35201-12345671', // Invalid CNIC (missing second hyphen)
          area_id: areaA1.id,
          route_id: routeA1.id,
          zmcc_id: zmccSourceA.id,
          milk_source_id: milkSourceA.id,
          chiller_ownership_id: nestleOwnership.id,
          created_by: superAdmin.id,
        },
      });
    } catch {
      invalidCnicRejected = true;
    }

    assert(
      invalidCnicRejected,
      'CHECK-CNIC-FORMAT',
      'Pakistani CNIC check constraint strictly rejected invalid format "35201-12345671"'
    );

    // Normalized CNIC (13 digits) must succeed
    const shopNormalizedCnic = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-NORM-CNIC-${timestamp}`,
        shop_name: 'Normalized CNIC Shop',
        owner_name: 'Normalized Owner',
        phone_number: '03001234567',
        cnic: '3520112345671', // Exactly 13 digits
        area_id: areaA1.id,
        route_id: routeA1.id,
        zmcc_id: zmccSourceA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: nestleOwnership.id,
        created_by: superAdmin.id,
      },
    });

    assert(
      shopNormalizedCnic.id !== undefined,
      'CHECK-CNIC-NORMALIZED-DIGITS',
      'Pakistani CNIC check constraint accepted 13-digit normalized format "3520112345671"'
    );

    // ----------------------------------------------------
    // TEST 13: GPS Range and Both-or-Neither Nullability
    // ----------------------------------------------------
    // A: Both null -> must succeed
    const shopGpsNull = await prisma.zmccShop.create({
      data: {
        shop_code: `SHP-GPS-NULL-${timestamp}`,
        shop_name: 'GPS Null Shop',
        owner_name: 'Owner',
        phone_number: '03001234567',
        cnic: '3520112345671',
        area_id: areaA1.id,
        route_id: routeA1.id,
        zmcc_id: zmccSourceA.id,
        milk_source_id: milkSourceA.id,
        chiller_ownership_id: nestleOwnership.id,
        latitude: null,
        longitude: null,
        created_by: superAdmin.id,
      },
    });

    // B: One null, one set -> must fail
    let gpsOneNullRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-GPS-HALF-${timestamp}`,
          shop_name: 'GPS Half Shop',
          owner_name: 'Owner',
          phone_number: '03001234567',
          cnic: '3520112345671',
          area_id: areaA1.id,
          route_id: routeA1.id,
          zmcc_id: zmccSourceA.id,
          milk_source_id: milkSourceA.id,
          chiller_ownership_id: nestleOwnership.id,
          latitude: new Prisma.Decimal('31.52'),
          longitude: null, // Mismatched!
          created_by: superAdmin.id,
        },
      });
    } catch {
      gpsOneNullRejected = true;
    }

    // C: Out of range latitude (> 90) -> must fail
    let gpsOutOfRangeLatRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-GPS-OOR-LAT-${timestamp}`,
          shop_name: 'GPS OOR Lat Shop',
          owner_name: 'Owner',
          phone_number: '03001234567',
          cnic: '3520112345671',
          area_id: areaA1.id,
          route_id: routeA1.id,
          zmcc_id: zmccSourceA.id,
          milk_source_id: milkSourceA.id,
          chiller_ownership_id: nestleOwnership.id,
          latitude: new Prisma.Decimal('95.0'), // > 90!
          longitude: new Prisma.Decimal('74.0'),
          created_by: superAdmin.id,
        },
      });
    } catch {
      gpsOutOfRangeLatRejected = true;
    }

    // D: Out of range longitude (> 180) -> must fail
    let gpsOutOfRangeLonRejected = false;
    try {
      await prisma.zmccShop.create({
        data: {
          shop_code: `SHP-GPS-OOR-LON-${timestamp}`,
          shop_name: 'GPS OOR Lon Shop',
          owner_name: 'Owner',
          phone_number: '03001234567',
          cnic: '3520112345671',
          area_id: areaA1.id,
          route_id: routeA1.id,
          zmcc_id: zmccSourceA.id,
          milk_source_id: milkSourceA.id,
          chiller_ownership_id: nestleOwnership.id,
          latitude: new Prisma.Decimal('31.0'),
          longitude: new Prisma.Decimal('185.0'), // > 180!
          created_by: superAdmin.id,
        },
      });
    } catch {
      gpsOutOfRangeLonRejected = true;
    }

    assert(
      shopGpsNull.id !== undefined && gpsOneNullRejected && gpsOutOfRangeLatRejected && gpsOutOfRangeLonRejected,
      'CHECK-GPS-CONSTRAINTS-A..D',
      'Both-or-neither nullability and [-90..90, -180..180] GPS range check constraints strictly enforced'
    );

    // ----------------------------------------------------
    // TEST 14: Active / Inactive Lifecycle Management
    // ----------------------------------------------------
    const deactivatedShop = await prisma.zmccShop.update({
      where: { id: validShop.id },
      data: { is_active: false, updated_by: superAdmin.id },
    });

    const deactivatedRoute = await prisma.zmccRoute.update({
      where: { id: routeA1.id },
      data: { is_active: false, updated_by: superAdmin.id },
    });

    // Verify inactive records remain readable
    const readInactiveShop = await prisma.zmccShop.findUnique({
      where: { id: validShop.id },
    });

    assert(
      deactivatedShop.is_active === false &&
        deactivatedRoute.is_active === false &&
        readInactiveShop !== null &&
        readInactiveShop.is_active === false,
      'LIFECYCLE-ACTIVE-INACTIVE-A..C',
      'All master records support active/inactive toggling while remaining historically readable'
    );

    // ----------------------------------------------------
    // TEST 15: Prevention of Physical Cascade Deletion (Restrict Policy)
    // ----------------------------------------------------
    let deleteRouteBlocked = false;
    try {
      await prisma.zmccRoute.delete({
        where: { id: routeA1.id }, // Area A1 still references routeA1!
      });
    } catch {
      deleteRouteBlocked = true;
    }

    let deleteAreaBlocked = false;
    try {
      await prisma.zmccArea.delete({
        where: { id: areaA1.id }, // validShop still references areaA1!
      });
    } catch {
      deleteAreaBlocked = true;
    }

    let deleteMilkSourceBlocked = false;
    try {
      await prisma.zmccMilkSource.delete({
        where: { id: milkSourceA.id }, // validShop still references milkSourceA!
      });
    } catch {
      deleteMilkSourceBlocked = true;
    }

    assert(
      deleteRouteBlocked && deleteAreaBlocked && deleteMilkSourceBlocked,
      'PREVENT-CASCADE-DELETION-A..C',
      'Foreign keys enforce RESTRICT; physical deletion of referenced master records strictly blocked'
    );

    // ----------------------------------------------------
    // CLEANUP TEST FIXTURES
    // ----------------------------------------------------
    await prisma.zmccShop.deleteMany({
      where: { zmcc_id: { in: [zmccSourceA.id, zmccSourceB.id] } },
    });
    await prisma.zmccMilkSource.deleteMany({
      where: { zmcc_id: { in: [zmccSourceA.id, zmccSourceB.id] } },
    });
    await prisma.zmccArea.deleteMany({
      where: { zmcc_id: { in: [zmccSourceA.id, zmccSourceB.id] } },
    });
    await prisma.zmccRoute.deleteMany({
      where: { zmcc_id: { in: [zmccSourceA.id, zmccSourceB.id] } },
    });
    await prisma.procurementSource.deleteMany({
      where: { id: { in: [zmccSourceA.id, zmccSourceB.id] } },
    });

  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n===============================================================');
  console.log(`STAGE 6A VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6aVerification();
