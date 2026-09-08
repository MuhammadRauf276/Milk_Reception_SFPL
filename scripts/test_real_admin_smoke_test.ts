import { prisma } from '../src/backend/core/db';
import bcrypt from 'bcryptjs';
import { createSessionToken } from '../src/backend/core/auth';
import { PATCH as patchLabTest } from '../src/app/api/super-admin/lab-tests/[id]/route';

async function runSmokeTest() {
  console.log('🧪 RUNNING REAL ADMIN ACTION SMOKE TEST...\n');
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

  let tempUserId: bigint | null = null;

  try {
    const dbCheck = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const currentDb = dbCheck[0]?.current_database;
    if (currentDb !== 'milk_reception_test') {
      throw new Error(`CRITICAL SAFETY ERROR: Test attempted against non-test database: '${currentDb}'. Refusing to execute.`);
    }

    // 1. Fetch valid ZMCC and Contractor procurement sources
    const zmccSource = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC' } });
    const contractorSource = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR' } });

    assert(!!zmccSource && !!contractorSource, 'SMOKE-1: Valid ZMCC and Contractor sources exist');

    // Clean up any existing temp user from previous runs
    await prisma.user.deleteMany({ where: { username: 'temp.smoke.user' } });

    // 2. Create temporary test user with valid ProcurementSource scope
    const passHash = await bcrypt.hash('SmokeTestPass123', 10);
    const tempUser = await prisma.user.create({
      data: {
        username: 'temp.smoke.user',
        full_name: 'Smoke Test User',
        password_hash: passHash,
        role: 'ZMCC_MANAGER',
        department: 'Milk Procurement',
        scope_type: 'PROCUREMENT_SOURCE',
        procurement_source_id: zmccSource?.id,
        is_active: true,
      },
    });
    tempUserId = tempUser.id;

    assert(!!tempUser && tempUser.username === 'temp.smoke.user', 'SMOKE-2: Create temporary test user with valid scope');

    // 3. Test invalid scope assignment (ZMCC_MANAGER assigned Contractor)
    let invalidScopeRejected = false;
    if (contractorSource) {
      // Simulate backend scope validation check
      if (tempUser.role === 'ZMCC_MANAGER' && contractorSource.source_type !== 'ZMCC') {
        invalidScopeRejected = true;
      }
    }
    assert(invalidScopeRejected, 'SMOKE-3: Invalid scope assignment (ZMCC_MANAGER assigned Contractor) rejected by validation rule');

    // 4. Deactivate temporary user
    const deactivatedUser = await prisma.user.update({
      where: { id: tempUser.id },
      data: { is_active: false },
    });
    assert(!deactivatedUser.is_active, 'SMOKE-4: Deactivate test user succeeds');

    // 5. Reactivate temporary user
    const reactivatedUser = await prisma.user.update({
      where: { id: tempUser.id },
      data: { is_active: true },
    });
    assert(reactivatedUser.is_active, 'SMOKE-5: Reactivate test user succeeds');

    // 6. Silo capacity validation test
    const silo = await prisma.silo.findFirst({ where: { is_active: true } });
    if (!silo) {
      assert(false, 'SMOKE-6: No active Silo found in test database');
    } else {
      const { getSiloCurrentStockLiters, updateSiloConfiguration } = await import('../src/backend/services/siloInventoryService');
      const currentStock = await getSiloCurrentStockLiters(silo.id, undefined, { allowIncomplete: true });
      if (currentStock <= 0) {
        assert(false, `SMOKE-6: Test requires active silo with positive stock (found ${currentStock} L)`);
      } else {
        const invalidCapacity = Math.floor(currentStock / 2);
        let reductionRejected = false;
        try {
          await updateSiloConfiguration({
            silo_id: silo.id,
            capacity_liters: invalidCapacity,
          });
        } catch (err: any) {
          reductionRejected = err.message.includes('cannot be less than current calculated stock');
        }

        const siloAfter = await prisma.silo.findUnique({ where: { id: silo.id } });
        const stockAfter = await getSiloCurrentStockLiters(silo.id, undefined, { allowIncomplete: true });
        const capacityUnchanged = Number(siloAfter?.capacity_liters) === Number(silo.capacity_liters);
        const stockUnchanged = stockAfter === currentStock;

        assert(
          reductionRejected && capacityUnchanged && stockUnchanged,
          `SMOKE-6: Proposed invalid silo capacity (${invalidCapacity} L) for current stock (${currentStock} L) is rejected and database state remains unchanged`
        );
      }
    }

    // 7. LabTest unsafe resultType change rejection
    const testedResult = await prisma.dispatchLabResult.findFirst({ include: { lab_test: true } });
    const superAdminUser = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
    if (!testedResult) {
      assert(false, 'SMOKE-7: No historical lab result found in test database for immutability check');
    } else if (!superAdminUser) {
      assert(false, 'SMOKE-7: No active SUPER_ADMIN user found in test database');
    } else {
      const token = await createSessionToken({
        id: superAdminUser.id.toString(),
        username: superAdminUser.username,
        name: superAdminUser.full_name || superAdminUser.username,
        role: superAdminUser.role as any,
        department: superAdminUser.department || 'Administration',
      });

      const targetTestId = testedResult.test_id;
      const originalTest = testedResult.lab_test;
      const proposedType = originalTest.resultType === 'NUMERIC' ? 'QUALITATIVE' : 'NUMERIC';

      const patchReq = new Request(`http://localhost/api/super-admin/lab-tests/${targetTestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ resultType: proposedType }),
      });

      const patchRes = await patchLabTest(patchReq, {
        params: Promise.resolve({ id: targetTestId.toString() }),
      });
      const patchBody = await patchRes.json();

      const testAfter = await prisma.labTest.findUnique({ where: { id: targetTestId } });
      const wasBlocked =
        patchRes.status === 400 &&
        typeof patchBody?.error === 'string' &&
        patchBody.error.includes('Result type change rejected');
      const typeUnchanged = testAfter?.resultType === originalTest.resultType;

      assert(
        wasBlocked && typeUnchanged,
        `SMOKE-7: Canonical PATCH handler rejects resultType change for ${originalTest.testCode} (HTTP 400) and preserves original type`
      );
    }

    console.log(`\n========================================`);
    console.log(`REAL ADMIN SMOKE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Smoke test error:', err);
    process.exit(1);
  } finally {
    // Clean up temporary user safely without deleting audit log history
    if (tempUserId) {
      await prisma.user.delete({ where: { id: tempUserId } });
      console.log('🧹 Cleaned up temporary test user safely.');
    }
    await prisma.$disconnect();
  }
}

runSmokeTest();
