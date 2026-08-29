import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function run4FDTests() {
  console.log('================================================================================');
  console.log('STAGE 4F-D: PLANT CONTRACTOR MANAGER RECEIPTS & RECONCILIATION CONTRACT SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${title}${detail ? ` (${detail})` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // Helper to create Request with Auth Cookie
  async function createAuthRequest(urlStr: string, method: string = 'GET', bodyObj?: any, u?: any) {
    const headers: Record<string, string> = {};
    if (u) {
      const userObj: User = {
        id: u.id.toString(),
        username: u.username,
        name: u.full_name || u.username,
        role: u.role as Role,
        department: u.department || '',
        zone: u.zone || null,
        scope_type: u.scope_type || 'SOURCE',
        procurement_source_id: u.procurement_source_id ? u.procurement_source_id.toString() : null,
      };
      const token = await createSessionToken(userObj);
      headers['cookie'] = `auth_token=${token}`;
      headers['authorization'] = `Bearer ${token}`;
    }

    if (bodyObj) {
      headers['content-type'] = 'application/json';
    }

    return new Request(urlStr, {
      method,
      headers,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
  }

  let tempAssignedManager: any = null;
  let tempUnboundManager: any = null;

  try {
    // --- SECTION A: FRONTEND CODE & COMPONENT STRUCTURE ---
    console.log('--- SECTION A: Component Implementation & Tab Placeholders ---');

    // A1: Route remains /contractor/manager and technical role CONTRACTOR_MANAGER
    assert(
      resolveRoleHome('CONTRACTOR_MANAGER') === '/contractor/manager',
      'TEST-A1: CONTRACTOR_MANAGER route remains /contractor/manager'
    );

    // A2: Files exist
    const receiptsPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/ContractorReceiptsReconciliation.tsx'
    );
    const workspacePath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx'
    );
    const helpersPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers.ts'
    );

    assert(fs.existsSync(receiptsPath), 'TEST-A2.1: ContractorReceiptsReconciliation.tsx exists');
    assert(fs.existsSync(workspacePath), 'TEST-A2.2: PlantContractorManagerWorkspace.tsx exists');
    assert(fs.existsSync(helpersPath), 'TEST-A2.3: contractorManagerHelpers.ts exists');

    // A3: Workspace mounts real Receipts component, History remains placeholder
    const workspaceSource = fs.readFileSync(workspacePath, 'utf-8');
    assert(
      workspaceSource.includes('<ContractorReceiptsReconciliation'),
      'TEST-A3.1: Workspace renders real ContractorReceiptsReconciliation component'
    );
    assert(
      workspaceSource.includes('Available in the next Stage 4F implementation slice'),
      'TEST-A3.2: History & Reports remains an explicit placeholder'
    );

    // --- SECTION B: FINAL RECEIPT AUTHORITY & INVARIANT COMPLIANCE ---
    console.log('\n--- SECTION B: Final Receipt Authority & Invariant Compliance ---');

    const receiptsSource = fs.readFileSync(receiptsPath, 'utf-8');
    const helpersSource = fs.readFileSync(helpersPath, 'utf-8');

    // B1: Final receipt authority uses canonical fields
    assert(
      receiptsSource.includes('v.finalReceiptExists') &&
        receiptsSource.includes('v.authoritativeFinalLiters') &&
        receiptsSource.includes('finalReceiptTransactionId'),
      'TEST-B1: Final receipt presentation uses finalReceiptExists, authoritativeFinalLiters, and finalReceiptTransactionId'
    );

    // B2: Receipt Pending rule
    assert(
      helpersSource.includes('secondWeightTimestamp && !finalReceiptExists'),
      'TEST-B2.1: Receipt Pending requires Second Weight exists AND final_receipt_exists is false'
    );
    assert(
      receiptsSource.includes('BEFORE_RECEIPT') &&
        receiptsSource.includes('!v.finalReceiptExists && !v.secondWeightTimestamp'),
      'TEST-B2.2: Vehicles before Second Weight are NOT mislabeled Receipt Pending'
    );

    // B3: Forbidden fallbacks absent
    assert(
      !receiptsSource.includes('computed_plant_liters') &&
        !receiptsSource.includes('computed_plant_13ts_liters'),
      'TEST-B3: Forbidden computed_plant_liters / computed_plant_13ts_liters are absent'
    );

    // B4: Whole-vehicle quantity uses vehicle_dispatch_gross_liters
    assert(
      helpersSource.includes('vehicle_dispatch_gross_liters'),
      'TEST-B4: Whole vehicle quantity authority uses vehicle_dispatch_gross_liters'
    );

    // B5: Liters variance calculation
    assert(
      helpersSource.includes('authoritativeFinalLiters - grossLiters'),
      'TEST-B5.1: Liters variance is defined as authoritativeFinalLiters - grossLiters'
    );
    assert(
      receiptsSource.includes('v.litersVariance < 0') &&
        receiptsSource.includes('v.litersVariance > 0'),
      'TEST-B5.2: Liters variance preserves arithmetic sign (+/-)'
    );

    // B6: Zero client source selectors or mutations
    assert(
      !receiptsSource.includes('<select') &&
        !workspaceSource.includes('<select'),
      'TEST-B6.1: Zero client-side source dropdowns or selectors exist'
    );
    assert(
      !receiptsSource.includes('method: \'POST\'') &&
        !receiptsSource.includes('method: \'PATCH\'') &&
        !receiptsSource.includes('method: \'PUT\'') &&
        !receiptsSource.includes('method: \'DELETE\''),
      'TEST-B6.2: Receipts view contains ZERO mutation controls or mutation API calls'
    );

    // --- SECTION C: LIVE BACKEND SOURCE ISOLATION CONTRACT ---
    console.log('\n--- SECTION C: Backend Source Isolation Verification ---');

    const contAlkhair = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-ALKHAIR', source_type: 'CONTRACTOR' },
    });
    const contImran = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-IMRAN', source_type: 'CONTRACTOR' },
    });

    assert(!!contAlkhair && !!contImran, 'TEST-C0: Contractor fixtures CONT-ALKHAIR and CONT-IMRAN exist');

    if (contAlkhair && contImran) {
      const ts = Date.now();
      tempAssignedManager = await prisma.user.create({
        data: {
          username: `test.mgr.alkhair.4fd.${ts}`,
          full_name: 'Test Al Khair 4FD Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: contAlkhair.id,
          is_active: true,
        },
      });

      tempUnboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.unbound.4fd.${ts}`,
          full_name: 'Test Unbound 4FD Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: null,
          is_active: true,
        },
      });

      // C1: Assigned manager receives only their own records
      const reqAssigned = await createAuthRequest(
        'http://localhost:3000/api/logs',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resAssigned = await getLogs(reqAssigned as any);
      assert(resAssigned.ok, 'TEST-C1.1: Assigned CONTRACTOR_MANAGER GET /api/logs returns HTTP 200');

      const jsonAssigned = await resAssigned.json();
      const foreignLogs = (jsonAssigned.logs || []).filter(
        (l: any) => l.procurement_source_id && l.procurement_source_id !== contAlkhair.id.toString()
      );
      assert(
        foreignLogs.length === 0,
        'TEST-C1.2: Assigned CONTRACTOR_MANAGER receives ZERO foreign contractor records',
        `Foreign count: ${foreignLogs.length}`
      );

      // C2: Unbound manager fails closed
      const reqUnbound = await createAuthRequest(
        'http://localhost:3000/api/logs',
        'GET',
        undefined,
        tempUnboundManager
      );
      const resUnbound = await getLogs(reqUnbound as any);
      const jsonUnbound = await resUnbound.json();
      assert(
        (jsonUnbound.logs || []).length === 0,
        'TEST-C2: Unbound CONTRACTOR_MANAGER fails closed with 0 records',
        `Count: ${(jsonUnbound.logs || []).length}`
      );
    }
  } finally {
    if (tempAssignedManager) {
      await prisma.user.delete({ where: { id: tempAssignedManager.id } }).catch(() => {});
    }
    if (tempUnboundManager) {
      await prisma.user.delete({ where: { id: tempUnboundManager.id } }).catch(() => {});
    }
  }

  // --- SUMMARY ---
  console.log('\n================================================================================');
  console.log(`STAGE 4F-D RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run4FDTests()
  .catch((err) => {
    console.error('Fatal error in Stage 4F-D test suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
