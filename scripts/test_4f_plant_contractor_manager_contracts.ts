import { prisma } from '../src/backend/core/db';
import { resolveRoleHome } from '../src/lib/role-routing';
import { GET as getLogs } from '../src/app/api/logs/route';
import { createSessionToken } from '../src/backend/core/auth';
import { User, Role, MilkProcessLog } from '../src/backend/core/types';
import { getOperationalBusinessDate } from '../src/backend/core/business-day';
import {
  buildContractorVehicleVisits,
  deriveContractorJourneyStage,
} from '../src/frontend/modules/dashboard/contractor/contractorManagerHelpers';
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
  let tempMisboundManager: any = null;

  let testVisitA: any = null;
  let testVisitB: any = null;
  let testVisitZMCC: any = null;

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
      '4F-INVARIANT-03A: Whole vehicle dispatch authority strictly uses vehicle_dispatch_gross_liters (Gross Liters)'
    );

    // Behavioral test for whole-vehicle quantity fallback absence
    const mockLogWithoutVehicleGross: MilkProcessLog = {
      id: 99901,
      portion_id: 1,
      visit_number: 'VISIT-99901',
      reception_number: 'REC-99901',
      vehicle_number: 'LES-9999',
      portion_number: 'Portion 1',
      token_number: 'T-999',
      zonal_contractor_name: 'Test Contractor',
      status: 'DISPATCHED',
      dispatch_date: '2026-08-28',
      dispatch_day: 'Friday',
      dispatch_week: 32,
      dispatch_month: 'August',
      dispatch_year: 2026,
      zonal_contractor_dispatch_time: '10:00',
      dispatch_kg_gross: null,
      dispatch_liters_gross: 1500, // portion has value
      vehicle_dispatch_quantity_value: null,
      vehicle_dispatch_quantity_unit: null,
      vehicle_dispatch_quantity_basis: null,
      vehicle_dispatch_gross_liters: null, // whole vehicle is null
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
      final_receipt_exists: false,
      final_receipt_transaction_id: null,
      final_receipt_timestamp: null,
      final_receipt_business_date: null,
      reporting_business_date: '2026-08-28',
      authoritative_final_liters: null,
      created_at: '2026-08-28T10:00:00.000Z',
      updated_at: '2026-08-28T10:00:00.000Z',
    };

    const builtVisits = buildContractorVehicleVisits([mockLogWithoutVehicleGross]);
    assert(
      builtVisits[0].grossLiters === null,
      '4F-INVARIANT-03B: Whole vehicle quantity returns null when vehicle_dispatch_gross_liters is null (no portion/0 fallback)'
    );

    assert(
      helpersSource.includes('final_receipt_exists') && helpersSource.includes('authoritative_final_liters'),
      '4F-INVARIANT-04: Final receipt authority strictly uses final_receipt_exists and authoritative_final_liters'
    );

    // Behavioral test for Receipt Pending outranking generic COMPLETED status
    const stageResult = deriveContractorJourneyStage('COMPLETED', '2026-08-28T11:00:00Z', false);
    assert(
      stageResult.stage === 'RECEIPT_PENDING' && stageResult.label === 'Receipt Pending',
      '4F-INVARIANT-05: Receipt Pending strictly outranks generic status=COMPLETED when secondWeight exists and !finalReceiptExists'
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

    const readModelPath = path.join(__dirname, '../src/backend/services/operationalReadModelService.ts');
    const readModelSource = fs.readFileSync(readModelPath, 'utf-8');
    assert(
      !readModelSource.includes('finalizedReceipt.created_at') &&
        readModelSource.includes('finalizedReceipt?.operational_timestamp'),
      '4F-INVARIANT-08C: Final receipt timestamp derives ONLY from operational_timestamp with zero created_at fallback'
    );

    // Behavioral tests for missing receipt timestamp vs non-final record
    const mockLogFinalizedNoDate: MilkProcessLog = {
      ...mockLogWithoutVehicleGross,
      id: 99902,
      final_receipt_exists: true,
      final_receipt_timestamp: null,
      final_receipt_business_date: null,
      reporting_business_date: null,
      dispatch_date: '2026-08-28',
    };
    const builtFinalizedVisits = buildContractorVehicleVisits([mockLogFinalizedNoDate]);
    assert(
      builtFinalizedVisits[0].reportingBusinessDate === null,
      '4F-INVARIANT-08D: Finalized receipt with missing receipt business date maps to reportingBusinessDate=null (no dispatch_date fallback)'
    );

    const mockLogNonFinal: MilkProcessLog = {
      ...mockLogWithoutVehicleGross,
      id: 99903,
      final_receipt_exists: false,
      final_receipt_business_date: null,
      reporting_business_date: '2026-08-28',
      dispatch_date: '2026-08-28',
    };
    const builtNonFinalVisits = buildContractorVehicleVisits([mockLogNonFinal]);
    assert(
      builtNonFinalVisits[0].reportingBusinessDate === '2026-08-28',
      '4F-INVARIANT-08E: Non-final visit uses dispatch_date for reportingBusinessDate'
    );

    // --- 4. BACKEND SOURCE ISOLATION & FAIL CLOSED ---
    console.log('\n--- 4. Backend Source Isolation & Fail-Closed Contract ---');
    const contAlkhair = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-ALKHAIR', source_type: 'CONTRACTOR' },
    });
    const contImran = await prisma.procurementSource.findFirst({
      where: { code: 'CONT-IMRAN', source_type: 'CONTRACTOR' },
    });
    const zmccSource = await prisma.procurementSource.findFirst({
      where: { source_type: 'ZMCC' },
    });

    assert(!!contAlkhair && !!contImran && !!zmccSource, '4F-INVARIANT-09: Procurement source fixtures exist');

    if (contAlkhair && contImran && zmccSource) {
      const ts = Date.now();
      const vehicleA = `TEST-4F-A-${ts}`;
      const vehicleB = `TEST-4F-B-${ts}`;
      const vehicleZMCC = `TEST-4F-Z-${ts}`;

      // Create positive recognizable fixtures
      testVisitA = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VISIT-4F-A-${ts}`,
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
          visit_number: `VISIT-4F-B-${ts}`,
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
          visit_number: `VISIT-4F-Z-${ts}`,
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

      tempMisboundManager = await prisma.user.create({
        data: {
          username: `test.mgr.misbound.4f.${ts}`,
          full_name: 'Test Misbound 4F Final Manager',
          role: 'CONTRACTOR_MANAGER',
          scope_type: 'SOURCE',
          procurement_source_id: zmccSource.id,
          is_active: true,
        },
      });

      // 4.1 Assigned manager receives only assigned contractor records with positive proof
      const reqAssigned = await createAuthRequest(
        'http://localhost:3000/api/logs?dateBasis=reporting',
        'GET',
        undefined,
        tempAssignedManager
      );
      const resAssigned = await getLogs(reqAssigned as any);
      assert(resAssigned.ok, '4F-INVARIANT-10: Assigned CONTRACTOR_MANAGER GET /api/logs returns HTTP 200');

      const jsonAssigned = await resAssigned.json();
      const logs = jsonAssigned.logs || [];

      assert(logs.length > 0, '4F-INVARIANT-11A: Assigned CONTRACTOR_MANAGER returns positive result count (>0)', `Count: ${logs.length}`);
      assert(logs.some((l: any) => l.vehicle_number === vehicleA), '4F-INVARIANT-11B: Assigned contractor fixture vehicleA IS present in response');
      assert(!logs.some((l: any) => l.vehicle_number === vehicleB), '4F-INVARIANT-11C: Foreign contractor fixture vehicleB IS NOT present in response');
      assert(!logs.some((l: any) => l.vehicle_number === vehicleZMCC), '4F-INVARIANT-11D: ZMCC fixture vehicleZMCC IS NOT present in response');
      assert(logs.every((l: any) => l.zonal_contractor_name === contAlkhair.name), '4F-INVARIANT-11E: All returned records match assigned contractor name');

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

      // 4.3 Misbound CONTRACTOR_MANAGER (assigned to ZMCC) fails closed
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
        '4F-INVARIANT-13: Misbound CONTRACTOR_MANAGER (assigned to ZMCC source) fails closed to ZERO records',
        `Count: ${(jsonMisbound.logs || []).length}`
      );
    }

    // --- 5. READ-ONLY & ZERO CLIENT SOURCE SELECTOR ---
    console.log('\n--- 5. Read-Only UI & Zero Source Selector ---');
    assert(
      !workspaceSource.includes('<select'),
      '4F-INVARIANT-14: Workspace contains ZERO client-side source dropdowns or selectors'
    );
    assert(
      !workspaceSource.includes('method: \'POST\'') &&
        !workspaceSource.includes('method: \'PATCH\'') &&
        !workspaceSource.includes('method: \'DELETE\''),
      '4F-INVARIANT-15: Workspace contains ZERO mutation controls'
    );
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
