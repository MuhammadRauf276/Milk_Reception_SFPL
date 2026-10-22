import 'dotenv/config';
import type { LabTestRule, VehicleVisit } from '@prisma/client';
import { prisma } from '../src/backend/core/db';
import { QualityRuleService } from '../src/backend/services/qualityRuleService';
import { computeCanonicalMilkMetrics } from '../src/backend/utils/milkFormulas';
import {
  calculateVehicleReceivedQuantity,
  VehicleCalculationPortion,
} from '../src/backend/services/vehicleQuantityService';
import { calculateDualReconciliation } from '../src/backend/services/reconciliationService';
import { getOperationalBusinessDate, getPakistanCalendarDate } from '../src/backend/core/business-day';
import { parseStrictDateOnly } from '../src/lib/datetime-utils';
import { getTankPhysicalStock, getTankCommercialStock } from '../src/backend/services/zmccTankService';

export async function seedOperationalData() {
  console.log('==================================================');
  console.log('RUNNING OPERATIONAL DATA SEEDING (DEVELOPMENT ONLY)');
  console.log('==================================================\n');

  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL SAFETY ABORT: Cannot execute seed in PRODUCTION environment!');
    process.exit(1);
  }

  if ((process.env.ALLOW_DEMO_RESET || '').trim() !== 'true') {
    console.error('CRITICAL SAFETY ABORT: ALLOW_DEMO_RESET=true is required to execute seed!');
    process.exit(1);
  }

  // 1. Fetch Master Users & 5 Approved Procurement Sources
  const users = await prisma.user.findMany();
  const approvedSourceNames = [
    'ZMCC Hasilpur',
    'ZMCC Jhang',
    'ZMCC Kabirwala',
    'Al Mehmood Dairy',
    'Al Khair Dairy',
  ];
  const sources = await prisma.procurementSource.findMany({
    where: { name: { in: approvedSourceNames }, is_active: true },
    orderBy: { id: 'asc' },
  });

  if (sources.length === 0) {
    throw new Error('No active Procurement Sources found in database. Seed master data first.');
  }

  const mpdUser = users.find((u) => u.role === 'ZMCC_LAB_ATTENDANT' || u.role === 'CONTRACTOR_OPERATOR') || users[0];
  const gateUser = users.find((u) => u.role === 'SECURITY_OPERATOR') || users[0];
  const qaUser = users.find((u) => u.role === 'QA_LAB_ATTENDANT') || users[0];
  const weighUser = users.find((u) => u.role === 'WEIGHBRIDGE_OPERATOR') || users[0];
  const prodUser = users.find((u) => u.role === 'PRODUCTION_RECEPTION_OPERATOR') || users[0];

  // 2. Ensure 4 Standard Silos Exist
  const standardSilos = [
    { silo_code: 'SILO-01', silo_name: 'Raw Milk Storage Silo 01', capacity_liters: 200000, is_active: true },
    { silo_code: 'SILO-02', silo_name: 'Raw Milk Storage Silo 02', capacity_liters: 200000, is_active: true },
    { silo_code: 'SILO-03', silo_name: 'Raw Milk Storage Silo 03', capacity_liters: 200000, is_active: true },
    { silo_code: 'SILO-04', silo_name: 'Raw Milk Storage Silo 04', capacity_liters: 200000, is_active: true },
  ];

  for (const s of standardSilos) {
    await prisma.silo.upsert({
      where: { silo_code: s.silo_code },
      update: { is_active: true, capacity_liters: s.capacity_liters },
      create: s,
    });
  }

  // Set all active silos to 200,000 L capacity so accumulated receipts stay within capacity
  await prisma.silo.updateMany({
    where: { is_active: true },
    data: { capacity_liters: 200000 },
  });

  const activeSilos = await prisma.silo.findMany({ where: { is_active: true }, orderBy: { silo_code: 'asc' } });
  const activeTests = await prisma.labTest.findMany({ where: { isActive: true } });

  const superAdmin = users.find((u) => u.role === 'SUPER_ADMIN' && u.is_active) || users.find((u) => u.role === 'SUPER_ADMIN') || users[0];
  const qaHead = users.find((u) => u.role === 'QA_HEAD' && u.is_active) || superAdmin;

  // Seed Stage 6G-G Paper Reference Policies
  console.log('Seeding Stage 6G-G Paper Reference Policies...');
  const paperPolicies = [
    { reference_type: 'SHOP_RMR' as const, policy_mode: 'REQUIRED' as const, allow_duplicates: true, duplicate_scope: 'GLOBAL' },
    { reference_type: 'RAW_MILK_TOKEN' as const, policy_mode: 'REQUIRED' as const, allow_duplicates: false, duplicate_scope: 'PER_SOURCE' },
    { reference_type: 'RAW_MILK_DISPATCH_NOTE' as const, policy_mode: 'REQUIRED' as const, allow_duplicates: false, duplicate_scope: 'PER_SOURCE' },
  ];
  for (const p of paperPolicies) {
    await prisma.paperReferencePolicy.upsert({
      where: { reference_type: p.reference_type },
      update: {
        policy_mode: p.policy_mode,
        allow_duplicates: p.allow_duplicates,
        duplicate_scope: p.duplicate_scope,
        updated_by_user_id: superAdmin.id,
      },
      create: {
        reference_type: p.reference_type,
        policy_mode: p.policy_mode,
        allow_duplicates: p.allow_duplicates,
        duplicate_scope: p.duplicate_scope,
        updated_by_user_id: superAdmin.id,
      },
    });
  }

  // Seed Stage 6G-G Active SOP Lab Test Rules
  console.log('Seeding Stage 6G-G Active SOP Lab Test Rules...');
  const testFat = activeTests.find((t) => t.testName === 'Fat');
  const testLr = activeTests.find((t) => t.testName.includes('Lactometer') || t.testName.includes('LR'));
  const testTemp = activeTests.find((t) => t.testName === 'Temperature');
  const testAcidity = activeTests.find((t) => t.testName === 'Acidity');
  const testCob = activeTests.find((t) => t.testName === 'Clot on Boiling');
  const testSmell = activeTests.find((t) => t.testName === 'Organoleptic Smell');
  const testTaste = activeTests.find((t) => t.testName === 'Organoleptic Taste');
  const testBr = activeTests.find((t) => t.testName === 'BR Value');

  const ruleSpecs = [
    // PLANT_QA
    { test: testFat, point: 'PLANT_QA', min: 3.50, max: 5.50, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testLr, point: 'PLANT_QA', min: 26.00, max: 32.00, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testTemp, point: 'PLANT_QA', min: 0.00, max: 10.00, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testAcidity, point: 'PLANT_QA', min: 0.10, max: 0.16, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testCob, point: 'PLANT_QA', min: null, max: null, acceptable: 'NEGATIVE', consequence: 'REJECT', category: 'RELEASE' },
    { test: testSmell, point: 'PLANT_QA', min: null, max: null, acceptable: 'OK', consequence: 'REJECT', category: 'RELEASE' },
    { test: testTaste, point: 'PLANT_QA', min: null, max: null, acceptable: 'OK', consequence: 'REJECT', category: 'RELEASE' },
    { test: testBr, point: 'PLANT_QA', min: 39.00, max: 42.00, acceptable: null, consequence: 'NEUTRAL', category: 'MONITORING' },

    // ZMCC_LAB_MC
    { test: testFat, point: 'ZMCC_LAB_MC', min: 3.50, max: 5.50, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testLr, point: 'ZMCC_LAB_MC', min: 26.00, max: 32.00, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testTemp, point: 'ZMCC_LAB_MC', min: 0.00, max: 10.00, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testAcidity, point: 'ZMCC_LAB_MC', min: 0.10, max: 0.16, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testCob, point: 'ZMCC_LAB_MC', min: null, max: null, acceptable: 'NEGATIVE', consequence: 'REJECT', category: 'RELEASE' },

    // ZMCC_LAB_HC
    { test: testFat, point: 'ZMCC_LAB_HC', min: 3.50, max: 5.50, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testLr, point: 'ZMCC_LAB_HC', min: 26.00, max: 32.00, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testTemp, point: 'ZMCC_LAB_HC', min: 0.00, max: 10.00, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testAcidity, point: 'ZMCC_LAB_HC', min: 0.10, max: 0.16, acceptable: null, consequence: 'REJECT', category: 'RELEASE' },
    { test: testCob, point: 'ZMCC_LAB_HC', min: null, max: null, acceptable: 'NEGATIVE', consequence: 'REJECT', category: 'RELEASE' },

    // DISPATCH (MONITORING only pending release consequence workflow approval)
    { test: testFat, point: 'DISPATCH', min: 3.50, max: 5.50, acceptable: null, consequence: 'NEUTRAL', category: 'MONITORING' },
    { test: testLr, point: 'DISPATCH', min: 26.00, max: 32.00, acceptable: null, consequence: 'NEUTRAL', category: 'MONITORING' },
    { test: testTemp, point: 'DISPATCH', min: 0.00, max: 10.00, acceptable: null, consequence: 'NEUTRAL', category: 'MONITORING' },
    { test: testAcidity, point: 'DISPATCH', min: 0.10, max: 0.16, acceptable: null, consequence: 'NEUTRAL', category: 'MONITORING' },
  ];

  const plantRulesMap = new Map<string, LabTestRule>();
  const zmccMcRulesMap = new Map<string, LabTestRule>();
  const zmccHcRulesMap = new Map<string, LabTestRule>();
  const dispatchRulesMap = new Map<string, LabTestRule>();

  for (const spec of ruleSpecs) {
    if (!spec.test) continue;
    let existingRule = await prisma.labTestRule.findFirst({
      where: {
        lab_test_id: spec.test.id,
        testing_point: spec.point,
        is_active: true,
      },
    });

    if (!existingRule) {
      existingRule = await prisma.labTestRule.create({
        data: {
          lab_test_id: spec.test.id,
          testing_point: spec.point,
          version: 1,
          rule_category: spec.category,
          min_value: spec.min !== null ? spec.min : null,
          max_value: spec.max !== null ? spec.max : null,
          acceptable_option: spec.acceptable,
          decision_consequence: spec.consequence,
          is_active: true,
          created_by: qaHead.id,
        },
      });
    }

    if (spec.point === 'PLANT_QA') plantRulesMap.set(String(spec.test.id), existingRule);
    else if (spec.point === 'ZMCC_LAB_MC') zmccMcRulesMap.set(String(spec.test.id), existingRule);
    else if (spec.point === 'ZMCC_LAB_HC') zmccHcRulesMap.set(String(spec.test.id), existingRule);
    else if (spec.point === 'DISPATCH') dispatchRulesMap.set(String(spec.test.id), existingRule);
  }

  console.log(`Master references verified: ${users.length} Users, ${sources.length} Sources, ${activeSilos.length} Silos, ${activeTests.length} Lab Tests, ${paperPolicies.length} Paper Policies, ${ruleSpecs.length} SOP Rules.\n`);

  // Four deterministic plant journeys keep every operational screen useful
  // without hiding workflow problems inside a large volume of demo history.
  const TOTAL_VISITS = 4;
  const now = new Date();
  const msPerDay = 86400000;

  // Registration prefix patterns
  const vehiclePrefixes = ['KBL', 'LEA', 'LES', 'LHR', 'FSD'];

  // Data tracking counters
  let createdVisits = 0;
  let createdPortions = 0;
  let completedVisits = 0;
  let rejectedVisits = 0;
  let holdVisits = 0;
  let inProgressVisits = 0;
  let dispatchResultsCount = 0;
  let plantResultsCount = 0;
  let gateLogsCount = 0;
  let weightTicketsCount = 0;
  let unloadingLogsCount = 0;
  let finalReceiptsCount = 0;
  let qaEventsCount = 0;
  const sourceStats: Record<string, number> = {};
  let visit10Record: VehicleVisit | null = null;
  let visit20Record: VehicleVisit | null = null;

  console.log('Seeding 4 realistic, deterministic vehicle journeys...\n');

  for (let i = 1; i <= TOTAL_VISITS; i++) {
    // Determine category
    let category: string;
    let targetStatus: string;

    if (i === 1) {
      category = 'ACCEPTED';
      targetStatus = 'COMPLETED';
    } else if (i === 2) {
      category = 'REJECTED';
      targetStatus = 'COMPLETED';
    } else if (i === 3) {
      category = 'IN_PROGRESS';
      targetStatus = 'PLANT_QA';
    } else {
      category = 'IN_PROGRESS';
      targetStatus = 'READY_FOR_GROSS';
    }

    // Determine operational timestamp & business date boundaries
    // Spread evenly across last 28 days with deliberate boundary hours (at least 1 day ago to prevent future timestamps)
    const daysAgo = 1 + Math.floor((TOTAL_VISITS - i) * (27 / TOTAL_VISITS));
    const baseDate = new Date(now.getTime() - daysAgo * msPerDay);

    // Boundary hour distribution: 07:40, 07:59, 08:00, 08:15, 14:30, 22:15
    const hourPattern = [7, 7, 8, 8, 14, 22][i % 6];
    const minPattern = [40, 59, 0, 15, 30, 15][i % 6];
    baseDate.setHours(hourPattern, minPattern, 12, 0);

    const dispatchTime = new Date(baseDate.getTime());
    const gateEntryTime = new Date(dispatchTime.getTime() + (15 + (i % 20)) * 60000);
    const qaStartTime = new Date(gateEntryTime.getTime() + (10 + (i % 15)) * 60000);
    const qaHoldTime = new Date(qaStartTime.getTime() + 15 * 60000);
    const qaResumeTime = new Date(qaHoldTime.getTime() + 25 * 60000);
    const qaCompleteTime = new Date(
      category.includes('HOLD') ? qaResumeTime.getTime() + 15 * 60000 : qaStartTime.getTime() + (20 + (i % 15)) * 60000
    );
    const grossTime = new Date(qaCompleteTime.getTime() + (15 + (i % 10)) * 60000);
    const unloadingStartTime = new Date(grossTime.getTime() + (20 + (i % 15)) * 60000);
    const unloadingCompleteTime = new Date(unloadingStartTime.getTime() + (40 + (i % 20)) * 60000);
    const tareTime = new Date(unloadingCompleteTime.getTime() + (15 + (i % 10)) * 60000);
    const gateExitTime = category === 'REJECTED' || category === 'HOLD_REJECT'
      ? new Date(qaCompleteTime.getTime() + 20 * 60000)
      : new Date(tareTime.getTime() + (10 + (i % 10)) * 60000);

    // Assigned Procurement Source
    // Keep the active QA journey at ZMCC Hasilpur for the live management view.
    let sourceObj = i === 3
      ? (sources.find((s) => s.code === 'ZMCC-HASILPUR') || sources[(i - 1) % sources.length])
      : sources[(i - 1) % sources.length];

    // Scenario ZMCC-KG: Visit 10 / ZMCC source (bound to ZMCC Hasilpur)
    if (i === 10) {
      sourceObj = sources.find((s) => s.code === 'ZMCC-HASILPUR') || sources.find((s) => s.source_type === 'ZMCC') || sourceObj;
    }
    // Scenario A: Visit 20 / ZMCC source (bound to ZMCC Hasilpur)
    if (i === 20) {
      sourceObj = sources.find((s) => s.code === 'ZMCC-HASILPUR') || sources.find((s) => s.source_type === 'ZMCC') || sourceObj;
    }
    // Scenario C: Visit 40 / Contractor source
    if (i === 40) {
      sourceObj = sources.find((s) => s.source_type === 'CONTRACTOR') || sourceObj;
    }
    sourceStats[sourceObj.name] = (sourceStats[sourceObj.name] || 0) + 1;

    // Vehicle details
    const prefix = vehiclePrefixes[i % vehiclePrefixes.length];
    const vehicleNum = `${prefix}-${String(1000 + i).padStart(4, '0')}`;
    const dateStr = dispatchTime.toISOString().split('T')[0];
    const visitSeq = String(i).padStart(4, '0');
    const visitNumber = `VV-${dateStr.replace(/-/g, '')}-${visitSeq}`;
    const receptionNumber = `MRN-${dateStr.slice(2).replace(/-/g, '')}-${visitSeq}`;
    const tokenNumber = `TK-${String(1000 + i)}`;

    // Portion count & quantities (Vehicle 10, 20, 30, 40, 50 have 2 portions)
    const hasTwoPortions = i % 10 === 0;
    let totalDeclaredKg = 7000 + ((i * 350) % 7500); // 7,000 to 14,500 kg
    let vehicleQtyUnit: 'KG' | 'LITER' = 'KG';
    const vehicleQtyBasis = 'MEASURED' as const;

    let portion1Qty = hasTwoPortions ? Math.round(totalDeclaredKg / 2) : totalDeclaredKg;
    let portion2Qty = hasTwoPortions ? Math.round(totalDeclaredKg / 2) : 0;
    let portionUnit: 'KG' | 'LITER' = 'KG';
    let portionBasis: 'MEASURED' | 'ESTIMATED' = 'MEASURED';

    if (i === 10) {
      // Scenario ZMCC-KG: ZMCC Hasilpur, 10,000 KG MEASURED vehicle issue vs 2 ESTIMATED portions (5,000 KG + 4,800 KG = 9,800 KG, diff = +200 KG)
      // Authoritative LR = 28.00 -> Density = 1.0280 -> Converted Gross Liters = 9,727.63 L
      totalDeclaredKg = 10000;
      vehicleQtyUnit = 'KG';
      portion1Qty = 5000;
      portion2Qty = 4800;
      portionUnit = 'KG';
      portionBasis = 'ESTIMATED';
    } else if (i === 20) {
      // Scenario A: ZMCC source, 8,000 L MEASURED vehicle issue vs 2 ESTIMATED portions (4,000 L + 3,850 L = 7,850 L, diff = +150 L)
      totalDeclaredKg = 8000;
      vehicleQtyUnit = 'LITER';
      portion1Qty = 4000;
      portion2Qty = 3850;
      portionUnit = 'LITER';
      portionBasis = 'ESTIMATED';
    } else if (i === 30) {
      // Scenario B: 9,000 L MEASURED vehicle issue vs 2 MEASURED portions (4,500 L + 4,500 L = 9,000 L, diff = 0)
      totalDeclaredKg = 9000;
      vehicleQtyUnit = 'LITER';
      portion1Qty = 4500;
      portion2Qty = 4500;
      portionUnit = 'LITER';
      portionBasis = 'MEASURED';
    } else if (i === 40) {
      // Scenario C: Contractor source, 10,000 L MEASURED vehicle issue vs 2 ESTIMATED portions (5,100 L + 4,800 L = 9,900 L, diff = +100 L)
      totalDeclaredKg = 10000;
      vehicleQtyUnit = 'LITER';
      portion1Qty = 5100;
      portion2Qty = 4800;
      portionUnit = 'LITER';
      portionBasis = 'ESTIMATED';
    }

    // Authoritative Plant Business Date: strictly assigned upon Plant Gate Exit completion; in-progress visits remain null
    const plantBusinessDate = targetStatus === 'COMPLETED'
      ? parseStrictDateOnly(getOperationalBusinessDate(gateExitTime))
      : null;

    const demoLr = 28.00;
    const demoFat = 3.80;
    const vMetrics = computeCanonicalMilkMetrics(totalDeclaredKg, vehicleQtyUnit, demoLr, demoFat);
    const vehicleDispatchLr = demoLr;
    const vehicleDispatchFat = demoFat;
    const vehicleDispatchDensity = vMetrics.density;
    const vehicleDispatchGrossLiters = vMetrics.grossLiters;
    const vehicleDispatchSnf = vMetrics.snf;
    let vehicleDispatchTs: number | null = vMetrics.ts;
    let vehicleDispatchAt13ts: number | null = vMetrics.at13tsLiters;
    if (i === 7) {
      // Scenario: Missing source commercial @13TS record (source lab TS missing/incomplete)
      vehicleDispatchTs = null;
      vehicleDispatchAt13ts = null;
    }
    const vehicleDispatchVersion = vMetrics.calculationVersion;

    // Create VehicleVisit
    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: visitNumber,
        reception_number: receptionNumber,
        vehicle_number: vehicleNum,
        token_number: tokenNumber,
        operational_date: plantBusinessDate,
        current_status: targetStatus,
        created_by: mpdUser.id,
        procurement_source_id: sourceObj.id,
        vehicle_dispatch_quantity_value: totalDeclaredKg,
        vehicle_dispatch_quantity_unit: vehicleQtyUnit,
        vehicle_dispatch_quantity_basis: vehicleQtyBasis,
        vehicle_dispatch_lr: vehicleDispatchLr,
        vehicle_dispatch_fat: vehicleDispatchFat,
        vehicle_dispatch_density: vehicleDispatchDensity,
        vehicle_dispatch_gross_liters: vehicleDispatchGrossLiters,
        vehicle_dispatch_snf: vehicleDispatchSnf,
        vehicle_dispatch_ts: vehicleDispatchTs,
        vehicle_dispatch_at_13ts_liters: vehicleDispatchAt13ts,
        vehicle_dispatch_calculation_version: vehicleDispatchVersion,
        raw_milk_dispatch_note_number: String(8100 + i).padStart(6, '0'),
        created_at: dispatchTime,
        updated_at: targetStatus === 'COMPLETED' ? gateExitTime : qaCompleteTime,
      },
    });

    createdVisits++;
    if (i === 10) {
      visit10Record = visit;
    }
    if (i === 20) {
      visit20Record = visit;
    }

    // Create Portions & Dispatch Info
    const portionCount = hasTwoPortions ? 2 : 1;
    for (let pIdx = 1; pIdx <= portionCount; pIdx++) {
      const portionVal = pIdx === 1 ? portion1Qty : portion2Qty;

      // Portion decision
      let portionDecision = 'ACCEPTED';
      if (category === 'REJECTED' || category === 'HOLD_REJECT') {
        portionDecision = 'REJECTED';
      } else if (hasTwoPortions && pIdx === 2 && category === 'ACCEPTED') {
        portionDecision = 'REJECTED'; // Mixed portion test case
      }

      const portionStatus = targetStatus === 'COMPLETED'
        ? (portionDecision === 'REJECTED' ? 'REJECTED' : 'UNLOADED')
        : (targetStatus === 'PLANT_QA' ? 'UNDER_TEST' : targetStatus);

      // QA Manager review scenario on the active QA journey.
      const isVisit74ManagerReview = i === 3 && pIdx === 1;

      const portion = await prisma.visitPortion.create({
        data: {
          visit_id: visit.id,
          portion_number: pIdx,
          dispatch_quantity_value: portionVal,
          dispatch_quantity_unit: portionUnit,
          dispatch_quantity_basis: portionBasis,
          current_status: portionStatus,
          plant_decision: targetStatus === 'TOKEN_ISSUED' || targetStatus === 'PLANT_QA' ? 'PENDING' : portionDecision,
          plant_rejection_reason: portionDecision === 'REJECTED' ? 'COB Positive & High Acidity. Off-flavor detected during organoleptic testing.' : null,
          plant_decided_by: targetStatus === 'TOKEN_ISSUED' || targetStatus === 'PLANT_QA' ? null : qaUser.id,
          plant_decided_at: targetStatus === 'TOKEN_ISSUED' || targetStatus === 'PLANT_QA' ? null : qaCompleteTime,
          system_quality_outcome: isVisit74ManagerReview ? 'OUT_OF_SPEC' : (portionDecision === 'REJECTED' ? 'OUT_OF_SPEC' : (targetStatus === 'TOKEN_ISSUED' ? null : 'PASS')),
          manager_review_status: isVisit74ManagerReview ? 'PENDING' : 'NONE',
          manager_requested_decision: isVisit74ManagerReview ? 'ACCEPT' : null,
          manager_review_requested_by_user_id: isVisit74ManagerReview ? qaUser.id : null,
          manager_review_requested_at: isVisit74ManagerReview ? qaStartTime : null,
          manager_review_reason: isVisit74ManagerReview ? 'Fat 3.40% slightly below 3.50% specification. Requesting QA Manager exception waiver based on supplier reliability.' : null,
          created_at: dispatchTime,
        },
      });

      createdPortions++;

      // DispatchInfo
      await prisma.dispatchInfo.create({
        data: {
          portion_id: portion.id,
          dispatch_timestamp: dispatchTime,
          recorded_by: mpdUser.id,
          created_at: new Date(dispatchTime.getTime() + 120000), // 2 min delay
        },
      });

      // Dispatch Lab Results
      const fatVal = 3.6 + ((i + pIdx) % 10) * 0.1; // 3.6 - 4.5%
      const lrVal = i === 10 ? 28.0 : 27.5 + ((i + pIdx) % 8) * 0.2; // 27.5 - 29.0
      const tempVal = 4.0 + (i % 4) * 0.5;
      const acidVal = 0.12 + (i % 3) * 0.01;

      for (const t of activeTests) {
        if (t.testScope === 'DISPATCH' || t.testScope === 'BOTH') {
          let numVal: number | null = null;
          let textVal: string | null = null;
          const isPassed = true;

          if (t.testName === 'Fat') numVal = fatVal;
          else if (t.testName.includes('Lactometer') || t.testName.includes('LR')) numVal = lrVal;
          else if (t.testName === 'Temperature') numVal = tempVal;
          else if (t.testName === 'Acidity') numVal = acidVal;
          else if (t.testName === 'pH at 20 Celsius') numVal = 6.65;
          else if (t.resultType === 'OK_NOT_OK') textVal = 'OK';
          else if (t.resultType === 'POSITIVE_NEGATIVE') textVal = 'NEGATIVE';
          else if (t.resultType === 'NUMERIC') numVal = 10.0;

          if (t.resultType !== 'CALCULATED') {
            const ruleForTest = dispatchRulesMap.get(String(t.id));
            const evaluation = QualityRuleService.evaluateQualityResult({
              testId: t.id,
              testCode: t.testCode,
              resultType: t.resultType,
              numericValue: numVal,
              textValue: textVal,
              rule: ruleForTest || null,
              resultOptions: t.resultOptions,
              testingPoint: 'DISPATCH',
            });

            await prisma.dispatchLabResult.create({
              data: {
                visit_id: visit.id,
                portion_id: portion.id,
                test_id: t.id,
                sample_timestamp: dispatchTime,
                result_timestamp: dispatchTime,
                numeric_value: numVal,
                text_value: textVal,
                is_passed: evaluation.isPassed !== null ? evaluation.isPassed : isPassed,
                tested_by: mpdUser.id,
                created_at: new Date(dispatchTime.getTime() + 180000),
              },
            });
            dispatchResultsCount++;
          }
        }
      }

      // Plant Lab Results (for processed visits)
      if (targetStatus !== 'TOKEN_ISSUED') {
        const isPlantReject = portionDecision === 'REJECTED';
        const isVisit74 = i === 3;
        const plantFat = isVisit74 ? 3.40 : (isPlantReject ? 2.5 : fatVal);
        const plantLr = isPlantReject ? 24.0 : lrVal;

        for (const t of activeTests) {
          if (t.testScope === 'PLANT' || t.testScope === 'BOTH') {
            let numVal: number | null = null;
            let textVal: string | null = null;

            if (t.testName === 'Fat') numVal = plantFat;
            else if (t.testName.includes('Lactometer') || t.testName.includes('LR')) numVal = plantLr;
            else if (t.testName === 'Temperature') numVal = tempVal;
            else if (t.testName === 'Acidity') numVal = isPlantReject ? 0.19 : acidVal;
            else if (t.testName === 'Clot on Boiling') {
              textVal = isPlantReject ? 'POSITIVE' : 'NEGATIVE';
            } else if (t.resultType === 'OK_NOT_OK') textVal = isPlantReject ? 'NOT_OK' : 'OK';
            else if (t.resultType === 'POSITIVE_NEGATIVE') textVal = 'NEGATIVE';
            else if (t.testName === 'BR Value') numVal = 40.0;
            else if (t.resultType === 'NUMERIC') numVal = 10.0;

            if (t.resultType !== 'CALCULATED') {
              const ruleForTest = plantRulesMap.get(String(t.id));
              const evaluation = QualityRuleService.evaluateQualityResult({
                testId: t.id,
                testCode: t.testCode,
                resultType: t.resultType,
                numericValue: numVal,
                textValue: textVal,
                rule: ruleForTest || null,
                resultOptions: t.resultOptions,
                testingPoint: 'PLANT_QA',
              });

              await prisma.plantLabResult.create({
                data: {
                  visit_id: visit.id,
                  portion_id: portion.id,
                  test_id: t.id,
                  sample_timestamp: qaStartTime,
                  result_timestamp: qaCompleteTime,
                  numeric_value: numVal,
                  text_value: textVal,
                  is_passed: evaluation.isPassed,
                  applied_rule_id: evaluation.appliedRuleId,
                  applied_rule_version: evaluation.appliedRuleVersion,
                  evaluation_status: evaluation.evaluationStatus,
                  tested_by: qaUser.id,
                  created_at: new Date(qaCompleteTime.getTime() + 300000),
                },
              });
              plantResultsCount++;
            }
          }
        }
      }
    }

    // Gate Entry
    if (targetStatus !== 'DISPATCHED') {
      await prisma.gateLog.create({
        data: {
          visit_id: visit.id,
          entry_timestamp: gateEntryTime,
          entry_guard_id: gateUser.id,
          entry_submitted_at: new Date(gateEntryTime.getTime() + 300000), // 5 min delay
          exit_timestamp: targetStatus === 'COMPLETED' ? gateExitTime : null,
          exit_guard_id: targetStatus === 'COMPLETED' ? gateUser.id : null,
          exit_submitted_at: targetStatus === 'COMPLETED' ? new Date(gateExitTime.getTime() + 180000) : null,
          created_at: gateEntryTime,
        },
      });
      gateLogsCount++;
    }

    // QA Session & Events
    if (targetStatus !== 'TOKEN_ISSUED') {
      const qaSession = await prisma.qATestingSession.create({
        data: {
          visit_id: visit.id,
          started_by: qaUser.id,
          started_at: qaStartTime,
          completed_by: targetStatus !== 'PLANT_QA' ? qaUser.id : null,
          completed_at: targetStatus !== 'PLANT_QA' ? qaCompleteTime : null,
          status: targetStatus === 'PLANT_QA' ? 'IN_PROGRESS' : 'COMPLETED',
          created_at: qaStartTime,
        },
      });

      // START Event
      await prisma.qATestingSessionEvent.create({
        data: {
          session_id: qaSession.id,
          event_type: 'START',
          timestamp: qaStartTime,
          user_id: qaUser.id,
          note: 'Session started by QA Chemist',
          created_at: new Date(qaStartTime.getTime() + 120000),
        },
      });
      qaEventsCount++;

      // HOLD & RESUME Events (if applicable)
      if (category.includes('HOLD')) {
        await prisma.qATestingSessionEvent.create({
          data: {
            session_id: qaSession.id,
            event_type: 'HOLD',
            timestamp: qaHoldTime,
            user_id: qaUser.id,
            note: 'Portion on Hold for lab verification',
            created_at: new Date(qaHoldTime.getTime() + 240000), // 4 min submission delay
          },
        });
        qaEventsCount++;

        await prisma.qATestingSessionEvent.create({
          data: {
            session_id: qaSession.id,
            event_type: 'RESUME',
            timestamp: qaResumeTime,
            user_id: qaUser.id,
            note: 'QA testing session resumed',
            created_at: new Date(qaResumeTime.getTime() + 180000),
          },
        });
        qaEventsCount++;
      }

      // DECISION & COMPLETE Events
      if (targetStatus !== 'PLANT_QA') {
        const isRejectedJourney = category === 'REJECTED' || category === 'HOLD_REJECT';
        await prisma.qATestingSessionEvent.create({
          data: {
            session_id: qaSession.id,
            event_type: isRejectedJourney ? 'PORTION_REJECTED' : 'PORTION_ACCEPTED',
            timestamp: qaCompleteTime,
            user_id: qaUser.id,
            note: `Portion decision: ${isRejectedJourney ? 'REJECTED' : 'ACCEPTED'}`,
            created_at: new Date(qaCompleteTime.getTime() + 150000),
          },
        });
        qaEventsCount++;

        await prisma.qATestingSessionEvent.create({
          data: {
            session_id: qaSession.id,
            event_type: 'COMPLETE',
            timestamp: qaCompleteTime,
            user_id: qaUser.id,
            note: `QA session completed with status ${targetStatus}`,
            created_at: new Date(qaCompleteTime.getTime() + 180000),
          },
        });
        qaEventsCount++;
      }
    }

    // Weight Ticket, Unloading Log, Silo Receipt (Only for accepted workflows past QA)
    const isAcceptedWorkflow = category === 'ACCEPTED' || category === 'HOLD_ACCEPT';
    const isPastQA = targetStatus === 'READY_FOR_GROSS' || targetStatus === 'TARE_WEIGHED' || targetStatus === 'COMPLETED';

    if (isAcceptedWorkflow && isPastQA) {
      let netKg = totalDeclaredKg;
      if (i === 10) {
        // ZMCC Visit 10: Net KG adjusted for positive volumetric variance (+145.91 L gain)
        netKg = 10150;
      } else if (i === 20) {
        // ZMCC Visit 20: Net KG adjusted for negative volumetric variance (-169.26 L loss)
        netKg = 8050;
      }
      const tareKg = 14500;
      const grossKg = Math.round(netKg + tareKg);
      const isTareRecorded = targetStatus === 'COMPLETED' || targetStatus === 'TARE_WEIGHED';

      // Weight Ticket
      await prisma.weightTicket.create({
        data: {
          visit_id: visit.id,
          ticket_number: `WT-${tokenNumber}`,
          gross_weight_kg: grossKg,
          gross_timestamp: grossTime,
          gross_recorded_by: weighUser.id,
          gross_submitted_at: new Date(grossTime.getTime() + 240000),
          tare_weight_kg: isTareRecorded ? tareKg : null,
          tare_timestamp: isTareRecorded ? tareTime : null,
          tare_recorded_by: isTareRecorded ? weighUser.id : null,
          tare_submitted_at: isTareRecorded ? new Date(tareTime.getTime() + 300000) : null,
          net_weight_kg: isTareRecorded ? netKg : null,
          created_at: grossTime,
        },
      });
      weightTicketsCount++;

      // Unloading Log & Silo Receipt for Completed Accepted Visits
      if (isTareRecorded) {
        const visitPortionsWithLab = await prisma.visitPortion.findMany({
          where: { visit_id: visit.id },
          include: {
            plant_lab_results: {
              include: { lab_test: true },
            },
          },
          orderBy: { portion_number: 'asc' },
        });
        const targetSilo = activeSilos[(i - 1) % activeSilos.length];

        for (const p of visitPortionsWithLab) {
          if (p.plant_decision === 'ACCEPTED') {
            await prisma.unloadingLog.create({
              data: {
                portion_id: p.id,
                silo_id: targetSilo.id,
                silo_number: targetSilo.silo_code,
                pump_start_timestamp: unloadingStartTime,
                start_submitted_at: new Date(unloadingStartTime.getTime() + 180000),
                pump_end_timestamp: unloadingCompleteTime,
                complete_submitted_at: new Date(unloadingCompleteTime.getTime() + 240000),
                started_by: prodUser.id,
                completed_by: prodUser.id,
                created_at: unloadingStartTime,
              },
            });
            unloadingLogsCount++;
          }
        }

        if (targetStatus === 'COMPLETED') {
          // Authoritative calculation using the production calculateVehicleReceivedQuantity service
          const calcPortions: VehicleCalculationPortion[] = visitPortionsWithLab.map((p) => ({
            portionId: p.id,
            portionNumber: p.portion_number,
            plantDecision: p.plant_decision,
            plantLabResults: p.plant_lab_results.map((r) => ({
              testCode: r.lab_test?.testCode,
              testName: r.lab_test?.testName,
              numericValue: r.numeric_value ? Number(r.numeric_value) : null,
              performanceStatus: r.performance_status,
            })),
          }));

          const calcResult = calculateVehicleReceivedQuantity({
            grossWeightKg: grossKg,
            secondWeightKg: tareKg,
            portions: calcPortions,
          });

          // Exactly ONE Vehicle-Level Final Silo Receipt for eligible accepted visits
          const acceptedPortions = visitPortionsWithLab.filter((p) => p.plant_decision === 'ACCEPTED');
          if (acceptedPortions.length > 0 && calcResult.isCalculable && calcResult.finalPhysicalLiters !== null) {
            const isHistoricalPre6gfReceipt = (i === 4 || i === 5);

            const siloTx = await prisma.siloInventoryTransaction.create({
              data: {
                silo_id: targetSilo.id,
                visit_id: visit.id,
                portion_id: acceptedPortions.length === 1 ? acceptedPortions[0].id : null,
                transaction_type: 'RECEIPT',
                quantity_kg: netKg,
                quantity_liters: calcResult.finalPhysicalLiters,
                plant_composite_lr: isHistoricalPre6gfReceipt ? null : calcResult.plantCompositeLR,
                plant_composite_fat: isHistoricalPre6gfReceipt ? null : calcResult.plantCompositeFat,
                plant_density: isHistoricalPre6gfReceipt ? null : calcResult.plantDensity,
                plant_snf: isHistoricalPre6gfReceipt ? null : calcResult.plantSNF,
                plant_ts: isHistoricalPre6gfReceipt ? null : calcResult.plantTS,
                plant_final_at_13ts_liters: isHistoricalPre6gfReceipt ? null : calcResult.finalAt13TSLiters,
                plant_calculation_version: isHistoricalPre6gfReceipt ? null : calcResult.plantCalculationVersion,
                operational_timestamp: tareTime,
                performed_by: weighUser.id,
                idempotency_key: `FINAL_RECEIPT:VISIT:${visit.id}`,
                created_at: new Date(tareTime.getTime() + 120000),
              },
            });
            finalReceiptsCount++;

            if (!isHistoricalPre6gfReceipt && calcResult.finalAt13TSLiters !== null) {
              const dualRecon = calculateDualReconciliation({
                sentGrossLiters: visit.vehicle_dispatch_gross_liters ? Number(visit.vehicle_dispatch_gross_liters) : null,
                receivedGrossLiters: calcResult.finalPhysicalLiters,
                sentAt13tsLiters: visit.vehicle_dispatch_at_13ts_liters ? Number(visit.vehicle_dispatch_at_13ts_liters) : null,
                receivedAt13tsLiters: calcResult.finalAt13TSLiters,
              });

              await prisma.plantFinalDualReconciliation.create({
                data: {
                  visit_id: visit.id,
                  final_receipt_transaction_id: siloTx.id,
                  sent_gross_liters: dualRecon.sentGrossLiters,
                  received_gross_liters: dualRecon.receivedGrossLiters,
                  gross_variance_liters: dualRecon.grossVarianceLiters,
                  gross_variance_percent: dualRecon.grossVariancePercent,
                  sent_at_13ts_liters: dualRecon.sentAt13tsLiters,
                  received_at_13ts_liters: dualRecon.receivedAt13tsLiters,
                  at_13ts_variance_liters: dualRecon.at13tsVarianceLiters,
                  at_13ts_variance_percent: dualRecon.at13tsVariancePercent,
                  reconciliation_calculation_version: dualRecon.reconciliationCalculationVersion,
                  reconciled_at: tareTime,
                  created_at: new Date(tareTime.getTime() + 120000),
                },
              });
            }
          }
        }
      }
    }

    if (targetStatus === 'COMPLETED') completedVisits++;
    else inProgressVisits++;

    if (category === 'REJECTED' || category === 'HOLD_REJECT') rejectedVisits++;
    if (category.includes('HOLD')) holdVisits++;
  }

  // =========================================================================
  // 3. SEED DETERMINISTIC D4B ZMCC DEMO DATASET (ZMCC HASILPUR)
  // =========================================================================
  console.log('Seeding compact deterministic D4B ZMCC demo dataset for Hasilpur...\n');

  // Fetch canonical Hasilpur users and source
  const hasilpurSource = await prisma.procurementSource.findUnique({
    where: { code: 'ZMCC-HASILPUR' },
  });
  if (!hasilpurSource) {
    throw new Error('ZMCC-HASILPUR procurement source not found. Run prisma/seed.ts first.');
  }

  const zmccManager = await prisma.user.findFirst({
    where: { username: 'zmcc.manager.north', is_active: true },
  });
  const pheUser = await prisma.user.findFirst({
    where: { username: 'phe.operator', is_active: true },
  });
  const zmccLabUser = await prisma.user.findFirst({
    where: { username: 'zmcc.operator', is_active: true },
  });

  if (!zmccManager || !pheUser || !zmccLabUser) {
    throw new Error('Canonical ZMCC users (zmcc.manager.north, phe.operator, zmcc.operator) not found.');
  }

  // Ensure single active ZMCC tank for Hasilpur (D1 invariant: exactly one active tank per ZMCC)
  let hasilpurTank = await prisma.zmccTank.findFirst({
    where: { zmcc_id: hasilpurSource.id, is_active: true },
  });
  if (!hasilpurTank) {
    hasilpurTank = await prisma.zmccTank.create({
      data: {
        zmcc_id: hasilpurSource.id,
        tank_code: 'TK-HAS-01',
        tank_name: 'Hasilpur Raw Milk Storage Tank 01',
        capacity_liters: 50000,
        is_active: true,
        created_by_user_id: zmccManager.id,
      },
    });
  }

  // Canonical Tank Stock Seeding for ZMCC Hasilpur:
  // Scenario ZMCC-KG (Visit 10): 10,000 KG @ LR 28.00 -> 9,727.63 Gross Liters ISSUE
  // Scenario A (Visit 20): 8,000 L Measured -> 8,000.00 Gross Liters ISSUE
  // Seed opening stock receipt (35,000 L) before the earliest visit dispatch,
  // followed by canonical whole-vehicle tank ISSUEs in Gross Liters.
  const earliestDispatchRecord = visit10Record ?? visit20Record;
  if (earliestDispatchRecord) {
    const openingStockLiters = 35000.0;
    const openingMetrics = computeCanonicalMilkMetrics(openingStockLiters, 'LITER', 28.00, 3.80);
    const earliestDate = earliestDispatchRecord.created_at;
    const openingTimestamp = new Date(earliestDate.getTime() - 3600000); // 1 hr before earliest dispatch

    await prisma.zmccTankInventoryTransaction.upsert({
      where: { idempotency_key: `ZMCC_TANK_RECEIPT:OPENING_STOCK:${hasilpurSource.id}` },
      update: {
        quantity_liters: openingStockLiters,
        at_13ts_liters: openingMetrics.at13tsLiters,
        operational_timestamp: openingTimestamp,
      },
      create: {
        tank_id: hasilpurTank.id,
        zmcc_id: hasilpurSource.id,
        transaction_type: 'RECEIPT',
        quantity_liters: openingStockLiters,
        at_13ts_liters: openingMetrics.at13tsLiters, // 33,266.15 L
        reference_type: 'OPENING_STOCK',
        reference_id: `INIT-${hasilpurSource.id}`,
        idempotency_key: `ZMCC_TANK_RECEIPT:OPENING_STOCK:${hasilpurSource.id}`,
        operational_timestamp: openingTimestamp,
        performed_by_user_id: zmccManager.id,
        notes: 'Initial opening stock receipt for Hasilpur storage tank [35,000 L @ LR 28.00, Fat 3.80 -> 33,266.15 @13TS L]',
      },
    });

    if (visit10Record) {
      // Visit 10: 10,000 KG measured -> 9,727.63 Gross Liters, 9,245.73 @13TS L
      await prisma.zmccTankInventoryTransaction.create({
        data: {
          tank_id: hasilpurTank.id,
          zmcc_id: hasilpurSource.id,
          transaction_type: 'ISSUE',
          quantity_liters: Number(visit10Record.vehicle_dispatch_gross_liters), // 9727.63 Gross Liters
          at_13ts_liters: Number(visit10Record.vehicle_dispatch_at_13ts_liters), // 9245.73 @13TS L
          dispatch_id: visit10Record.id,
          reference_type: 'DISPATCH',
          reference_id: visit10Record.id.toString(),
          idempotency_key: `ZMCC_TANK_ISSUE:DISPATCH:${visit10Record.id}`,
          operational_timestamp: visit10Record.created_at,
          performed_by_user_id: zmccLabUser.id,
          notes: `Whole-vehicle dispatch issue for visit ${visit10Record.visit_number} (${visit10Record.vehicle_number}) [10,000 KG @ LR 28.00, Fat 3.80 -> 9,727.63 Gross L, 9,245.73 @13TS L]`,
        },
      });
    }

    if (visit20Record) {
      // Visit 20: 8,000 L measured -> 8,000.00 Gross Liters, 7,603.69 @13TS L
      await prisma.zmccTankInventoryTransaction.create({
        data: {
          tank_id: hasilpurTank.id,
          zmcc_id: hasilpurSource.id,
          transaction_type: 'ISSUE',
          quantity_liters: Number(visit20Record.vehicle_dispatch_gross_liters), // 8000.00 Gross Liters
          at_13ts_liters: Number(visit20Record.vehicle_dispatch_at_13ts_liters), // 7603.69 @13TS L
          dispatch_id: visit20Record.id,
          reference_type: 'DISPATCH',
          reference_id: visit20Record.id.toString(),
          idempotency_key: `ZMCC_TANK_ISSUE:DISPATCH:${visit20Record.id}`,
          operational_timestamp: visit20Record.created_at,
          performed_by_user_id: zmccLabUser.id,
          notes: `Whole-vehicle dispatch issue for visit ${visit20Record.visit_number} (${visit20Record.vehicle_number}) [8,000 L Measured @ LR 28.00, Fat 3.80 -> 8,000.00 Gross L, 7,603.69 @13TS L]`,
        },
      });
    }
  }

  // Ensure active testing policies exist for the ZMCC lab testing points (MC and HC)
  const lrTest = (await prisma.labTest.findFirst({
    where: {
      testCode: { in: ['LT-000008', 'LT-000027'] },
      isActive: true,
    },
  })) || (await prisma.labTest.findFirst({
    where: { testName: { contains: 'Lactometer', mode: 'insensitive' }, isActive: true },
  }));

  const fatTest = (await prisma.labTest.findFirst({
    where: { testCode: 'LT-000026', isActive: true },
  })) || (await prisma.labTest.findFirst({
    where: { testName: { equals: 'Fat', mode: 'insensitive' }, isActive: true },
  }));

  const policyAuthorizer =
    users.find((u) =>
      u.is_active && (u.role === 'HEAD_OF_MPD' || u.role === 'SUPER_ADMIN')
    )
    || await prisma.user.findFirst({
      where: {
        is_active: true,
        role: { in: ['HEAD_OF_MPD', 'SUPER_ADMIN'] },
      },
    });

  if (!policyAuthorizer) {
    throw new Error('Active HEAD_OF_MPD or SUPER_ADMIN required to seed missing milk-test policy assignments.');
  }

  if (lrTest && fatTest) {
    for (const point of ['ZMCC_LAB_MC', 'ZMCC_LAB_HC']) {
      const existing = await prisma.milkTestPolicyAssignment.findFirst({
        where: { testing_point: point, is_active: true },
      });
      if (!existing) {
        await prisma.milkTestPolicyAssignment.createMany({
          data: [
            { lab_test_id: lrTest.id, testing_point: point, is_required: true, display_order: 1, is_active: true, created_by_user_id: policyAuthorizer.id },
            { lab_test_id: fatTest.id, testing_point: point, is_required: true, display_order: 2, is_active: true, created_by_user_id: policyAuthorizer.id },
          ],
        });
      }
    }
  }

  // ----- New model: owners, sources, contractors, vehicles --------------------------------
  // Data Executive registers vehicles and owns the source list (with Head of MPD and Super Admin).
  const dataExecutive =
    users.find((u) => u.role === 'DATA_EXECUTIVE' && u.is_active) ||
    users.find((u) => u.role === 'SUPER_ADMIN' && u.is_active) ||
    superAdmin;

  // Contractors (source_type CONTRACTOR) carry an ERP code. Fill it when a demo contractor has none.
  const contractorSources = await prisma.procurementSource.findMany({
    where: { source_type: 'CONTRACTOR', erp_code: null },
  });
  for (const c of contractorSources) {
    await prisma.procurementSource.update({ where: { id: c.id }, data: { erp_code: `ERP-${c.code}` } });
  }

  // Independent milk sources (name + ERP code) assigned to ZMCC Hasilpur.
  const demoMilkSourceSpecs = [
    { erp_code: 'MS-HAS-01', name: 'Hasilpur Farmers Group' },
    { erp_code: 'MS-HAS-02', name: 'Chak 12 Village Collection' },
  ];
  const demoSources: Array<{ id: bigint; erp_code: string; name: string }> = [];
  for (const spec of demoMilkSourceSpecs) {
    const src = await prisma.zmccMilkSource.upsert({
      where: { erp_code: spec.erp_code },
      update: { name: spec.name, is_active: true, updated_by: dataExecutive.id },
      create: { erp_code: spec.erp_code, name: spec.name, is_active: true, created_by: dataExecutive.id },
    });
    await prisma.milkSourceZmccVisibility.upsert({
      where: { milk_source_id_zmcc_id: { milk_source_id: src.id, zmcc_id: hasilpurSource.id } },
      update: { is_active: true },
      create: { milk_source_id: src.id, zmcc_id: hasilpurSource.id, is_active: true },
    });
    demoSources.push({ id: src.id, erp_code: src.erp_code, name: src.name });
  }
  const [demoMilkSource, demoMilkSource2] = demoSources;

  // Global weighing policy: one row, manual entry switched off.
  if ((await prisma.zmccWeighingPolicy.count()) === 0) {
    await prisma.zmccWeighingPolicy.create({ data: { manual_entry_enabled: false, allowed_units: 'BOTH', version: 1 } });
  }

  // Ensure MC Route and Profile exist for Hasilpur
  let zmccRoute = await prisma.zmccRoute.findFirst({
    where: { zmcc_id: hasilpurSource.id, route_code: 'RT-HAS-001' },
  });
  if (!zmccRoute) {
    zmccRoute = await prisma.zmccRoute.create({
      data: {
        zmcc_id: hasilpurSource.id,
        route_code: 'RT-HAS-001',
        name: 'Hasilpur Rural Route 01',
        origin: 'Hasilpur Sub-Div',
        destination: 'ZMCC Hasilpur',
        is_active: true,
        created_by: zmccManager.id,
      },
    });
  }

  let motProfile = await prisma.motProfile.findFirst({
    where: { zmcc_id: hasilpurSource.id, mot_code: 'MOT-HAS-001' },
  });
  if (!motProfile) {
    motProfile = await prisma.motProfile.create({
      data: {
        zmcc_id: hasilpurSource.id,
        mot_code: 'MOT-HAS-001',
        name: 'Muhammad Tariq',
        phone_number: '03176826604',
        cnic: '31202-1234568-1',
        is_active: true,
        created_by: zmccManager.id,
      },
    });
  }

  // Vehicles are created by the Data Executive. Three MC vehicles for the demo journeys, one stays free.
  const ensureVehicle = async (vehicleNumber: string) => {
    const existing = await prisma.motVehicle.findUnique({ where: { vehicle_number: vehicleNumber } });
    if (existing) return existing;
    return prisma.motVehicle.create({
      data: { zmcc_id: hasilpurSource.id, vehicle_number: vehicleNumber, is_active: true, created_by: dataExecutive.id },
    });
  };
  const motVehicle = await ensureVehicle('BWP-5522'); // history journey, finished: Free
  const motVehicleWaiting = await ensureVehicle('BWP-5523'); // at ZMCC waiting for lab: not available
  const motVehicleClosing = await ensureVehicle('BWP-5524'); // close-without-unloading request pending
  await ensureVehicle('BWP-5525'); // never used: Free

  // Deterministic Local Supplier (HC) sequence code helper
  async function allocateSupplierCode(): Promise<string> {
    const seqResult = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('zmcc_local_supplier_code_seq') as nextval
    `;
    const seqNum = Number(seqResult[0].nextval);
    return `ZLS-${String(seqNum).padStart(6, '0')}`;
  }

  // A. HC supplier master data (no ERP reference, no milk source)
  const supplier1 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Bashir Milk Collection Center',
      phone: '03176826604',
      cnic: '31202-1234567-1',
      is_active: true,
      created_by_user_id: pheUser.id,
    },
  });
  const supplier2 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Chaudhry Dairy & Cattle Farm',
      phone: '03176826604',
      cnic: '31202-7654321-2',
      is_active: true,
      created_by_user_id: zmccManager.id,
    },
  });
  const supplier3 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Rehman Dairy Supplies',
      phone: '03176826604',
      cnic: '31202-9876543-3',
      is_active: true,
      created_by_user_id: zmccManager.id,
    },
  });
  const supplier4 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Noor Milk Traders',
      phone: '03176826604',
      cnic: '31202-1122334-4',
      is_active: true,
      created_by_user_id: zmccManager.id,
    },
  });
  const supplier5 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Farooq Dairy Collection',
      phone: '03176826604',
      cnic: '31202-5566778-5',
      is_active: true,
      created_by_user_id: zmccManager.id,
    },
  });

  // Deterministic time references anchored to Pakistan Calendar Date
  const pktTodayDateStr = getPakistanCalendarDate(now);
  const yesterdayDate = new Date(now.getTime() - msPerDay);
  const yesterdayDateStr = getPakistanCalendarDate(yesterdayDate);
  const threeDaysAgoDate = new Date(now.getTime() - 3 * msPerDay);
  const threeDaysAgoDateStr = getPakistanCalendarDate(threeDaysAgoDate);

  const pktTodayDate = parseStrictDateOnly(pktTodayDateStr);
  const yesterdayDateOnly = parseStrictDateOnly(yesterdayDateStr);
  const threeDaysAgoDateOnly = parseStrictDateOnly(threeDaysAgoDateStr);

  if (!pktTodayDate || !yesterdayDateOnly || !threeDaysAgoDateOnly) {
    throw new Error('Failed to derive deterministic demo Pakistan calendar dates.');
  }

  // Explicit PKT (+05:00) event timestamps
  const timeTodayArr1 = new Date(`${pktTodayDateStr}T07:10:00+05:00`);
  const timeTodayArr2 = new Date(`${pktTodayDateStr}T09:30:00+05:00`);
  const timeTodayArr3 = new Date(`${pktTodayDateStr}T07:15:00+05:00`);
  const timeTodayArr6 = new Date(`${pktTodayDateStr}T08:05:00+05:00`);
  const timeTodayArr7 = new Date(`${pktTodayDateStr}T08:40:00+05:00`);
  const timeTodayMc3 = new Date(`${pktTodayDateStr}T08:20:00+05:00`);
  const timeYestArr5 = new Date(`${yesterdayDateStr}T11:00:00+05:00`);
  const timeYestArr5Exit = new Date(`${yesterdayDateStr}T12:30:00+05:00`);
  const timeThreeDaysArr4 = new Date(`${threeDaysAgoDateStr}T14:00:00+05:00`);
  const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

  // Shop area and shop (a shop has no milk source any more)
  let demoArea = await prisma.zmccArea.findFirst({
    where: { zmcc_id: hasilpurSource.id, area_code: 'AR-HAS-01' },
  });
  if (!demoArea) {
    demoArea = await prisma.zmccArea.create({
      data: {
        area_code: 'AR-HAS-01',
        name: 'Hasilpur East Rural Area',
        route_id: zmccRoute.id,
        zmcc_id: hasilpurSource.id,
        created_by: zmccManager.id,
      },
    });
  }

  const chillerSelf = await prisma.chillerOwnership.findFirst({
    where: { ownership_code: 'SELF' },
  });

  let demoShop = await prisma.zmccShop.findFirst({
    where: { shop_code: 'SHP-000001' },
  });
  if (!demoShop) {
    demoShop = await prisma.zmccShop.create({
      data: {
        shop_code: 'SHP-000001',
        shop_name: 'Al-Madina Milk Center',
        owner_name: 'Haji Ghulam Rasool',
        phone_number: '03176826604',
        cnic: '31202-9876543-1',
        area_id: demoArea.id,
        route_id: zmccRoute.id,
        zmcc_id: hasilpurSource.id,
        chiller_ownership_id: chillerSelf ? chillerSelf.id : BigInt(1),
        is_active: true,
        created_by: zmccManager.id,
      },
    });
  }

  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS "mot_collection_number_seq" START WITH 1 INCREMENT BY 1;');

  // ----- Helpers ------------------------------------------------------------------------
  type SourceRef = { id: bigint; erp_code: string; name: string };

  /** MC journey with one shop stop and one collection (source is required on every collection). */
  async function createMcJourney(opts: {
    key: string;
    dateStr: string;
    dateOnly: Date;
    vehicleId: bigint;
    arrivedAt: Date;
    source: SourceRef;
    liters: number;
    lr: number;
    fat: number;
  }) {
    const journey = await prisma.motJourney.create({
      data: {
        journey_number: `J-HAS-${opts.dateStr.replace(/-/g, '')}-${opts.key}`,
        idempotency_key: `mot-journey-${opts.key}-${opts.dateStr}`,
        zmcc_id: hasilpurSource!.id,
        route_id: zmccRoute!.id,
        mot_profile_id: motProfile!.id,
        mot_vehicle_id: opts.vehicleId,
        status: 'COMPLETED',
        operational_date: opts.dateOnly,
        assigned_by: zmccManager!.id,
        assigned_at: minutes(opts.arrivedAt, -120),
        started_at: minutes(opts.arrivedAt, -90),
        ended_at: minutes(opts.arrivedAt, -10),
        assignment_latitude: 29.6974,
        assignment_longitude: 72.5539,
        start_latitude: 29.6974,
        start_longitude: 72.5539,
      },
    });
    const stop = await prisma.motJourneyStop.create({
      data: {
        journey_id: journey.id,
        shop_id: demoShop!.id,
        planned_sequence: 1,
        status: 'VISITED',
        shop_code_snapshot: demoShop!.shop_code,
        shop_name_snapshot: demoShop!.shop_name,
        owner_name_snapshot: demoShop!.owner_name,
        phone_number_snapshot: demoShop!.phone_number,
        area_code_snapshot: demoArea!.area_code,
        area_name_snapshot: demoArea!.name,
        arrived_at: minutes(opts.arrivedAt, -75),
        completed_at: minutes(opts.arrivedAt, -60),
      },
    });
    const metrics = computeCanonicalMilkMetrics(opts.liters, 'LITER', opts.lr, opts.fat);
    const seq = await prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('mot_collection_number_seq') as nextval`;
    const colNum = `MC-${opts.dateStr.replace(/-/g, '')}-${String(Number(seq[0]?.nextval ?? 1)).padStart(4, '0')}`;
    await prisma.motShopCollection.create({
      data: {
        collection_number: colNum,
        journey_id: journey.id,
        journey_stop_id: stop.id,
        shop_id: demoShop!.id,
        zmcc_id: hasilpurSource!.id,
        route_id: zmccRoute!.id,
        mot_profile_id: motProfile!.id,
        mot_vehicle_id: opts.vehicleId,
        operational_date: opts.dateOnly,
        client_event_id: `evt-shop-col-${opts.key}-${opts.dateStr}`,
        quantity_value: opts.liters,
        quantity_unit: 'LITER',
        gross_liters: metrics.grossLiters,
        density: metrics.density,
        lr: opts.lr,
        fat: opts.fat,
        snf: metrics.snf,
        ts: metrics.ts,
        at_13ts_liters: metrics.at13tsLiters,
        calculation_version: metrics.calculationVersion,
        collection_latitude: 29.6974,
        collection_longitude: 72.5539,
        device_collected_at: minutes(opts.arrivedAt, -60),
        submitted_by_user_id: mpdUser.id,
        milk_source_id: opts.source.id,
        milk_source_code_snapshot: opts.source.erp_code,
        milk_source_name_snapshot: opts.source.name,
        shop_rmr_number: '004821',
        collection_notes: 'Demo shop collection with an assigned milk source',
      },
    });
    return journey;
  }

  async function createMcArrival(journeyId: bigint, key: string, dateStr: string, dateOnly: Date, at: Date, token: string, rawToken: string) {
    // MC has no gate exit: the journey is finished at arrival.
    return prisma.zmccMotArrival.create({
      data: {
        journey_id: journeyId,
        zmcc_id: hasilpurSource!.id,
        route_milk_token: `RM-HAS-${key}`,
        raw_milk_token_number: rawToken,
        zmcc_token: token,
        arrival_timestamp: at,
        arrival_date: dateOnly,
        client_event_id: `evt-arr-mot-${key}-${dateStr}`,
        recorded_by_user_id: pheUser!.id,
        gate_exit_required: false,
      },
    });
  }

  /** HC arrival: no milk source here, the source is chosen once at "Unload to ZMCC tank". */
  async function createHcArrival(opts: {
    key: string;
    supplierId: bigint;
    rmr: string;
    vehicle: string;
    at: Date;
    dateStr: string;
    dateOnly: Date;
    exitAt?: Date;
    source?: SourceRef;
  }) {
    return prisma.zmccLocalSupplierArrival.create({
      data: {
        zmcc_id: hasilpurSource!.id,
        local_supplier_id: opts.supplierId,
        rmr_number: opts.rmr,
        vehicle_number: opts.vehicle,
        arrival_timestamp: opts.at,
        arrival_date: opts.dateOnly,
        zmcc_token: `TK-HAS-HC-${opts.key}`,
        client_event_id: `evt-arr-hc-${opts.key}-${opts.dateStr}`,
        recorded_by_user_id: pheUser!.id,
        gate_exit_required: true,
        exit_timestamp: opts.exitAt ?? null,
        exit_recorded_by_user_id: opts.exitAt ? pheUser!.id : null,
        exit_client_event_id: opts.exitAt ? `evt-exit-hc-${opts.key}-${opts.dateStr}` : null,
        exit_submitted_at: opts.exitAt ? minutes(opts.exitAt, 2) : null,
        // Mirrored from the tank receipt once the vehicle was unloaded
        ...(opts.source
          ? {
              milk_source_id: opts.source.id,
              milk_source_code_snapshot: opts.source.erp_code,
              milk_source_name_snapshot: opts.source.name,
            }
          : {}),
      },
    });
  }

  async function addLabResults(sessionId: bigint, ruleMap: Map<string, LabTestRule>, lr: number, fat: number, passed: boolean, at: Date) {
    if (!lrTest || !fatTest) return;
    const lrRule = ruleMap.get(String(lrTest.id));
    const fatRule = ruleMap.get(String(fatTest.id));
    await prisma.zmccLabResult.createMany({
      data: [
        {
          session_id: sessionId,
          test_id: lrTest.id,
          test_code_snapshot: lrTest.testCode,
          test_name_snapshot: lrTest.testName,
          result_type_snapshot: lrTest.resultType,
          unit_snapshot: lrTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 1,
          numeric_value: lr,
          applied_rule_id: lrRule?.id || null,
          applied_rule_version: lrRule?.version || null,
          evaluation_status: passed ? 'PASS' : 'OUT_OF_SPEC',
          is_passed: passed,
          recorded_at: at,
        },
        {
          session_id: sessionId,
          test_id: fatTest.id,
          test_code_snapshot: fatTest.testCode,
          test_name_snapshot: fatTest.testName,
          result_type_snapshot: fatTest.resultType,
          unit_snapshot: fatTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 2,
          numeric_value: fat,
          applied_rule_id: fatRule?.id || null,
          applied_rule_version: fatRule?.version || null,
          evaluation_status: passed ? 'PASS' : 'OUT_OF_SPEC',
          is_passed: passed,
          recorded_at: at,
        },
      ],
    });
  }

  type PortionSpec = {
    qtyKg: number;
    lr: number;
    fat: number;
    accepted: boolean;
    /** Weighed (counts in the N+1 weight chain) when true; accepted portions come first. */
    weighed?: boolean;
  };

  /**
   * Portions of one vehicle. N accepted portions are weighed with N+1 strictly decreasing weights w0..wN:
   * portion k gets first = w(k-1), second = w(k), net = first - second.
   */
  async function createPortions(sessionId: bigint, specs: PortionSpec[], chain: number[], base: Date) {
    let acceptedIndex = 0;
    const weighed: Array<{ netKg: number; lr: number; fat: number; metrics: ReturnType<typeof computeCanonicalMilkMetrics> }> = [];
    let number = 1;
    for (const spec of specs) {
      const declared = computeCanonicalMilkMetrics(spec.qtyKg, 'KG', spec.lr, spec.fat);
      const isWeighed = Boolean(spec.accepted && spec.weighed);
      let first: number | null = null;
      let second: number | null = null;
      let net: number | null = null;
      if (isWeighed) {
        first = chain[acceptedIndex];
        second = chain[acceptedIndex + 1];
        net = Math.round((first - second) * 1000) / 1000;
      }
      if (spec.accepted) acceptedIndex += 1;
      await prisma.zmccLabPortion.create({
        data: {
          lab_session_id: sessionId,
          portion_number: number,
          status: !spec.accepted ? 'REJECTED' : isWeighed ? 'WEIGHED' : 'ACCEPTED',
          quantity_value: spec.qtyKg,
          quantity_unit: 'KG',
          density: declared.density,
          gross_liters: declared.grossLiters,
          lr: spec.lr,
          fat: spec.fat,
          snf: declared.snf,
          ts: declared.ts,
          at_13ts_liters: declared.at13tsLiters,
          calculation_version: declared.calculationVersion,
          system_outcome: spec.accepted ? 'PASS' : 'FAIL',
          person_decision: spec.accepted ? 'ACCEPT' : 'REJECT',
          decision_remarks: spec.accepted ? null : 'Sour smell and low LR',
          review_status: 'NONE',
          final_decision: spec.accepted ? 'ACCEPTED' : 'REJECTED',
          created_by_user_id: zmccLabUser!.id,
          decided_at: minutes(base, 20 + number),
          first_weight_kg: first,
          first_weight_at: isWeighed ? minutes(base, 40) : null,
          first_weight_by_user_id: isWeighed ? pheUser!.id : null,
          second_weight_kg: second,
          second_weight_at: isWeighed ? minutes(base, 45) : null,
          second_weight_by_user_id: isWeighed ? pheUser!.id : null,
          net_entry_mode: isWeighed ? 'WEIGHT' : null,
          net_weight_kg: net,
        },
      });
      if (isWeighed && net !== null) {
        weighed.push({
          netKg: net,
          lr: spec.lr,
          fat: spec.fat,
          metrics: computeCanonicalMilkMetrics(net, 'KG', spec.lr, spec.fat),
        });
      }
      number += 1;
    }
    return weighed;
  }

  /** Unload to ZMCC tank: one receipt with totals (net kg, gross L, @13TS L, weighted LR/Fat/SNF/TS/density). */
  async function createTankReceipt(
    session: { id: bigint },
    arrivalType: 'MOT' | 'HC',
    weighed: Awaited<ReturnType<typeof createPortions>>,
    at: Date,
    source: SourceRef | null,
    note: string
  ) {
    const netKg = weighed.reduce((s, p) => s + p.netKg, 0);
    const weightedAvg = (pick: (p: (typeof weighed)[number]) => number) =>
      weighed.reduce((s, p) => s + pick(p) * p.netKg, 0) / netKg;
    const gross = weighed.reduce((s, p) => s + Number(p.metrics.grossLiters), 0);
    const at13 = weighed.reduce((s, p) => s + Number(p.metrics.at13tsLiters), 0);
    const receipt = await prisma.zmccTankReceipt.create({
      data: {
        lab_session_id: session.id,
        zmcc_id: hasilpurSource!.id,
        tank_id: hasilpurTank!.id,
        arrival_type: arrivalType,
        quantity_value: Math.round(netKg * 100) / 100,
        quantity_unit: 'KG',
        density: Math.round(weightedAvg((p) => Number(p.metrics.density)) * 10000) / 10000,
        gross_liters: Math.round(gross * 100) / 100,
        lr: Math.round(weightedAvg((p) => p.lr) * 100) / 100,
        fat: Math.round(weightedAvg((p) => p.fat) * 100) / 100,
        snf: Math.round(weightedAvg((p) => Number(p.metrics.snf)) * 100) / 100,
        ts: Math.round(weightedAvg((p) => Number(p.metrics.ts)) * 100) / 100,
        at_13ts_liters: Math.round(at13 * 100) / 100,
        calculation_version: weighed[0].metrics.calculationVersion,
        received_at: at,
        received_by_user_id: pheUser!.id,
        milk_source_id: source?.id ?? null,
        milk_source_code_snapshot: source?.erp_code ?? null,
        milk_source_name_snapshot: source?.name ?? null,
      },
    });
    await prisma.zmccTankInventoryTransaction.create({
      data: {
        tank_id: hasilpurTank!.id,
        zmcc_id: hasilpurSource!.id,
        transaction_type: 'RECEIPT',
        quantity_liters: Math.round(gross * 100) / 100,
        at_13ts_liters: Math.round(at13 * 100) / 100,
        tank_receipt_id: receipt.id,
        reference_type: 'ZMCC_LAB_SESSION',
        reference_id: session.id.toString(),
        idempotency_key: `ZMCC_TANK_RECEIPT:LAB_SESSION:${session.id}`,
        operational_timestamp: at,
        performed_by_user_id: pheUser!.id,
        notes: note,
      },
    });
    return receipt;
  }

  const sessionBase = (arrivalType: 'MOT' | 'HC', at: Date) => ({
    zmcc_id: hasilpurSource!.id,
    arrival_type: arrivalType,
    test_mode: 'PORTION_WISE',
    status: 'COMPLETED',
    system_quality_outcome: 'PASS',
    started_by_user_id: zmccLabUser!.id,
    started_at: minutes(at, 10),
    completed_by_user_id: zmccLabUser!.id,
    completed_at: minutes(at, 30),
  });

  // ----- B. Scenarios -----------------------------------------------------------------------

  // HC-1: arrival inside ZMCC, waiting for the lab (no lab session yet)
  await createHcArrival({
    key: '001', supplierId: supplier1.id, rmr: '0000101', vehicle: 'BWP-4411',
    at: timeTodayArr1, dateStr: pktTodayDateStr, dateOnly: pktTodayDate,
  });

  // MC-1: arrival today, lab in progress with a manager review pending. Vehicle BWP-5523 is "At ZMCC waiting unload".
  const journey2 = await createMcJourney({
    key: '01', dateStr: pktTodayDateStr, dateOnly: pktTodayDate, vehicleId: motVehicleWaiting.id,
    arrivedAt: timeTodayArr2, source: demoMilkSource, liters: 120, lr: 28.5, fat: 3.9,
  });
  const arr2 = await createMcArrival(journey2.id, '0201', pktTodayDateStr, pktTodayDate, timeTodayArr2, 'TK-HAS-MOT-001', '001924');
  const session2 = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: hasilpurSource.id,
      arrival_type: 'MOT',
      mot_arrival_id: arr2.id,
      test_mode: 'PORTION_WISE',
      status: 'IN_PROGRESS',
      system_quality_outcome: 'OUT_OF_SPEC',
      manager_review_status: 'PENDING',
      manager_requested_decision: 'ACCEPTED',
      manager_review_requested_by_user_id: zmccLabUser.id,
      manager_review_requested_at: minutes(timeTodayArr2, 15),
      manager_review_reason: 'LR 25.80 slightly below 26.00 threshold due to extreme ambient temperature. Requesting ZMCC Manager exception clearance.',
      started_by_user_id: zmccLabUser.id,
      started_at: minutes(timeTodayArr2, 10),
    },
  });
  await prisma.zmccLabPortion.create({
    data: {
      lab_session_id: session2.id,
      portion_number: 1,
      status: 'PENDING_REVIEW',
      quantity_value: 3000,
      quantity_unit: 'KG',
      lr: 25.8,
      fat: 3.8,
      system_outcome: 'FAIL',
      person_decision: 'ACCEPT',
      decision_remarks: 'Hot day, milk looks fine',
      review_status: 'PENDING',
      final_decision: 'PENDING',
      created_by_user_id: zmccLabUser.id,
    },
  });
  await addLabResults(session2.id, zmccMcRulesMap, 25.8, 3.8, false, minutes(timeTodayArr2, 12));

  // HC-2 = RECEIVED: accepted, weighed, unloaded to tank with a source, gate exit recorded.
  const hc2Source = demoMilkSource;
  const arr3 = await createHcArrival({
    key: '002', supplierId: supplier2.id, rmr: '0000102', vehicle: 'BWP-3322',
    at: timeTodayArr3, dateStr: pktTodayDateStr, dateOnly: pktTodayDate,
    exitAt: minutes(timeTodayArr3, 75), source: hc2Source,
  });
  const session3 = await prisma.zmccLabSession.create({
    data: {
      ...sessionBase('HC', timeTodayArr3),
      local_supplier_arrival_id: arr3.id,
      decision: 'ACCEPTED',
      final_decision: 'ACCEPTED',
      completion_client_event_id: `evt-comp-hc-02-${pktTodayDateStr}`,
      journey_closed_at: minutes(timeTodayArr3, 60),
      closed_reason: 'ALL_PORTIONS_WEIGHED',
      unloaded_at: minutes(timeTodayArr3, 60),
      unloaded_by_user_id: pheUser.id,
      exit_outcome: 'RECEIVED',
    },
  });
  await addLabResults(session3.id, zmccHcRulesMap, 28.5, 3.8, true, minutes(timeTodayArr3, 20));
  // 2 accepted portions -> 3 weights: 2600 > 1500 > 400 => nets 1100 and 1100
  const weighed3 = await createPortions(
    session3.id,
    [
      { qtyKg: 1100, lr: 28.5, fat: 3.8, accepted: true, weighed: true },
      { qtyKg: 1100, lr: 28.5, fat: 3.8, accepted: true, weighed: true },
    ],
    [2600, 1500, 400],
    timeTodayArr3
  );
  await createTankReceipt(session3, 'HC', weighed3, minutes(timeTodayArr3, 60), hc2Source, 'HC tank receipt - Hasilpur');

  // HC-3 = REJECTED: every portion rejected, nothing unloaded, vehicle leaves.
  const arr4 = await createHcArrival({
    key: '003', supplierId: supplier3.id, rmr: '0000103', vehicle: 'BWP-8877',
    at: timeThreeDaysArr4, dateStr: threeDaysAgoDateStr, dateOnly: threeDaysAgoDateOnly,
    exitAt: minutes(timeThreeDaysArr4, 45),
  });
  const session4 = await prisma.zmccLabSession.create({
    data: {
      ...sessionBase('HC', timeThreeDaysArr4),
      local_supplier_arrival_id: arr4.id,
      system_quality_outcome: 'OUT_OF_SPEC',
      decision: 'REJECTED',
      final_decision: 'REJECTED',
      rejection_reason: 'Acidity 0.21% & COB Positive. High temperature 12 C detected.',
      remarks: 'Rejected at intake platform.',
      completion_client_event_id: `evt-comp-hc-03-${threeDaysAgoDateStr}`,
      journey_closed_at: minutes(timeThreeDaysArr4, 30),
      closed_reason: 'ALL_PORTIONS_REJECTED',
      exit_outcome: 'REJECTED',
    },
  });
  await addLabResults(session4.id, zmccHcRulesMap, 22.0, 2.2, false, minutes(timeThreeDaysArr4, 20));
  await createPortions(session4.id, [{ qtyKg: 1200, lr: 22.0, fat: 2.2, accepted: false }], [], timeThreeDaysArr4);

  // HC-4 = PARTLY_RECEIVED: portion 1 unloaded, portion 2 accepted but the tank was full, portion 3 rejected.
  const arr6 = await createHcArrival({
    key: '004', supplierId: supplier4.id, rmr: '0000104', vehicle: 'BWP-6101',
    at: timeTodayArr6, dateStr: pktTodayDateStr, dateOnly: pktTodayDate,
    exitAt: minutes(timeTodayArr6, 90), source: demoMilkSource2,
  });
  const session6 = await prisma.zmccLabSession.create({
    data: {
      ...sessionBase('HC', timeTodayArr6),
      local_supplier_arrival_id: arr6.id,
      decision: 'ACCEPTED',
      final_decision: 'ACCEPTED',
      completion_client_event_id: `evt-comp-hc-04-${pktTodayDateStr}`,
      journey_closed_at: minutes(timeTodayArr6, 90),
      unloaded_at: minutes(timeTodayArr6, 70),
      unloaded_by_user_id: pheUser.id,
      exit_outcome: 'PARTLY_RECEIVED',
      exit_reason_code: 'TANK_FULL',
      exit_remarks: 'Tank was full after the first portion. Driver took the second portion back.',
    },
  });
  await addLabResults(session6.id, zmccHcRulesMap, 28.0, 3.9, true, minutes(timeTodayArr6, 20));
  // Only portion 1 is weighed: 2 weights (2000 > 700). Portion 2 stays ACCEPTED, portion 3 REJECTED.
  const weighed6 = await createPortions(
    session6.id,
    [
      { qtyKg: 1300, lr: 28.0, fat: 3.9, accepted: true, weighed: true },
      { qtyKg: 1200, lr: 28.0, fat: 3.9, accepted: true, weighed: false },
      { qtyKg: 900, lr: 21.0, fat: 2.5, accepted: false },
    ],
    [2000, 700],
    timeTodayArr6
  );
  await createTankReceipt(session6, 'HC', weighed6, minutes(timeTodayArr6, 70), demoMilkSource2, 'HC partial tank receipt - Hasilpur');

  // HC-5 = ACCEPTED_NOT_RECEIVED: accepted, vehicle left before unloading.
  const arr7 = await createHcArrival({
    key: '005', supplierId: supplier5.id, rmr: '0000105', vehicle: 'BWP-7202',
    at: timeTodayArr7, dateStr: pktTodayDateStr, dateOnly: pktTodayDate,
    exitAt: minutes(timeTodayArr7, 100),
  });
  const session7 = await prisma.zmccLabSession.create({
    data: {
      ...sessionBase('HC', timeTodayArr7),
      local_supplier_arrival_id: arr7.id,
      decision: 'ACCEPTED',
      final_decision: 'ACCEPTED',
      completion_client_event_id: `evt-comp-hc-05-${pktTodayDateStr}`,
      journey_closed_at: minutes(timeTodayArr7, 100),
      exit_outcome: 'ACCEPTED_NOT_RECEIVED',
      exit_reason_code: 'LEFT_BEFORE_UNLOADING',
      exit_remarks: 'Driver left the yard before unloading started.',
    },
  });
  await addLabResults(session7.id, zmccHcRulesMap, 29.0, 4.0, true, minutes(timeTodayArr7, 20));
  await createPortions(session7.id, [{ qtyKg: 2000, lr: 29.0, fat: 4.0, accepted: true, weighed: false }], [], timeTodayArr7);

  // MC-2 = RECEIVED: completed MC arrival yesterday. 2 accepted portions, weight chain of 3 weights, unloaded.
  // The vehicle (BWP-5522) is free again because the arrival is finished.
  const journey5 = await createMcJourney({
    key: '02', dateStr: yesterdayDateStr, dateOnly: yesterdayDateOnly, vehicleId: motVehicle.id,
    arrivedAt: timeYestArr5, source: demoMilkSource, liters: 4500, lr: 29.0, fat: 4.1,
  });
  const arr5 = await createMcArrival(journey5.id, '0202', yesterdayDateStr, yesterdayDateOnly, timeYestArr5, 'TK-HAS-MOT-002', '001925');
  const session5 = await prisma.zmccLabSession.create({
    data: {
      ...sessionBase('MOT', timeYestArr5),
      mot_arrival_id: arr5.id,
      decision: 'ACCEPTED',
      final_decision: 'ACCEPTED',
      completion_client_event_id: `evt-comp-mot-02-${yesterdayDateStr}`,
      journey_closed_at: minutes(timeYestArr5, 55),
      closed_reason: 'ALL_PORTIONS_WEIGHED',
      unloaded_at: minutes(timeYestArr5, 55),
      unloaded_by_user_id: pheUser.id,
      exit_outcome: 'RECEIVED',
    },
  });
  await addLabResults(session5.id, zmccMcRulesMap, 29.0, 4.1, true, minutes(timeYestArr5, 25));
  // Weights 5200 > 3100 > 900 => nets 2100 and 2200
  const weighed5 = await createPortions(
    session5.id,
    [
      { qtyKg: 2100, lr: 29.0, fat: 4.1, accepted: true, weighed: true },
      { qtyKg: 2200, lr: 29.0, fat: 4.1, accepted: true, weighed: true },
    ],
    [5200, 3100, 900],
    timeYestArr5
  );
  await createTankReceipt(session5, 'MOT', weighed5, minutes(timeYestArr5, 55), null, 'MC tank receipt - Hasilpur');
  void timeYestArr5Exit;

  // MC-3: accepted, not unloaded, PENDING "close without unloading" request waiting for the Zonal Manager.
  const journey8 = await createMcJourney({
    key: '03', dateStr: pktTodayDateStr, dateOnly: pktTodayDate, vehicleId: motVehicleClosing.id,
    arrivedAt: timeTodayMc3, source: demoMilkSource2, liters: 1800, lr: 28.2, fat: 3.9,
  });
  const arr8 = await createMcArrival(journey8.id, '0203', pktTodayDateStr, pktTodayDate, timeTodayMc3, 'TK-HAS-MOT-003', '001926');
  const session8 = await prisma.zmccLabSession.create({
    data: {
      ...sessionBase('MOT', timeTodayMc3),
      mot_arrival_id: arr8.id,
      decision: 'ACCEPTED',
      final_decision: 'ACCEPTED',
      completion_client_event_id: `evt-comp-mot-03-${pktTodayDateStr}`,
      // Request raised by the PHE Operator; the reason and remarks wait for the Zonal Manager's decision
      close_requested_by_user_id: pheUser.id,
      close_requested_at: minutes(timeTodayMc3, 90),
      exit_reason_code: 'VEHICLE_PROBLEM',
      exit_remarks: 'Vehicle broke down at the unloading bay. Milk will be taken back to the shop.',
    },
  });
  await addLabResults(session8.id, zmccMcRulesMap, 28.2, 3.9, true, minutes(timeTodayMc3, 20));
  await createPortions(session8.id, [{ qtyKg: 1850, lr: 28.2, fat: 3.9, accepted: true, weighed: false }], [], timeTodayMc3);

  // Deactivate supplier3 now that its historical arrival has completed (realistic supplier lifecycle)
  await prisma.zmccLocalSupplier.update({
    where: { id: supplier3.id },
    data: { is_active: false, updated_by_user_id: zmccManager.id },
  });

  console.log('✅ ZMCC Hasilpur Operational Records successfully created:');
  console.log('  - HC suppliers: 5 created (4 Active, 1 Inactive), no ERP reference');
  console.log('  - Milk sources: 2 demo sources assigned to ZMCC Hasilpur; MC vehicles: 4 registered by the Data Executive');
  console.log('  - MC arrivals: 3 (1 lab in progress, 1 received, 1 with a pending close-without-unloading request)');
  console.log('  - HC arrivals: 5 (1 waiting for lab, RECEIVED, REJECTED, PARTLY_RECEIVED, ACCEPTED_NOT_RECEIVED)');
  console.log('  - Tank receipts: 3 with weighed portions (N+1 weights); HC receipts carry the milk source\n');

  console.log('==================================================');
  console.log('OPERATIONAL SEEDING COMPLETE SUMMARY:');
  console.log('==================================================');
  console.log(`  - VehicleVisits Created: ${createdVisits}`);
  console.log(`  - VisitPortions Created: ${createdPortions}`);
  console.log(`  - Completed Journeys: ${completedVisits}`);
  console.log(`  - Rejected Journeys: ${rejectedVisits}`);
  console.log(`  - Hold Journeys: ${holdVisits}`);
  console.log(`  - In-Progress Journeys: ${inProgressVisits}`);
  console.log(`  - Dispatch Lab Results: ${dispatchResultsCount}`);
  console.log(`  - Plant Lab Results: ${plantResultsCount}`);
  console.log(`  - Gate Logs: ${gateLogsCount}`);
  console.log(`  - Weight Tickets: ${weightTicketsCount}`);
  console.log(`  - Unloading Logs: ${unloadingLogsCount}`);
  console.log(`  - Final Silo Receipts: ${finalReceiptsCount}`);
  console.log(`  - QA Session Events: ${qaEventsCount}`);
  console.log('==================================================');
  console.log('Procurement Source Distribution:', JSON.stringify(sourceStats, null, 2));
  console.log('==================================================\n');

  // Verify Silo Inventory Reconciliation
  const finalSilos = await prisma.silo.findMany({ where: { is_active: true } });
  console.log('Reconciled Silo Inventory Stock Balances:');
  for (const s of finalSilos) {
    const txSum = await prisma.siloInventoryTransaction.aggregate({
      where: { silo_id: s.id },
      _sum: { quantity_liters: true },
    });
    console.log(`  - ${s.silo_code} (${s.silo_name}): Stock Ledger Sum = ${(txSum._sum.quantity_liters || 0).toLocaleString()} L`);
  }

  // Verify ZMCC Tank Stock Balance
  const physicalStock = await getTankPhysicalStock(hasilpurTank.id);
  const commercialStock = await getTankCommercialStock(hasilpurTank.id);
  console.log(`\nReconciled ZMCC Tank Stock Balance:`);
  console.log(`  - ${hasilpurTank.tank_code} (${hasilpurTank.tank_name}): Physical Stock Ledger Balance = ${physicalStock.toLocaleString()} Gross L`);
  console.log(`  - ${hasilpurTank.tank_code} (${hasilpurTank.tank_name}): Commercial Stock Ledger Balance = ${commercialStock.stockAt13Ts !== null ? commercialStock.stockAt13Ts.toLocaleString() : 'INCOMPLETE'} L @13% TS (Complete: ${commercialStock.isComplete})`);
  console.log('==================================================\n');

  return {
    createdVisits,
    createdPortions,
    completedVisits,
    rejectedVisits,
    holdVisits,
    inProgressVisits,
    sourceStats,
    zmccDemo: {
      hasilpurSuppliers: 5,
      hasilpurArrivals: 8,
      hasilpurLabSessions: 7,
      hasilpurTankReceipts: 3,
      hasilpurTankStockLiters: physicalStock,
      hasilpurTankStockAt13ts: commercialStock.stockAt13Ts,
      hasilpurTankCommercialComplete: commercialStock.isComplete,
    },
  };
}

if (require.main === module) {
  seedOperationalData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error during operational data seeding:', err);
      process.exit(1);
    });
}
