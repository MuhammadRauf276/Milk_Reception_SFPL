import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role, MilkProcessLog } from '../src/backend/core/types';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import { buildContractorVehicleVisits } from '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers';
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
  let tempMisboundManager: any = null;
  let testVisitA: any = null;
  let testVisitB: any = null;
  let testVisitZMCC: any = null;

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

    // B3.2: Behavioral tests for missing receipt timestamp vs non-final record
    const mockLogFinalizedNoDate: MilkProcessLog = {
      id: 99902,
      portion_id: 1,
      visit_number: 'VISIT-99902',
      reception_number: 'REC-99902',
      vehicle_number: 'LES-9999',
      portion_number: 'Portion 1',
      token_number: 'T-999',
      zonal_contractor_name: 'Test Contractor',
      status: 'COMPLETED',
      dispatch_date: '2026-08-28',
      dispatch_day: 'Friday',
      dispatch_week: 32,
      dispatch_month: 'August',
      dispatch_year: 2026,
      zonal_contractor_dispatch_time: '10:00',
      dispatch_kg_gross: null,
      dispatch_liters_gross: null,
      vehicle_dispatch_quantity_value: null,
      vehicle_dispatch_quantity_unit: null,
      vehicle_dispatch_quantity_basis: null,
      vehicle_dispatch_gross_liters: 5000,
      dispatch_tests: null,
      dispatch_fat: 4.5,
      dispatch_lr: 28,
      igp_date: null,
      igp_time: null,
      out_from_gate_time: null,
      sampling_date: null,
      sampling_time_start: null,
      sampling_time_end: null,
      sampling_fat: null,
      sampling_lr: null,
      b_mbrt_minutes_test: null,
      calculated_status: 'PENDING',
      rejection_reasons: null,
      borderline_warning: false,
      first_weight_time: null,
      first_weight_of_vehicle: null,
      second_weight_time: null,
      second_weight_of_vehicle: null,
      reception_date: null,
      reception_start_time: null,
      reception_end_time: null,
      silo_storage_id: null,
      computed_dispatch_snf: null,
      computed_dispatch_ts: null,
      computed_dispatch_13ts_liters: null,
      computed_sampling_snf: null,
      computed_sampling_ts: null,
      computed_plant_liters: null,
      computed_net_milk_weight: null,
      computed_plant_13ts_liters: null,
      dispatch_timestamp: '2026-08-28T10:00:00.000Z',
      gate_entry_timestamp: null,
      gate_exit_timestamp: null,
      first_weight_timestamp: null,
      second_weight_timestamp: null,
      unloading_start_timestamp: null,
      unloading_end_timestamp: null,
      final_receipt_exists: true,
      final_receipt_transaction_id: 123,
      final_receipt_timestamp: null,
      final_receipt_business_date: null,
      reporting_business_date: null,
      authoritative_final_liters: 5000,
      created_at: '2026-08-28T10:00:00.000Z',
      updated_at: '2026-08-28T10:00:00.000Z',
    };
    const builtFinalizedVisits = buildContractorVehicleVisits([mockLogFinalizedNoDate]);
    assert(
      builtFinalizedVisits[0].reportingBusinessDate === null,
      'TEST-B3.2: Finalized receipt with missing receipt business date maps to reportingBusinessDate=null (no dispatch_date fallback)'
    );

    const mockLogNonFinal: MilkProcessLog = {
      ...mockLogFinalizedNoDate,
      id: 99903,
      final_receipt_exists: false,
      final_receipt_business_date: null,
      reporting_business_date: '2026-08-28',
      dispatch_date: '2026-08-28',
    };
    const builtNonFinalVisits = buildContractorVehicleVisits([mockLogNonFinal]);
    assert(
      builtNonFinalVisits[0].reportingBusinessDate === '2026-08-28',
      'TEST-B3.3: Non-final visit uses dispatch_date for reportingBusinessDate'
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
    const contAlkhair = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-ALKHAIR', source_type: 'CONTRACTOR' },
    });
    const contImran = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-IMRAN', source_type: 'CONTRACTOR' },
    });
    const zmccSource = await prisma.procurementSource.findFirst({
      where: { source_type: 'ZMCC' },
    });

    assert(!!contAlkhair && !!contImran && !!zmccSource, 'TEST-C0: Contractor fixtures and ZMCC fixture exist');

    if (contAlkhair && contImran && zmccSource) {
      const ts = Date.now();
      const vehicleA = `TEST-4FE-A-${ts}`;
      const vehicleB = `TEST-4FE-B-${ts}`;
      const vehicleZMCC = `TEST-4FE-Z-${ts}`;

      testVisitA = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VISIT-4FE-A-${ts}`,
          vehicle_number: vehicleA,
          procurement_source_id: contAlkhair.id,
          current_status: 'DISPATCHED',
          operational_date: new Date('2026-08-28T00:00:00.000Z'),
          vehicle_dispatch_quantity_value: 5000,
          vehicle_dispatch_quantity_unit: 'LITER',
          portions: {
            create: [{ portion_number: 1, dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER' }],
          },
        },
      });

      testVisitB = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VISIT-4FE-B-${ts}`,
          vehicle_number: vehicleB,
          procurement_source_id: contImran.id,
          current_status: 'DISPATCHED',
          operational_date: new Date('2026-08-28T00:00:00.000Z'),
          vehicle_dispatch_quantity_value: 6000,
          vehicle_dispatch_quantity_unit: 'LITER',
          portions: {
            create: [{ portion_number: 1, dispatch_quantity_value: 6000, dispatch_quantity_unit: 'LITER' }],
          },
        },
      });

      testVisitZMCC = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VISIT-4FE-Z-${ts}`,
          vehicle_number: vehicleZMCC,
          procurement_source_id: zmccSource.id,
          current_status: 'DISPATCHED',
          operational_date: new Date('2026-08-28T00:00:00.000Z'),
          vehicle_dispatch_quantity_value: 7000,
          vehicle_dispatch_quantity_unit: 'LITER',
          portions: {
            create: [{ portion_number: 1, dispatch_quantity_value: 7000, dispatch_quantity_unit: 'LITER' }],
          },
        },
      });

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

      tempMisboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.misbound.4fe.${ts}`,
          full_name: 'Test Misbound 4FE Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: zmccSource.id,
          is_active: true,
        },
      });

      // C1: Assigned manager receives only their own records with positive proof
      const reqAssigned = await createAuthRequest(
        'http://localhost:3000/api/logs?dateBasis=reporting',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resAssigned = await getLogs(reqAssigned as any);
      assert(resAssigned.ok, 'TEST-C1.1: Assigned CONTRACTOR_MANAGER GET /api/logs?dateBasis=reporting returns HTTP 200');

      const jsonAssigned = await resAssigned.json();
      const logs = jsonAssigned.logs || [];
      assert(logs.length > 0, 'TEST-C1.2: Assigned CONTRACTOR_MANAGER receives positive record count (>0)', `Count: ${logs.length}`);
      assert(logs.some((l: any) => l.vehicle_number === vehicleA), 'TEST-C1.3: Assigned contractor fixture vehicleA IS present');
      assert(!logs.some((l: any) => l.vehicle_number === vehicleB), 'TEST-C1.4: Foreign contractor fixture vehicleB IS NOT present');
      assert(!logs.some((l: any) => l.vehicle_number === vehicleZMCC), 'TEST-C1.5: ZMCC fixture vehicleZMCC IS NOT present');
      assert(logs.every((l: any) => l.zonal_contractor_name === contAlkhair.name), 'TEST-C1.6: All returned records match assigned contractor name');

      // Verify records have final_receipt_business_date and reporting_business_date
      const finalizedLogs = logs.filter((l: any) => l.final_receipt_exists);
      const unfinalizedLogs = logs.filter((l: any) => !l.final_receipt_exists);

      const allFinalizedValid = finalizedLogs.every(
        (l: any) => !!l.final_receipt_business_date && l.reporting_business_date === l.final_receipt_business_date
      );
      assert(
        allFinalizedValid && finalizedLogs.length > 0,
        'TEST-C1.7: All finalized receipts have valid final_receipt_business_date equal to reporting_business_date',
        `Finalized count: ${finalizedLogs.length}`
      );

      const allUnfinalizedValid = unfinalizedLogs.every(
        (l: any) => (l.final_receipt_business_date === null || l.final_receipt_business_date === undefined) &&
                    l.reporting_business_date === l.dispatch_date
      );
      assert(
        allUnfinalizedValid && unfinalizedLogs.length > 0,
        'TEST-C1.8: All unfinalized visits have null final_receipt_business_date and reporting_business_date matches dispatch_date',
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

      // C3: Misbound CONTRACTOR_MANAGER (assigned to ZMCC) fails closed
      const reqMisbound = await createAuthRequest(
        'http://localhost:3000/api/logs?dateBasis=reporting',
        'GET',
        undefined,
        tempMisboundManager
      );
      const resMisbound = await getLogs(reqMisbound as any);
      const jsonMisbound = await resMisbound.json();
      assert(
        (jsonMisbound.logs || []).length === 0,
        'TEST-C3: Misbound CONTRACTOR_MANAGER (assigned to ZMCC) fails closed to 0 records',
        `Count: ${(jsonMisbound.logs || []).length}`
      );

      // C4: Legacy GET /api/logs without dateBasis succeeds
      const reqLegacy = await createAuthRequest(
        'http://localhost:3000/api/logs',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resLegacy = await getLogs(reqLegacy as any);
      assert(resLegacy.ok, 'TEST-C4: Legacy GET /api/logs without dateBasis succeeds with backward compatibility');
    }
  } finally {
    if (testVisitA || testVisitB || testVisitZMCC) {
      const visitIds = [testVisitA?.id, testVisitB?.id, testVisitZMCC?.id].filter(Boolean);
      await prisma.vehicleVisit.deleteMany({ where: { id: { in: visitIds } } }).catch(() => {});
    }
    if (tempAssignedManager) {
      await prisma.user.delete({ where: { id: tempAssignedManager.id } }).catch(() => {});
    }
    if (tempUnboundManager) {
      await prisma.user.delete({ where: { id: tempUnboundManager.id } }).catch(() => {});
    }
    if (tempMisboundManager) {
      await prisma.user.delete({ where: { id: tempMisboundManager.id } }).catch(() => {});
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
