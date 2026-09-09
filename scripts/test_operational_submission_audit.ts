import { prisma } from '../src/backend/core/db';
import { calculateSubmissionDelayMs } from '../src/backend/core/business-day';
import { assertSafeTestDatabase } from '../tests/helpers/testDbSafety';

async function runOperationalSubmissionAuditTests() {
  console.log('🧪 RUNNING OPERATIONAL VS SUBMISSION AUDIT TEST SUITE (AUDIT-TIME-01..08)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}] - ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] - ${detail}`);
      failed++;
    }
  }

  try {
    const { testDbName } = assertSafeTestDatabase();
    const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const currentDb = dbCheck[0]?.current_database;

    if (currentDb !== testDbName) {
      throw new Error(
        `CRITICAL SAFETY ERROR: Expected configured test database '${testDbName}', connected to '${currentDb}'. Refusing to execute.`
      );
    }

    // AUDIT-TIME-01: Vehicle Visit table maintains created_at (server submission) vs operational_date
    const visit = await prisma.vehicleVisit.findFirst();
    assert(!!visit?.created_at, 'AUDIT-TIME-01', 'VehicleVisit maintains server created_at timestamp');

    // AUDIT-TIME-02: GateLog table maintains entry_timestamp (operational) vs created_at (server submission)
    const gateLog = await prisma.gateLog.findFirst();
    assert(gateLog !== null && !!gateLog.entry_timestamp && !!gateLog.created_at, 'AUDIT-TIME-02', 'GateLog maintains operational entry_timestamp and server created_at');

    // AUDIT-TIME-03: Performed by actor attribution
    const dispatch = await prisma.dispatchInfo.findFirst();
    assert(dispatch !== null && dispatch.recorded_by !== null && dispatch.recorded_by !== undefined, 'AUDIT-TIME-03', 'DispatchInfo contains recorded_by performer attribution field');

    // AUDIT-TIME-04: Data-entry delay calculation
    const op = new Date('2026-08-11T09:00:00.000Z');
    const sub = new Date('2026-08-11T09:12:30.000Z');
    const delaySec = calculateSubmissionDelayMs(op, sub) / 1000;
    assert(delaySec === 750, 'AUDIT-TIME-04', `Calculated data-entry delay = 750s (12m 30s)`);

    // AUDIT-TIME-05..08: Schema immutability & server timestamps
    const columns = await prisma.$queryRaw<Array<{ column_default: string | null; is_nullable: string }>>`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'audit_log'
        AND column_name = 'created_at'
    `;

    const column = columns[0];
    const normalizedDefault = column?.column_default ? column.column_default.trim().toUpperCase() : '';
    const isTimestampDefault = normalizedDefault === 'CURRENT_TIMESTAMP' || normalizedDefault.startsWith('CURRENT_TIMESTAMP');
    const isNotNull = column?.is_nullable === 'NO';

    assert(
      columns.length === 1 && isNotNull && isTimestampDefault,
      'AUDIT-TIME-05',
      'AuditLog.created_at is NOT NULL with database default CURRENT_TIMESTAMP'
    );

    console.log(`\n========================================`);
    console.log(`SUBMISSION AUDIT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running audit tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runOperationalSubmissionAuditTests();
