import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role } from '../src/backend/core/types';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import fs from 'fs';
import path from 'path';

async function run4FETests() {
  console.log('================================================================================');
  console.log('STAGE 4F-E: PLANT CONTRACTOR MANAGER HISTORY & REPORTS CONTRACT SUITE');
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
    // --- SECTION A: FRONTEND CODE & ALL 5 TABS COMPLETION ---
    console.log('--- SECTION A: Component Implementation & All 5 Tabs ---');

    // A1: Route remains /contractor/manager and technical role CONTRACTOR_MANAGER
    assert(
      resolveRoleHome('CONTRACTOR_MANAGER') === '/contractor/manager',
      'TEST-A1: CONTRACTOR_MANAGER route remains /contractor/manager'
    );

    // A2: Files exist
    const historyPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/ContractorHistoryReports.tsx'
    );
    const workspacePath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/PlantContractorManagerWorkspace.tsx'
    );
    const helpersPath = path.join(
      __dirname,
      '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers.ts'
    );

    assert(fs.existsSync(historyPath), 'TEST-A2.1: ContractorHistoryReports.tsx exists');
    assert(fs.existsSync(workspacePath), 'TEST-A2.2: PlantContractorManagerWorkspace.tsx exists');
    assert(fs.existsSync(helpersPath), 'TEST-A2.3: contractorManagerHelpers.ts exists');

    // A3: Workspace mounts ALL 5 tabs with zero placeholders remaining
    const workspaceSource = fs.readFileSync(workspacePath, 'utf-8');
    assert(
      workspaceSource.includes('<ContractorOverview') &&
        workspaceSource.includes('<ContractorLivePipeline') &&
        workspaceSource.includes('<ContractorQualityRejections') &&
        workspaceSource.includes('<ContractorReceiptsReconciliation') &&
        workspaceSource.includes('<ContractorHistoryReports'),
      'TEST-A3.1: Workspace mounts all five dedicated contractor components'
    );
    assert(
      !workspaceSource.includes('Available in the next Stage 4F implementation slice'),
      'TEST-A3.2: Zero placeholder tab content remains in PlantContractorManagerWorkspace'
    );

    // --- SECTION B: BUSINESS DATE & FINAL RECEIPT AUTHORITY ---
    console.log('\n--- SECTION B: Reporting Business Date & 08:00 PKT Boundary ---');

    // B1: 08:00 PKT boundary tests
    // 07:59:59 PKT on 28-Aug is 02:59:59 UTC -> Business Date is 2026-08-27
    const preCutoffDate = getOperationalBusinessDate('2026-08-28T02:59:59.000Z');
    assert(
      preCutoffDate === '2026-08-27',
      'TEST-B1.1: 07:59:59 PKT event belongs to previous business date (2026-08-27)',
      `Got: ${preCutoffDate}`
    );

    // 08:00:00 PKT on 28-Aug is 03:00:00 UTC -> Business Date is 2026-08-28
    const postCutoffDate = getOperationalBusinessDate('2026-08-28T03:00:00.000Z');
    assert(
      postCutoffDate === '2026-08-28',
      'TEST-B1.2: 08:00:00 PKT event belongs to current business date (2026-08-28)',
      `Got: ${postCutoffDate}`
    );

    // B2: Read-model contains final_receipt_business_date and reporting_business_date
    const readModelSource = fs.readFileSync(
      path.join(__dirname, '../src/backend/services/operationalReadModelService.ts'),
      'utf-8'
    );
    assert(
      readModelSource.includes('final_receipt_business_date') &&
        readModelSource.includes('reporting_business_date') &&
        readModelSource.includes('getOperationalBusinessDate(finalReceiptTs)'),
      'TEST-B2: Read-model derives final_receipt_business_date using canonical getOperationalBusinessDate'
    );

    // B3: History component uses reportingBusinessDate
    const historySource = fs.readFileSync(historyPath, 'utf-8');
    assert(
      historySource.includes('v.reportingBusinessDate') &&
        historySource.includes('dateBasis'),
      'TEST-B3: History & Reports requests and displays reportingBusinessDate'
    );

    // B4: Zero client source selectors or mutations
    assert(
      !historySource.includes('<select') &&
        !workspaceSource.includes('<select'),
      'TEST-B4.1: Zero client-side source dropdowns or selectors exist'
    );
    assert(
      !historySource.includes('method: \'POST\'') &&
        !historySource.includes('method: \'PATCH\'') &&
        !historySource.includes('method: \'PUT\'') &&
        !historySource.includes('method: \'DELETE\''),
      'TEST-B4.2: History view contains ZERO mutation controls or mutation API calls'
    );

    // --- SECTION C: LIVE BACKEND API & SOURCE ISOLATION CONTRACT ---
    console.log('\n--- SECTION C: Live Backend Source Isolation & Reporting Filter Verification ---');

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
          username: `test.mgr.alkhair.4fe.${ts}`,
          full_name: 'Test Al Khair 4FE Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: contAlkhair.id,
          is_active: true,
        },
      });

      tempUnboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.unbound.4fe.${ts}`,
          full_name: 'Test Unbound 4FE Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: null,
          is_active: true,
        },
      });

      // C1: Assigned manager receives only their own records
      const reqAssigned = await createAuthRequest(
        'http://localhost:3000/api/logs?dateBasis=reporting',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resAssigned = await getLogs(reqAssigned as any);
      assert(resAssigned.ok, 'TEST-C1.1: Assigned CONTRACTOR_MANAGER GET /api/logs?dateBasis=reporting returns HTTP 200');

      const jsonAssigned = await resAssigned.json();
      const foreignLogs = (jsonAssigned.logs || []).filter(
        (l: any) => l.procurement_source_id && l.procurement_source_id !== contAlkhair.id.toString()
      );
      assert(
        foreignLogs.length === 0,
        'TEST-C1.2: Assigned CONTRACTOR_MANAGER receives ZERO foreign contractor records',
        `Foreign count: ${foreignLogs.length}`
      );

      // Verify records have final_receipt_business_date and reporting_business_date
      const finalizedLogs = (jsonAssigned.logs || []).filter((l: any) => l.final_receipt_exists);
      const unfinalizedLogs = (jsonAssigned.logs || []).filter((l: any) => !l.final_receipt_exists);

      const allFinalizedValid = finalizedLogs.every(
        (l: any) => !!l.final_receipt_business_date && l.reporting_business_date === l.final_receipt_business_date
      );
      assert(
        allFinalizedValid && finalizedLogs.length > 0,
        'TEST-C1.3: All finalized receipts have valid final_receipt_business_date equal to reporting_business_date',
        `Finalized count: ${finalizedLogs.length}`
      );

      const allUnfinalizedValid = unfinalizedLogs.every(
        (l: any) => (l.final_receipt_business_date === null || l.final_receipt_business_date === undefined) &&
                    l.reporting_business_date === l.dispatch_date
      );
      assert(
        allUnfinalizedValid && unfinalizedLogs.length > 0,
        'TEST-C1.4: All unfinalized visits have null final_receipt_business_date and reporting_business_date matches dispatch_date',
        `Unfinalized count: ${unfinalizedLogs.length}`
      );

      // C2: Unbound manager fails closed
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
        'TEST-C2: Unbound CONTRACTOR_MANAGER fails closed with 0 records',
        `Count: ${(jsonUnbound.logs || []).length}`
      );

      // C3: Legacy/default API without dateBasis works identically
      const reqLegacy = await createAuthRequest(
        'http://localhost:3000/api/logs',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resLegacy = await getLogs(reqLegacy as any);
      assert(resLegacy.ok, 'TEST-C3: Legacy GET /api/logs without dateBasis succeeds with backward compatibility');
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
  console.log(`STAGE 4F-E RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run4FETests()
  .catch((err) => {
    console.error('Fatal error in Stage 4F-E test suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
