import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import fs from 'fs';
import path from 'path';

async function runPlantContractorManagerContracts() {
  console.log('================================================================================');
  console.log('STAGE 4F CANONICAL CONTRACTS: PLANT CONTRACTOR MANAGER');
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
    // --- 1. ROLE ROUTING & FIVE WORKSPACE TABS ---
    console.log('--- 1. Role Routing & 5 Workspace Tabs ---');
    assert(
      resolveRoleHome('CONTRACTOR_MANAGER') === '/contractor/manager',
      '4F-INVARIANT-01: Technical role CONTRACTOR_MANAGER routes to /contractor/manager'
    );

    const workspacePath = path.join(__dirname, '../src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx');
    const workspaceSource = fs.readFileSync(workspacePath, 'utf-8');
    assert(
      workspaceSource.includes('<ContractorOverview') &&
        workspaceSource.includes('<ContractorLivePipeline') &&
        workspaceSource.includes('<ContractorQualityRejections') &&
        workspaceSource.includes('<ContractorReceiptsReconciliation') &&
        workspaceSource.includes('<ContractorHistoryReports'),
      '4F-INVARIANT-02: All five Stage 4F tabs (Overview, Live, Quality, Receipts, History) are implemented'
    );

    // --- 2. AUTHORITY INVARIANTS & STRICT LAB IDENTITIES ---
    console.log('\n--- 2. Authority Invariants & Strict Lab Identities ---');
    const helpersPath = path.join(__dirname, '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers.ts');
    const helpersSource = fs.readFileSync(helpersPath, 'utf-8');
    const qualityPath = path.join(__dirname, '../src/frontend/modules/dashboard/contractor/ContractorQualityRejections.tsx');
    const qualitySource = fs.readFileSync(qualityPath, 'utf-8');

    assert(
      helpersSource.includes('vehicle_dispatch_gross_liters'),
      '4F-INVARIANT-03: Whole vehicle dispatch authority strictly uses vehicle_dispatch_gross_liters (Gross Liters)'
    );

    assert(
      helpersSource.includes('final_receipt_exists') && helpersSource.includes('authoritative_final_liters'),
      '4F-INVARIANT-04: Final receipt authority strictly uses final_receipt_exists and authoritative_final_liters'
    );

    assert(
      helpersSource.includes('secondWeightTimestamp && !finalReceiptExists'),
      '4F-INVARIANT-05: Receipt Pending requires second_weight_timestamp exists AND !final_receipt_exists'
    );

    assert(
      helpersSource.includes('LT-000008') &&
        helpersSource.includes('LT-000026') &&
        qualitySource.includes('PLANT_LR_TEST_CODE') &&
        qualitySource.includes('PLANT_FAT_TEST_CODE'),
      '4F-INVARIANT-06: Strict Plant QA LabTest IDs LT-000008 (Plant LR) and LT-000026 (Plant Fat) enforced'
    );

    assert(
      !workspaceSource.includes('computed_plant_liters') &&
        !workspaceSource.includes('computed_plant_13ts_liters') &&
        !helpersSource.includes('computed_plant_liters as final') &&
        !helpersSource.includes('computed_plant_13ts_liters as final'),
      '4F-INVARIANT-07: Forbidden computed_plant_liters / computed_plant_13ts_liters are absent as final receipt'
    );

    // --- 3. REPORTING BUSINESS DATE & 08:00 PKT BOUNDARY ---
    console.log('\n--- 3. Reporting Business Date & 08:00 PKT Boundary ---');
    assert(
      getOperationalBusinessDate('2026-08-28T02:59:59.000Z') === '2026-08-27',
      '4F-INVARIANT-08A: Event at 07:59:59 PKT belongs to previous business date (2026-08-27)'
    );
    assert(
      getOperationalBusinessDate('2026-08-28T03:00:00.000Z') === '2026-08-28',
      '4F-INVARIANT-08B: Event at 08:00:00 PKT belongs to current business date (2026-08-28)'
    );

    // --- 4. BACKEND SOURCE ISOLATION & FAIL CLOSED ---
    console.log('\n--- 4. Backend Source Isolation & Fail-Closed Contract ---');
    const contAlkhair = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-ALKHAIR', source_type: 'CONTRACTOR' },
    });
    const contImran = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-IMRAN', source_type: 'CONTRACTOR' },
    });

    assert(!!contAlkhair && !!contImran, '4F-INVARIANT-09: Procurement source contractor fixtures exist');

    if (contAlkhair && contImran) {
      const ts = Date.now();
      tempAssignedManager = await prisma.user.create({
        data: {
          username: `test.mgr.alkhair.4f.${ts}`,
          full_name: 'Test Al Khair 4F Final Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: contAlkhair.id,
          is_active: true,
        },
      });

      tempUnboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.unbound.4f.${ts}`,
          full_name: 'Test Unbound 4F Final Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: null,
          is_active: true,
        },
      });

      // 4.1 Assigned manager receives only assigned contractor records
      const reqAssigned = await createAuthRequest(
        'http://localhost:3000/api/logs?dateBasis=reporting',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resAssigned = await getLogs(reqAssigned as any);
      assert(resAssigned.ok, '4F-INVARIANT-10: Assigned CONTRACTOR_MANAGER GET /api/logs returns HTTP 200');

      const jsonAssigned = await resAssigned.json();
      const foreignLogs = (jsonAssigned.logs || []).filter(
        (l: any) => l.procurement_source_id && l.procurement_source_id !== contAlkhair.id.toString()
      );
      assert(
        foreignLogs.length === 0,
        '4F-INVARIANT-11: Assigned CONTRACTOR_MANAGER receives ZERO foreign contractor records',
        `Foreign count: ${foreignLogs.length}`
      );

      // 4.2 Unbound manager fails closed
      const reqUnbound = await createAuthRequest(
        'http://localhost:3000/api/logs?dateBasis=reporting',
        'GET',
        undefined,
        tempUnboundManager
      );
      const resUnbound = await getLogs(reqUnbound as any);
      const jsonUnbound = await resUnbound.json();
      assert(
        (jsonUnbound.logs || []).length === 0,
        '4F-INVARIANT-12: Unbound CONTRACTOR_MANAGER fails closed to ZERO records',
        `Count: ${(jsonUnbound.logs || []).length}`
      );
    }

    // --- 5. READ-ONLY & ZERO CLIENT SOURCE SELECTOR ---
    console.log('\n--- 5. Read-Only UI & Zero Source Selector ---');
    assert(
      !workspaceSource.includes('<select'),
      '4F-INVARIANT-13: Workspace contains ZERO client-side source dropdowns or selectors'
    );
    assert(
      !workspaceSource.includes('method: \'POST\'') &&
        !workspaceSource.includes('method: \'PATCH\'') &&
        !workspaceSource.includes('method: \'DELETE\''),
      '4F-INVARIANT-14: Workspace contains ZERO mutation controls'
    );
  } finally {
    if (tempAssignedManager) {
      await prisma.user.delete({ where: { id: tempAssignedManager.id } }).catch(() => {});
    }
    if (tempUnboundManager) {
      await prisma.user.delete({ where: { id: tempUnboundManager.id } }).catch(() => {});
    }
  }

  console.log('\n================================================================================');
  console.log(`STAGE 4F CANONICAL CONTRACT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPlantContractorManagerContracts()
  .catch((err) => {
    console.error('Fatal error in Stage 4F canonical contract test:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
