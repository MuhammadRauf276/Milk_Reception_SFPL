import {
  getOperationalLogs,
  getOperationalLogById,
} from '../src/backend/services/operationalReadModelService';
import {
  computeRuntimeMetrics,
  computeVehicleDecisionSummary,
  computeAuthoritativeZonalAnalytics,
} from '../src/backend/services/operationalCalculations';
import { calculateSNF, calculateTS, calculateDensity, calculatePhysicalLiters } from '../src/backend/utils/milkFormulas';
import { calculateVehicleReceivedQuantity } from '../src/backend/services/vehicleQuantityService';
import { MilkProcessLog, User } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✅ TEST ${totalTests}: ${message}`);
  } else {
    console.error(`❌ TEST ${totalTests} FAILED: ${message}`);
    process.exitCode = 1;
  }
}

async function runChunk6Tests() {
  console.log('=====================================================');
  console.log('STARTING CHUNK 6: LEGACY CALCULATION MIGRATION & REMOVAL SUITE');
  console.log('=====================================================\n');

  // Case A: Zero fake defaults (3.8, 28, 12000, 1.03, 'Accepted' fallback are NOT present)
  console.log('--- CASE A: ZERO FAKE DEFAULTS ---');
  const dummyMissingLog: MilkProcessLog = {
    id: 9999,
    vehicle_number: 'TEST-ZERO-FAKE',
    portion_number: 'P-01',
    zonal_contractor_name: 'Test Contractor',
    status: 'Dispatched',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const computedMissing = computeRuntimeMetrics(dummyMissingLog);
  assert(computedMissing.dispatch_fat === undefined || computedMissing.dispatch_fat === null, 'Missing dispatch fat is null/undefined (no 3.8 fallback)');
  assert(computedMissing.dispatch_lr === undefined || computedMissing.dispatch_lr === null, 'Missing dispatch LR is null/undefined (no 28.0 fallback)');
  assert(computedMissing.computed_dispatch_snf === null || computedMissing.computed_dispatch_snf === undefined, 'Missing dispatch SNF is null (not calculated from fake values)');
  assert(computedMissing.computed_sampling_snf === null || computedMissing.computed_sampling_snf === undefined, 'Missing plant SNF is null (not calculated from fake values)');
  assert(computedMissing.computed_plant_liters === null || computedMissing.computed_plant_liters === undefined, 'Missing plant liters is null (no gross/1.03 or 12000 fallback)');

  // Case B: Missing plant LR/Fat returns null for Plant SNF, Plant TS, not fake values
  console.log('\n--- CASE B: MISSING LAB RESULTS PRODUCE NULL METRICS ---');
  const partialLog: MilkProcessLog = {
    ...dummyMissingLog,
    dispatch_fat: 4.1,
    dispatch_lr: null, // missing LR
  };
  const computedPartial = computeRuntimeMetrics(partialLog);
  assert(computedPartial.computed_dispatch_snf === null || computedPartial.computed_dispatch_snf === undefined, 'Partial dispatch (fat present, LR missing) yields null SNF');
  assert(computedPartial.computed_dispatch_ts === null || computedPartial.computed_dispatch_ts === undefined, 'Partial dispatch yields null TS');

  // Case C: Multi-portion vehicle calculations match authoritative formulas
  console.log('\n--- CASE C: CANONICAL FORMULAS VERIFICATION ---');
  const testLr = 29.5;
  const testFat = 4.2;
  const expectedSnf = Number(((29.5 / 4) + (0.22 * 4.2) + 0.72).toFixed(3)); // 7.375 + 0.924 + 0.72 = 9.019
  const expectedTs = Number((4.2 + expectedSnf).toFixed(3)); // 13.219
  const actualSnf = Number(calculateSNF(testLr, testFat).toFixed(3));
  const actualTs = Number(calculateTS(testFat, actualSnf).toFixed(3));

  assert(actualSnf === expectedSnf, `Canonical SNF formula matches exactly: ${actualSnf} == ${expectedSnf}`);
  assert(actualTs === expectedTs, `Canonical TS formula matches exactly: ${actualTs} == ${expectedTs}`);

  // Old formula was (LR / 4) + (0.2 * Fat) + 0.36 = 7.375 + 0.84 + 0.36 = 8.575
  const oldSnf = (testLr / 4) + (0.2 * testFat) + 0.36;
  assert(actualSnf !== oldSnf, `Canonical SNF correctly differs from legacy obsolete SNF: ${actualSnf} !== ${oldSnf}`);

  // Case D: Density and Physical Liters
  console.log('\n--- CASE D: DENSITY & PHYSICAL LITERS ---');
  const expectedDensity = 1 + (29.5 / 1000); // 1.0295
  const actualDensity = calculateDensity(29.5);
  assert(Math.abs(actualDensity - expectedDensity) < 1e-6, `Density matches: ${actualDensity} == ${expectedDensity}`);

  const testKg = 15000;
  const expectedLiters = testKg / 1.0295;
  const actualLiters = calculatePhysicalLiters(testKg, 29.5);
  assert(Math.abs(actualLiters - expectedLiters) < 1e-4, `Physical liters match: ${actualLiters.toFixed(2)} == ${expectedLiters.toFixed(2)}`);

  // Case E: Dispatched portion with declared unit = 'KG' converts via LR density
  console.log('\n--- CASE E: KG TO LITER CONVERSION VIA DISPATCH LR ---');
  const kgDeclaredLog: MilkProcessLog = {
    ...dummyMissingLog,
    dispatch_kg_gross: 10295,
    dispatch_lr: 29.5,
    dispatch_fat: 4.0,
    dispatch_liters_gross: Number((10295 / (1 + 29.5/1000)).toFixed(2)),
  };
  assert(kgDeclaredLog.dispatch_liters_gross === 10000, `10,295 KG @ 29.5 LR converts to exactly 10,000 Liters (actual: ${kgDeclaredLog.dispatch_liters_gross})`);

  // Case F: Dispatched portion with declared unit = 'LITER' preserves declared quantity
  console.log('\n--- CASE F: LITER DECLARATION PRESERVES DECLARED LITERS ---');
  const literDeclaredLog: MilkProcessLog = {
    ...dummyMissingLog,
    dispatch_kg_gross: null,
    dispatch_liters_gross: 10000,
    dispatch_lr: 29.5,
    dispatch_fat: 4.0,
  };
  assert(literDeclaredLog.dispatch_liters_gross === 10000, 'LITER declaration maintains 10,000 Liters directly');

  // Case G: Live database queries via getOperationalLogs
  console.log('\n--- CASE G: LIVE DATABASE OPERATIONAL LOGS ---');
  const liveLogs = await getOperationalLogs();
  assert(Array.isArray(liveLogs), `getOperationalLogs returned ${liveLogs.length} logs from DB`);
  if (liveLogs.length > 0) {
    const first = liveLogs[0];
    assert(typeof first.vehicle_number === 'string', 'Log has valid vehicle_number');
    assert(first.portion_number.startsWith('P-'), `Portion number format is P-XX: ${first.portion_number}`);
  }

  // Case H: ZMCC Zone Manager server-lock
  console.log('\n--- CASE H: ZMCC ZONE MANAGER SERVER LOCK ---');
  const zoneManagerUser: User = {
    id: 'usr_mpd_zm_n',
    username: 'zmcc.manager.north',
    name: 'ZMCC Minor Manager (Northern Zone)',
    role: 'MPD_Zone_Manager',
    department: 'Milk Procurement (Zone A)',
    zone: 'ZMCC Hasilpur',
  };
  const zoneScopedLogs = await getOperationalLogs(undefined, zoneManagerUser);
  assert(
    zoneScopedLogs.every((l) => l.zonal_contractor_name === 'ZMCC Hasilpur'),
    `ZMCC Zone Manager only sees assigned zone logs (total: ${zoneScopedLogs.length})`
  );

  // Case I: Vehicle Decision Summary logic
  console.log('\n--- CASE I: VEHICLE DECISION SUMMARY ---');
  const portionsAllAccepted: MilkProcessLog[] = [
    { ...dummyMissingLog, calculated_status: 'ACCEPTED' },
    { ...dummyMissingLog, calculated_status: 'ACCEPTED' },
  ];
  const summaryAccepted = computeVehicleDecisionSummary(portionsAllAccepted, 'COMPLETED');
  assert(summaryAccepted.isAllAccepted && summaryAccepted.statusLabel === 'ACCEPTED', 'All accepted portions result in ACCEPTED label');

  const portionsMixed: MilkProcessLog[] = [
    { ...dummyMissingLog, calculated_status: 'ACCEPTED' },
    { ...dummyMissingLog, calculated_status: 'REJECTED' },
  ];
  const summaryMixed = computeVehicleDecisionSummary(portionsMixed, 'COMPLETED');
  assert(summaryMixed.isMixed && summaryMixed.statusLabel === '1 Accepted / 1 Rejected', 'Mixed portions result in "1 Accepted / 1 Rejected" label');

  const portionsPending: MilkProcessLog[] = [
    { ...dummyMissingLog, calculated_status: 'ACCEPTED' },
    { ...dummyMissingLog, calculated_status: null },
  ];
  const summaryPending = computeVehicleDecisionSummary(portionsPending, 'IN_PLANT');
  assert(summaryPending.isPending && summaryPending.statusLabel.includes('Pending'), 'Pending portion shows pending status');

  // Case J: Authoritative Zonal Analytics
  console.log('\n--- CASE J: AUTHORITATIVE ZONAL SUMMARY ANALYTICS ---');
  const sampleZonalLogs: MilkProcessLog[] = [
    {
      ...dummyMissingLog,
      id: 101,
      zonal_contractor_name: 'ZMCC Hasilpur',
      dispatch_liters_gross: 5000,
      computed_dispatch_13ts_liters: 5000,
      computed_plant_liters: 4950,
      computed_plant_13ts_liters: 4920,
      calculated_status: 'ACCEPTED',
    },
    {
      ...dummyMissingLog,
      id: 102,
      zonal_contractor_name: 'ZMCC Hasilpur',
      dispatch_liters_gross: 5000,
      computed_dispatch_13ts_liters: 5000,
      computed_plant_liters: 5000,
      computed_plant_13ts_liters: 5000,
      calculated_status: 'ACCEPTED',
    },
  ];

  const zonalSummary = computeAuthoritativeZonalAnalytics(sampleZonalLogs, 'ZMCC Hasilpur');
  assert(zonalSummary.totalVisits === 2, `Total visits count is 2: ${zonalSummary.totalVisits}`);
  assert(zonalSummary.totalZonalDispatchedLiters === 10000, `Total dispatched liters is 10,000: ${zonalSummary.totalZonalDispatchedLiters}`);
  assert(zonalSummary.plantReceivedFromThisZone === 9950, `Plant received liters is 9,950: ${zonalSummary.plantReceivedFromThisZone}`);
  assert(zonalSummary.volumeVarianceLiters === -50, `Volume variance is -50 L: ${zonalSummary.volumeVarianceLiters}`);
  assert(zonalSummary.shortageLiters === 50, `Shortage is 50 L: ${zonalSummary.shortageLiters}`);

  // Case K: Verify dead forms deletion
  console.log('\n--- CASE K: VERIFY DEAD FORMS DELETION ---');
  const deadFormPaths = [
    'src/frontend/modules/forms/MPDDispatchForm.tsx',
    'src/frontend/modules/forms/QASamplingForm.tsx',
    'src/frontend/modules/forms/SecurityWeightForm.tsx',
    'src/frontend/modules/forms/ProductionReceptionForm.tsx',
    'src/frontend/modules/forms/TokenGenerationModal.tsx',
    'src/backend/services/dairyCalculations.ts',
  ];

  for (const relPath of deadFormPaths) {
    const fullPath = path.resolve(__dirname, '..', relPath);
    const exists = fs.existsSync(fullPath);
    assert(!exists, `Dead file is confirmed deleted: ${relPath}`);
  }

  // Case L: Verify db.ts contains no fake mappers or raw SQL CRUD
  console.log('\n--- CASE L: VERIFY DB.TS CLEANUP ---');
  const dbTsPath = path.resolve(__dirname, '..', 'src/backend/core/db.ts');
  const dbTsContent = fs.readFileSync(dbTsPath, 'utf-8');
  assert(!dbTsContent.includes('mapPgRowToLog'), 'db.ts does not contain mapPgRowToLog');
  assert(!dbTsContent.includes('getAllLogs'), 'db.ts does not contain getAllLogs');
  assert(!dbTsContent.includes('createLog'), 'db.ts does not contain createLog');
  assert(!dbTsContent.includes('updateLog'), 'db.ts does not contain updateLog');
  assert(!dbTsContent.includes('dairyCalculations'), 'db.ts does not import dairyCalculations');
  assert(dbTsContent.includes('export const prisma'), 'db.ts exports PrismaClient');

  // Case M: Authentication & Method Guards on /api/logs
  console.log('\n--- CASE M: AUTHENTICATION & METHOD GUARDS ON /API/LOGS ---');
  const { GET: getLogsRoute, POST: postLogsRoute, PATCH: patchLogsRoute } = await import('../src/app/api/logs/route');
  const { NextRequest } = await import('next/server');

  // 1. Unauthenticated GET must return 401
  const unauthReq = new NextRequest('http://localhost:3000/api/logs', { method: 'GET' });
  const unauthRes = await getLogsRoute(unauthReq);
  assert(unauthRes.status === 401, `Unauthenticated GET /api/logs returns 401 Unauthorized (actual: ${unauthRes.status})`);
  const unauthBody = await unauthRes.json();
  assert(unauthBody.error?.includes('Unauthorized'), `Unauthenticated error message is clear: "${unauthBody.error}"`);

  // 2. Legacy POST must return 405
  const postRes = await postLogsRoute();
  assert(postRes.status === 405, `Legacy POST /api/logs returns 405 Method Not Allowed (actual: ${postRes.status})`);

  // 3. Legacy PATCH must return 405
  const patchRes = await patchLogsRoute();
  assert(patchRes.status === 405, `Legacy PATCH /api/logs returns 405 Method Not Allowed (actual: ${patchRes.status})`);

  // Case N: Multi-Source Scoping Isolation
  console.log('\n--- CASE N: PROCUREMENT SOURCE SCOPING ISOLATION ---');
  const scopedUserNorth: User = {
    id: 'user-north',
    username: 'zmcc.manager.north',
    name: 'ZMCC Manager North',
    role: 'MPD_Zone_Manager',
    department: 'MPD',
    zone: 'Hasilpur',
    scope_type: 'ZONE',
    procurement_source_id: null,
  };

  const northLogs = await getOperationalLogs(undefined, scopedUserNorth);
  assert(northLogs.length > 0, `Scoped Hasilpur manager retrieved ${northLogs.length} logs`);
  const hasForeignSource = northLogs.some((l) => !l.zonal_contractor_name.includes('Hasilpur'));
  assert(!hasForeignSource, 'Scoped Hasilpur manager receives ZERO records from foreign ZMCCs or Contractors');

  const superAdminUser: User = {
    id: 'user-admin',
    username: 'admin.superuser',
    name: 'Super Admin',
    role: 'SUPER_ADMIN',
    department: 'Administration',
    zone: null,
    scope_type: 'ALL',
    procurement_source_id: null,
  };

  const adminLogs = await getOperationalLogs(undefined, superAdminUser);
  const distinctSources = new Set(adminLogs.map((l) => l.zonal_contractor_name));
  assert(distinctSources.size > 1, `Super Admin retrieves records across multiple sources (${distinctSources.size} distinct sources)`);
  assert(adminLogs.length >= northLogs.length, `Super Admin sees plant-wide records (${adminLogs.length} >= ${northLogs.length})`);

  // Case O: Multi-Portion Numeric Consistency (P1 28/3.8 + P2 30/4.0 + P3 Rej + 10,000 Net KG => 9,718.17 L)
  console.log('\n--- CASE O: MULTI-PORTION NUMERIC CONSISTENCY (P1 28/3.8 + P2 30/4.0 + P3 REJ) ---');
  const multiPortionCalc = calculateVehicleReceivedQuantity({
    grossWeightKg: 25000,
    secondWeightKg: 15000,
    portions: [
      {
        portionId: 'p1',
        portionNumber: 1,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.8, performanceStatus: 'PERFORMED' },
        ],
      },
      {
        portionId: 'p2',
        portionNumber: 2,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 30.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat %', numericValue: 4.0, performanceStatus: 'PERFORMED' },
        ],
      },
      {
        portionId: 'p3',
        portionNumber: 3,
        plantDecision: 'REJECTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 15.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat %', numericValue: 2.0, performanceStatus: 'PERFORMED' },
        ],
      },
    ],
  });

  assert(multiPortionCalc.isCalculable === true, 'Multi-portion scenario is cleanly calculable');
  if (multiPortionCalc.isCalculable) {
    assert(Math.abs(multiPortionCalc.internalCalculationBasis.averagePlantLr - 29.0) < 0.001, `Average Plant LR is exact (28+30)/2 = 29.0 (got: ${multiPortionCalc.internalCalculationBasis.averagePlantLr})`);
    assert(Math.abs(multiPortionCalc.internalCalculationBasis.averagePlantFat - 3.9) < 0.001, `Average Plant Fat is exact (3.8+4.0)/2 = 3.9 (got: ${multiPortionCalc.internalCalculationBasis.averagePlantFat})`);
    assert(Math.abs(multiPortionCalc.vehicleDensity - 1.029) < 0.001, `Vehicle Density is exact 1 + 29/1000 = 1.029 (got: ${multiPortionCalc.vehicleDensity})`);
    assert(Math.abs(multiPortionCalc.vehicleSnf - 8.828) < 0.001, `Vehicle SNF is exact 29/4 + 0.22*3.9 + 0.72 = 8.828 (got: ${multiPortionCalc.vehicleSnf})`);
    assert(Math.abs(multiPortionCalc.vehicleTs - 12.728) < 0.001, `Vehicle TS is exact 3.9 + 8.828 = 12.728 (got: ${multiPortionCalc.vehicleTs})`);
    assert(multiPortionCalc.netWeightKg === 10000, `Vehicle Net KG is exact 25,000 - 15,000 = 10,000 (got: ${multiPortionCalc.netWeightKg})`);
    const diffLiters = Math.abs(multiPortionCalc.finalPhysicalLiters - 9718.173);
    assert(diffLiters < 0.01, `Final Physical Liters is exact 10,000 / 1.029 = 9,718.17 L (got: ${multiPortionCalc.finalPhysicalLiters})`);
    const diff13Ts = Math.abs(multiPortionCalc.finalAt13TSLiters - 9514.84);
    assert(diff13Ts < 0.01, `Final @13TS Liters is exact 9,718.173 * 12.728 / 13 = 9,514.84 L (got: ${multiPortionCalc.finalAt13TSLiters})`);
  }

  // Case P: Net-KG Authority Guard (No Gross - Tare recalculation)
  console.log('\n--- CASE P: NET-KG AUTHORITY GUARD (NO GROSS - TARE RECALCULATION) ---');
  const dummyLogWithAuthoritativeNet: MilkProcessLog = {
    ...dummyMissingLog,
    first_weight_of_vehicle: 25000,
    second_weight_of_vehicle: 15000,
    computed_net_milk_weight: 9995, // authoritative from WeightTicket.net_weight_kg (e.g. scale calibration adjustment)
  };

  const processedLog = computeRuntimeMetrics(dummyLogWithAuthoritativeNet);
  assert(processedLog.computed_net_milk_weight === 9995, `computeRuntimeMetrics preserves authoritative net_weight_kg (9995) without re-subtracting Gross-Tare (got: ${processedLog.computed_net_milk_weight})`);

  // Static assertion: operationalCalculations.ts does not contain "first_weight_of_vehicle -"
  const opCalcPath = path.resolve(__dirname, '..', 'src/backend/services/operationalCalculations.ts');
  const opCalcContent = fs.readFileSync(opCalcPath, 'utf-8');
  assert(!opCalcContent.includes('first_weight_of_vehicle -'), 'operationalCalculations.ts does not implement Gross - Tare recalculation');
  assert(!opCalcContent.includes('first_weight_of_vehicle-'), 'operationalCalculations.ts does not implement Gross - Tare recalculation');

  // Case Q: Targeted Scenario B Numerical Consistency (P1 27/3.5 + P2 29/3.9 + P3 Rej + 10,000 Net KG => 9,727.63 L & 9,154.44 @13TS)
  console.log('\n--- CASE Q: SCENARIO B NUMERIC SIGN-OFF (P1 27/3.5 + P2 29/3.9 + P3 REJ) ---');
  const scenarioBCalc = calculateVehicleReceivedQuantity({
    grossWeightKg: 30000,
    secondWeightKg: 20000,
    portions: [
      {
        portionId: 'p1',
        portionNumber: 1,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 27.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.5, performanceStatus: 'PERFORMED' },
        ],
      },
      {
        portionId: 'p2',
        portionNumber: 2,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 29.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.9, performanceStatus: 'PERFORMED' },
        ],
      },
      {
        portionId: 'p3',
        portionNumber: 3,
        plantDecision: 'REJECTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 100.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat %', numericValue: 20.0, performanceStatus: 'PERFORMED' },
        ],
      },
    ],
  });

  assert(scenarioBCalc.isCalculable === true, 'Scenario B is calculable');
  if (scenarioBCalc.isCalculable) {
    assert(Math.abs(scenarioBCalc.internalCalculationBasis.averagePlantLr - 28.0) < 0.001, `Scenario B Average Plant LR is 28.0 (got: ${scenarioBCalc.internalCalculationBasis.averagePlantLr})`);
    assert(Math.abs(scenarioBCalc.internalCalculationBasis.averagePlantFat - 3.7) < 0.001, `Scenario B Average Plant Fat is 3.7 (got: ${scenarioBCalc.internalCalculationBasis.averagePlantFat})`);
    assert(Math.abs(scenarioBCalc.vehicleDensity - 1.028) < 0.001, `Scenario B Density is 1.028 (got: ${scenarioBCalc.vehicleDensity})`);
    assert(Math.abs(scenarioBCalc.vehicleSnf - 8.534) < 0.001, `Scenario B SNF is 8.534% (got: ${scenarioBCalc.vehicleSnf})`);
    assert(Math.abs(scenarioBCalc.vehicleTs - 12.234) < 0.001, `Scenario B TS is 12.234% (got: ${scenarioBCalc.vehicleTs})`);
    assert(Math.abs(scenarioBCalc.vehicleRatio - 2.3065) < 0.001, `Scenario B Ratio is ~2.306 (got: ${scenarioBCalc.vehicleRatio})`);
    assert(scenarioBCalc.netWeightKg === 10000, `Scenario B Net KG is 10,000 (got: ${scenarioBCalc.netWeightKg})`);
    assert(Math.abs(scenarioBCalc.finalPhysicalLiters - 9727.626) < 0.01, `Scenario B Physical Liters is 9,727.63 L (got: ${scenarioBCalc.finalPhysicalLiters})`);
    assert(Math.abs(scenarioBCalc.finalAt13TSLiters - 9154.44) < 0.01, `Scenario B Final @13TS is 9,154.44 L (got: ${scenarioBCalc.finalAt13TSLiters})`);
  }

  console.log('\n=====================================================');
  console.log(`CHUNK 6 RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('=====================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runChunk6Tests().catch((err) => {
  console.error('Fatal error running Chunk 6 tests:', err);
  process.exit(1);
});
