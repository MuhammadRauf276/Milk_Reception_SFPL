import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function run4FCTests() {
  console.log('================================================================================');
  console.log('STAGE 4F-C: PLANT CONTRACTOR MANAGER QUALITY & REJECTIONS CONTRACT SUITE');
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
    const qualityPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/ContractorQualityRejections.tsx'
    );
    const workspacePath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx'
    );
    const helpersPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers.ts'
    );

    assert(fs.existsSync(qualityPath), 'TEST-A2.1: ContractorQualityRejections.tsx exists');
    assert(fs.existsSync(workspacePath), 'TEST-A2.2: PlantContractorManagerWorkspace.tsx exists');
    assert(fs.existsSync(helpersPath), 'TEST-A2.3: contractorManagerHelpers.ts exists');

    // A3: Workspace mounts real Quality component, remaining tabs are placeholders
    const workspaceSource = fs.readFileSync(workspacePath, 'utf-8');
    assert(
      workspaceSource.includes('<ContractorQualityRejections'),
      'TEST-A3.1: Workspace renders real ContractorQualityRejections component'
    );
    assert(
      workspaceSource.includes('Available in the next Stage 4F implementation slice'),
      'TEST-A3.2: Remaining tabs (Receipts, History) remain explicit placeholders'
    );

    // --- SECTION B: STRICT QA AUTHORITY & IDENTITY INVARIANTS ---
    console.log('\n--- SECTION B: Strict QA Authority & Identity Invariants ---');

    const qualitySource = fs.readFileSync(qualityPath, 'utf-8');
    const helpersSource = fs.readFileSync(helpersPath, 'utf-8');

    // B1: Portion-wise granularity preserved
    assert(
      qualitySource.includes('acceptedPortions') &&
        qualitySource.includes('rejectedPortions') &&
        qualitySource.includes('holdPortions') &&
        qualitySource.includes('pendingPortions'),
      'TEST-B1.1: QA summary metrics count portions, not collapsed vehicles'
    );
    assert(
      qualitySource.includes('visiblePortions.map(') && qualitySource.includes('p.portion_number'),
      'TEST-B1.2: Portion-level QA rows are rendered individually per portion'
    );

    // B2: Distinct QA decisions
    assert(
      qualitySource.includes('ACCEPTED') &&
        qualitySource.includes('REJECTED') &&
        qualitySource.includes('HOLD') &&
        qualitySource.includes('PENDING'),
      'TEST-B2: ACCEPTED, REJECTED, HOLD, PENDING remain distinct decisions'
    );

    // B3: Strict Lab Test IDs for Plant LR and Fat
    assert(
      helpersSource.includes("PLANT_LR_TEST_CODE = 'LT-000008'") &&
        qualitySource.includes('PLANT_LR_TEST_CODE'),
      'TEST-B3.1: Plant LR strictly uses LabTest ID LT-000008'
    );
    assert(
      helpersSource.includes("PLANT_FAT_TEST_CODE = 'LT-000026'") &&
        qualitySource.includes('PLANT_FAT_TEST_CODE'),
      'TEST-B3.2: Plant Fat strictly uses LabTest ID LT-000026'
    );

    // B4: Absence of lab name fallback in helpers
    assert(
      !helpersSource.includes('r.lab_test?.testName?.includes') &&
        !qualitySource.includes('testName?.includes'),
      'TEST-B4: Zero fuzzy testName fallback is used for strict Plant LR/Fat'
    );

    // B5: Dispatch NOT_PERFORMED rule: dispatch tests do not pollute Plant QA
    assert(
      !qualitySource.includes('NOT_PERFORMED === REJECTED') &&
        !helpersSource.includes('NOT_PERFORMED') &&
        !qualitySource.includes('Contract Vehicle'),
      'TEST-B5: Dispatch-side NOT_PERFORMED / "Contract Vehicle" is NOT converted to Plant QA rejection'
    );

    // B6: Whole vehicle quantity authority
    assert(
      qualitySource.includes('vehicle_dispatch_gross_liters') ||
        qualitySource.includes('v.grossLiters'),
      'TEST-B6.1: Whole vehicle quantity presents vehicle_dispatch_gross_liters (Gross Liters)'
    );
    assert(
      qualitySource.includes('Portion Qty (Context)'),
      'TEST-B6.2: Portion quantity is labeled strictly as contextual'
    );

    // B7: Zero client source selectors or mutations
    assert(
      !qualitySource.includes('<select') &&
        !workspaceSource.includes('<select'),
      'TEST-B7.1: Zero client-side source dropdowns or selectors exist'
    );
    assert(
      !qualitySource.includes('method: \'POST\'') &&
        !qualitySource.includes('method: \'PATCH\'') &&
        !qualitySource.includes('method: \'PUT\'') &&
        !qualitySource.includes('method: \'DELETE\''),
      'TEST-B7.2: Quality view contains ZERO mutation controls or mutation API calls'
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
          username: `test.mgr.alkhair.4fc.${ts}`,
          full_name: 'Test Al Khair 4FC Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: contAlkhair.id,
          is_active: true,
        },
      });

      tempUnboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.unbound.4fc.${ts}`,
          full_name: 'Test Unbound 4FC Manager',
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
  console.log(`STAGE 4F-C RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run4FCTests()
  .catch((err) => {
    console.error('Fatal error in Stage 4F-C test suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
