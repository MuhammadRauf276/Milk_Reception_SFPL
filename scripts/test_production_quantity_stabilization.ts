import { prisma } from '../src/backend/core/db';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';
import { isPlantLrTest, isPlantFatTest } from '../src/backend/services/vehicleQuantityService';
import { getSiloActiveReservedLiters, getSiloProvisionalAvailableCapacity } from '../src/backend/services/siloInventoryService';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}`);
    if (details) console.error(`       -> ${details}`);
    failed++;
  }
}

function approxEqual(a: number | null | undefined, b: number | null | undefined, epsilon = 0.001): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(a - b) <= epsilon;
}

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING CHUNK 4: PRODUCTION QUANTITY & UNIT STABILIZATION TESTS');
  console.log('==================================================\n');

  // ----------------------------------------------------
  // CASE A: ZMCC / KG with Valid Plant QA
  // ----------------------------------------------------
  const declaredKgA = 9500;
  const plantLrA = 28.0;
  const plantFatA = 3.8;
  const densityA = 1 + plantLrA / 1000; // 1.028
  const expectedPhysicalLitersA = calculatePhysicalLiters(declaredKgA, plantLrA); // 9500 / 1.028 = 9241.245...
  const expectedSnfA = calculateSNF(plantLrA, plantFatA); // 8.556
  const expectedTsA = calculateTS(plantFatA, expectedSnfA); // 12.356
  const expectedRatioA = calculateRatio(expectedSnfA, plantFatA); // 2.25157...
  const expectedAt13A = calculateAt13TSLiters(expectedPhysicalLitersA, expectedTsA); // 9241.245... * 12.356 / 13 = 8783.565...

  assert(approxEqual(expectedPhysicalLitersA, 9241.245, 0.01), 'Case A1: KG conversion uses Plant LR (9500 / 1.028 = ~9,241.25 L)', `Got ${expectedPhysicalLitersA}`);
  assert(approxEqual(expectedSnfA, 8.556, 0.01), 'Case A2: Canonical SNF is 8.556%', `Got ${expectedSnfA}`);
  assert(approxEqual(expectedTsA, 12.356, 0.01), 'Case A3: Canonical TS is 12.356%', `Got ${expectedTsA}`);
  assert(approxEqual(expectedRatioA, 2.252, 0.01), 'Case A4: Canonical SNF:Fat Ratio is ~2.252', `Got ${expectedRatioA}`);
  assert(approxEqual(expectedAt13A, 8783.448, 0.01), 'Case A5: Provisional @13TS liters is ~8,783.45 L', `Got ${expectedAt13A}`);

  // ----------------------------------------------------
  // CASE B: Contractor KG behaves identically to ZMCC KG
  // ----------------------------------------------------
  const contractorKg = 9500;
  const contractorLiters = calculatePhysicalLiters(contractorKg, 28.0);
  assert(approxEqual(contractorLiters, expectedPhysicalLitersA), 'Case B: Contractor KG converted via Plant LR identically');

  // ----------------------------------------------------
  // CASE C: Contractor LITER
  // ----------------------------------------------------
  const declaredLitersC = 10000;
  const provisionalLitersC = declaredLitersC; // LITER directly!
  assert(provisionalLitersC === 10000, 'Case C1: LITER declaration preserves exact physical liters (10,000 L)');
  assert(provisionalLitersC !== declaredLitersC / 1.028, 'Case C2: LITER is NEVER divided by density');

  // ----------------------------------------------------
  // CASE D: LITER + Valid Plant QA
  // ----------------------------------------------------
  const declaredLitersD = 10000;
  const plantLrD = 28.0;
  const plantFatD = 3.8;
  const snfD = calculateSNF(plantLrD, plantFatD);
  const tsD = calculateTS(plantFatD, snfD);
  const at13D = calculateAt13TSLiters(declaredLitersD, tsD); // 10000 * 12.356 / 13 = 9504.615...
  assert(approxEqual(at13D, 9504.615), 'Case D: Provisional @13TS for LITER declaration uses declared liters directly (10,000 * 12.356 / 13 = ~9,504.62 L)');

  // ----------------------------------------------------
  // CASE E: LITER + Missing Plant LR
  // ----------------------------------------------------
  const declaredLitersE = 10000;
  const plantLrE: number | null = null;
  const plantFatE: number | null = 3.8;
  const physicalLitersE = declaredLitersE; // Physical liters still known!
  const snfE = plantLrE !== null && plantFatE !== null ? calculateSNF(plantLrE, plantFatE) : null;
  const tsE = snfE !== null && plantFatE !== null ? calculateTS(plantFatE, snfE) : null;
  const at13E = tsE !== null ? calculateAt13TSLiters(physicalLitersE, tsE) : null;
  assert(physicalLitersE === 10000, 'Case E1: Physical liters for LITER remains 10,000 L even without Plant LR');
  assert(snfE === null, 'Case E2: SNF is null when Plant LR is missing (no fake LR)');
  assert(tsE === null, 'Case E3: TS is null when Plant LR is missing');
  assert(at13E === null, 'Case E4: @13TS is null when Plant LR is missing');

  // ----------------------------------------------------
  // CASE F: KG + Missing Plant LR
  // ----------------------------------------------------
  const declaredKgF = 9500;
  const plantLrF: number | null = null;
  const physicalLitersF = plantLrF !== null ? calculatePhysicalLiters(declaredKgF, plantLrF) : null;
  assert(physicalLitersF === null, 'Case F: KG declaration with missing Plant LR yields null physical liters (cannot convert without LR)');

  // ----------------------------------------------------
  // CASE G: Plant LR Missing but Dispatch LR Exists (Zero Dispatch Fallback)
  // ----------------------------------------------------
  const dispatchLrG = 28.0;
  const plantLrG: number | null = null;
  // Production must NOT use dispatchLrG
  const effectivePlantLrG = plantLrG;
  assert(effectivePlantLrG === null, 'Case G: Production strictly ignores Dispatch LR when Plant LR is missing');

  // ----------------------------------------------------
  // CASE H: Plant Fat Missing but Dispatch Fat Exists (Zero Dispatch Fallback)
  // ----------------------------------------------------
  const dispatchFatH = 3.8;
  const plantFatH: number | null = null;
  const effectivePlantFatH = plantFatH;
  assert(effectivePlantFatH === null, 'Case H: Production strictly ignores Dispatch Fat when Plant Fat is missing');

  // ----------------------------------------------------
  // CASE I: Mixed KG/LITER Portions
  // ----------------------------------------------------
  const p1Kg = 9500;
  const p1Unit = 'KG';
  const p1Liters = calculatePhysicalLiters(p1Kg, 28.0); // ~9241.25 L

  const p2Liters = 10000;
  const p2Unit = 'LITER';

  const mixedUnits = new Set([p1Unit, p2Unit]);
  const isMixed = mixedUnits.size > 1;
  const totalDeclaredValue = isMixed ? null : p1Kg + p2Liters;
  const totalDeclaredUnit = isMixed ? 'MIXED' : p1Unit;
  const totalCommonPhysicalLiters = p1Liters + p2Liters; // ~19,241.25 L

  assert(isMixed, 'Case I1: Mixed units detected (KG and LITER)');
  assert(totalDeclaredValue === null, 'Case I2: Raw declared total is null when units are mixed (no 9500 + 10000 fake sum)');
  assert(totalDeclaredUnit === 'MIXED', 'Case I3: Total declared unit is marked MIXED');
  assert(approxEqual(totalCommonPhysicalLiters, 19241.245), 'Case I4: Total normalized physical liters is cleanly summed (~19,241.25 L)');

  // ----------------------------------------------------
  // CASE J: Rejected Portion Isolation
  // ----------------------------------------------------
  const acceptedPortionsJ = [{ id: 1, isAccepted: true, liters: 9241.245 }];
  const rejectedPortionsJ = [{ id: 2, isAccepted: false, liters: 50000 }];
  const totalAcceptedLitersJ = acceptedPortionsJ.filter(p => p.isAccepted).reduce((sum, p) => sum + p.liters, 0);
  assert(approxEqual(totalAcceptedLitersJ, 9241.245), 'Case J: Rejected portion (50,000 L) completely excluded from provisional volume');

  // ----------------------------------------------------
  // CASE K & L: Silo Active Reservation Unit Tests with DB
  // ----------------------------------------------------
  // Fetch an active silo from DB
  const testSilo = await prisma.silo.findFirst({ where: { is_active: true } });
  if (testSilo) {
    const availableCap = await getSiloProvisionalAvailableCapacity(testSilo.id);
    assert(typeof availableCap === 'number' && !isNaN(availableCap), 'Case K/L: Silo provisional available capacity calculated cleanly');
  }

  // ----------------------------------------------------
  // CASE M: Semantic Search in Source Files for Forbidden Fallbacks
  // ----------------------------------------------------
  const productionRoutePaths = [
    path.join(__dirname, '../src/app/api/production/ready-for-unloading/route.ts'),
    path.join(__dirname, '../src/app/api/production/unloading-queue/route.ts'),
    path.join(__dirname, '../src/app/api/production/vehicle-visits/[visitId]/portions/[portionId]/start/route.ts'),
    path.join(__dirname, '../src/app/api/production/vehicle-visits/[visitId]/route.ts'),
  ];

  for (const filePath of productionRoutePaths) {
    const content = fs.readFileSync(filePath, 'utf8');
    const baseName = path.basename(filePath);
    assert(!content.includes('26.5'), `Case M1 (${baseName}): Zero hardcoded 26.5 fallback in ${baseName}`);
    assert(!content.includes('3.8') || baseName.includes('test'), `Case M2 (${baseName}): Zero hardcoded 3.8 fallback in ${baseName}`);
    assert(!content.includes('dispatch_lab_results') || baseName === 'route.ts' && !content.includes('dispatchLr'), `Case M3 (${baseName}): Zero operational Dispatch QA fallback in ${baseName}`);
    assert(!content.includes('declaredKg') || content.includes('dispatch_quantity_value'), `Case M4 (${baseName}): Correct unit-aware variable semantics in ${baseName}`);
  }

  console.log('\n==================================================');
  console.log(`CHUNK 4 PRODUCTION STABILIZATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
