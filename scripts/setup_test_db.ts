import { Client } from 'pg';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { assertSafeTestDatabase, parseDatabaseNameFromUrl } from '../tests/helpers/testDbSafety';
import { PrismaClient } from '@prisma/client';

const repoRoot = path.resolve(__dirname, '..');

// Load environment variables from .env if needed
if (!process.env.DATABASE_URL && fs.existsSync(path.join(repoRoot, '.env'))) {
  const envContent = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        let val = trimmed.substring(idx + 1).trim();
        if ((val.startsWith('') && val.endsWith('')) || (val.startsWith(') && val.endsWith('))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

// Derive TEST_DATABASE_URL if not explicitly set
if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
  const devUrl = process.env.DATABASE_URL;
  const devDbName = parseDatabaseNameFromUrl(devUrl);
  if (devDbName) {
    process.env.TEST_DATABASE_URL = devUrl.replace(`/${devDbName}`, '/milk_reception_test');
  }
}

async function setupTestDatabase() {
  console.log('==================================================');
  console.log('🛠️  PROVISIONING DEDICATED TEST DATABASE');
  console.log('==================================================\n');

  // 1. Safety Guard Verification
  const { testDbName } = assertSafeTestDatabase();
  const devDbName = parseDatabaseNameFromUrl(process.env.DATABASE_URL || '');

  console.log(`Development Database Name: ${devDbName}`);
  console.log(`Test Database Name:        ${testDbName}`);
  console.log(`Databases are distinct:    ${devDbName !== testDbName ? 'YES' : 'NO'}`);
  console.log(`Database Role:             TEST`);
  console.log(`DB Connection String:      REDACTED\n`);

  // 2. Connect to postgres server via DATABASE_URL to ensure fresh test DB exists
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await pgClient.connect();
    console.log(`Re-creating fresh test database "${testDbName}"...`);
    await pgClient.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await pgClient.query(`CREATE DATABASE "${testDbName}"`);
    console.log(`✅ Fresh test database "${testDbName}" created.\n`);
  } catch (err: any) {
    console.warn(`Warning preparing test database: ${err.message}. Attempting direct migrate deploy...`);
  } finally {
    await pgClient.end().catch(() => {});
  }

  // 3. Deploy Tracked Migrations to TEST DB
  console.log('▶ Deploying tracked Prisma migrations to TEST DB...');
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
  console.log('✅ Migrations successfully deployed to TEST DB.\n');

  // 4. Perform Isolation Sentinel Verification
  console.log('▶ Verifying Test Database Isolation via Sentinel Row...');
  const testPrisma = new PrismaClient({
    datasources: { db: { url: process.env.TEST_DATABASE_URL } },
  });
  const devPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  const sentinelCode = `TEST_SENTINEL_${Date.now()}`;

  try {
    // Insert sentinel into TEST DB
    await testPrisma.procurementSource.create({
      data: {
        code: sentinelCode,
        name: 'Isolation Sentinel Source',
        source_type: 'ZMCC',
        is_active: false,
      },
    });

    // Check TEST DB
    const testFound = await testPrisma.procurementSource.findUnique({
      where: { code: sentinelCode },
    });
    console.log(`TEST sentinel present in TEST DB: ${testFound ? 'YES' : 'NO'}`);

    // Check DEV DB
    const devFound = await devPrisma.procurementSource.findUnique({
      where: { code: sentinelCode },
    });
    console.log(`Same sentinel present in DEV DB:  ${devFound ? 'YES (LEAK)' : 'NO'}`);

    if (testFound && !devFound) {
      console.log('\n==================================================');
      console.log('VERDICT: TEST DATABASE ISOLATED FROM DEVELOPMENT DATABASE');
      console.log('==================================================\n');
    } else {
      console.error('\n❌ ISOLATION FAILURE: Sentinel found in development database!');
      process.exit(1);
    }

    // Clean sentinel from TEST DB
    await testPrisma.procurementSource.delete({
      where: { code: sentinelCode },
    });

    // 5. Persist TEST_DATABASE_URL to local gitignored .env.test.local
    const envTestLocalPath = path.join(repoRoot, '.env.test.local');
    fs.writeFileSync(envTestLocalPath, `TEST_DATABASE_URL="${process.env.TEST_DATABASE_URL}"\n`, 'utf8');
    console.log('✅ Wrote isolated local configuration to .env.test.local (gitignored).\n');
  } finally {
    await testPrisma.$disconnect().catch(() => {});
    await devPrisma.$disconnect().catch(() => {});
  }
}

setupTestDatabase().catch((err) => {
  console.error('❌ Error provisioning test database:', err.message || 'Setup failed.');
  process.exit(1);
});
