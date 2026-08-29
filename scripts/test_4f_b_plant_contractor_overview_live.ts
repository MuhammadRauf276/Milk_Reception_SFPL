import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function run4FBTests() {
  console.log('================================================================================');
  console.log('STAGE 4F-B: PLANT CONTRACTOR MANAGER OVERVIEW + LIVE PIPELINE CONTRACT SUITE');
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
    const overviewPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/ContractorOverview.tsx'
    );
    const livePipelinePath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/ContractorLivePipeline.tsx'
    );
    const workspacePath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx'
    );

    assert(fs.existsSync(overviewPath), 'TEST-A2.1: ContractorOverview.tsx exists');
    assert(fs.existsSync(livePipelinePath), 'TEST-A2.2: ContractorLivePipeline.tsx exists');
    assert(fs.existsSync(workspacePath), 'TEST-A2.3: PlantContractorManagerWorkspace.tsx exists');

    // A3: Workspace mounts real Overview and Live components, remaining tabs are placeholders
    const workspaceSource = fs.readFileSync(workspacePath, 'utf-8');
    assert(
      workspaceSource.includes('<ContractorOverview') && workspaceSource.includes('<ContractorLivePipeline'),
      'TEST-A3.1: Workspace renders real ContractorOverview and ContractorLivePipeline components'
    );
    assert(
      workspaceSource.includes('<ContractorQualityRejections') ||
        workspaceSource.includes('Available in the next Stage 4F implementation slice'),
      'TEST-A3.2: Quality, Receipts, and History are either placeholder or implemented'
    );

    // A4: Overview content inspection
    const overviewSource = fs.readFileSync(overviewPath, 'utf-8');
    assert(
      overviewSource.includes('totalDispatches') &&
        overviewSource.includes('activeInPlantCount') &&
        overviewSource.includes('completedReceiptsCount') &&
        overviewSource.includes('totalReceivedLiters'),
      'TEST-A4.1: Overview calculates and presents 4 core summary cards'
    );
    assert(
      overviewSource.includes('Recent Plant Dispatches') && overviewSource.includes('<table'),
      'TEST-A4.2: Overview contains compact Recent Dispatches activity table'
    );

    // A5: Live Pipeline content inspection
    const liveSource = fs.readFileSync(livePipelinePath, 'utf-8');
    assert(
      liveSource.includes('searchQuery') && liveSource.includes('stageFilter'),
      'TEST-A5.1: Live Pipeline contains search and stage filter controls'
    );
    assert(
      liveSource.includes('Security Gate') &&
        liveSource.includes('QA Lab') &&
        liveSource.includes('1st Weight') &&
        liveSource.includes('Silo Unload') &&
        liveSource.includes('Final Receipt'),
      'TEST-A5.2: Live Pipeline renders 5-step plant milestone journey strip'
    );

    // --- SECTION B: BUSINESS AUTHORITY & INVARIANT COMPLIANCE ---
    console.log('\n--- SECTION B: Authority Invariants & Absence of Forbidden Calculations ---');

    const helpersPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers.ts'
    );
    const helpersSource = fs.readFileSync(helpersPath, 'utf-8');

    // B1: Whole-vehicle quantity uses vehicle_dispatch_gross_liters (Gross Liters)
    assert(
      helpersSource.includes('vehicle_dispatch_gross_liters') &&
        !helpersSource.includes('computed_dispatch_13ts_liters'),
      'TEST-B1: Whole vehicle quantity authority uses vehicle_dispatch_gross_liters (Gross Liters)'
    );

    // B2: Authoritative final receipts uses final_receipt_exists & authoritative_final_liters
    assert(
      helpersSource.includes('final_receipt_exists') &&
        helpersSource.includes('authoritative_final_liters'),
      'TEST-B2: Final receipt presentation uses final_receipt_exists and authoritative_final_liters'
    );

    // B3: Forbidden calculated fallbacks are NOT used as final receipt
    assert(
      !overviewSource.includes('computed_plant_liters') &&
        !overviewSource.includes('computed_plant_13ts_liters') &&
        !helpersSource.includes('computed_plant_liters as final') &&
        !liveSource.includes('computed_plant_13ts_liters'),
      'TEST-B3: Forbidden computed_plant_liters / computed_plant_13ts_liters are absent'
    );

    // B4: Receipt Pending rule
    assert(
      helpersSource.includes('secondWeightTimestamp && !finalReceiptExists'),
      'TEST-B4: Receipt Pending rule requires Second Weight exists AND final_receipt_exists is false'
    );

    // B5: Zero client-side source dropdowns or selectors
    assert(
      !workspaceSource.includes('<select') &&
        !overviewSource.includes('<select') &&
        !liveSource.includes('<select'),
      'TEST-B5: Zero client-side source selectors or dropdowns exist'
    );

    // B6: Zero mutation controls
    assert(
      !workspaceSource.includes('method: \'POST\'') &&
        !workspaceSource.includes('method: \'PATCH\'') &&
        !overviewSource.includes('method: \'POST\'') &&
        !liveSource.includes('method: \'POST\''),
      'TEST-B6: Workspace and tabs contain ZERO mutation controls / mutation API calls'
    );

    // --- SECTION C: BACKEND SOURCE ISOLATION CONTRACT ---
    console.log('\n--- SECTION C: Live Backend Source Isolation Verification ---');

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
          username: `test.mgr.alkhair.4fb.${ts}`,
          full_name: 'Test Al Khair 4FB Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: contAlkhair.id,
          is_active: true,
        },
      });

      tempUnboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.unbound.4fb.${ts}`,
          full_name: 'Test Unbound 4FB Manager',
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

      // C3: Tampered query params cannot widen scope
      const reqTamper = await createAuthRequest(
        `http://localhost:3000/api/logs?procurementSourceId=${contImran.id}&contractor=${contImran.code}`,
        'GET',
        undefined,
        tempAssignedManager
      );
      const resTamper = await getLogs(reqTamper as any);
      const jsonTamper = await resTamper.json();
      const foreignTamperLogs = (jsonTamper.logs || []).filter(
        (l: any) => l.procurement_source_id && l.procurement_source_id !== contAlkhair.id.toString()
      );
      assert(
        foreignTamperLogs.length === 0,
        'TEST-C3: Client query param tampering receives ZERO foreign contractor records'
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
  console.log(`STAGE 4F-B RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run4FBTests()
  .catch((err) => {
    console.error('Fatal error in Stage 4F-B test suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
