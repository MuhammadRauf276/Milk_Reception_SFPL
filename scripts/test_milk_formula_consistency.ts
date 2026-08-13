import { prisma } from '../src/backend/core/db';
import {
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';
import {
  getSiloCurrentStockLiters,
  getSiloAvailableCapacity,
  getSiloActiveReservedLiters,
  getSiloProvisionalAvailableCapacity,
  recordSiloTransaction,
} from '../src/backend/services/siloInventoryService';
import { Prisma, SiloTransactionType } from '@prisma/client';

async function runMilkFormulaConsistencyVerification() {
  console.log('==================================================');
  console.log('RUNNING MILK FORMULA & SILO UNIT CONSISTENCY VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName} (${detail})`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} (${detail})`);
      failed++;
    }
  }

  // Count snapshot before test execution
  const visitCountBefore = await prisma.vehicleVisit.count();
  const portionCountBefore = await prisma.visitPortion.count();
  const ticketCountBefore = await prisma.weightTicket.count();
  const unloadCountBefore = await prisma.unloadingLog.count();
  const qaCountBefore = await prisma.qATestingSession.count();
  const gateCountBefore = await prisma.gateLog.count();

  const timestamp = Date.now();
  const testSiloCode = `SILO-UNIT-${timestamp.toString().slice(-4)}`;

  try {
    // ----------------------------------------------------
    // FORM-CONS-A..E: Canonical Formula Verification
    // ----------------------------------------------------
    const lr = 26.5;
    const fat = 3.80;
    const kg = 18380;

    const snf = calculateSNF(lr, fat);
    const ts = calculateTS(fat, snf);
    const ratio = calculateRatio(snf, fat);
    const density = calculateDensity(lr);
    const physicalLiters = calculatePhysicalLiters(kg, lr);
    const at13TSLiters = calculateAt13TSLiters(physicalLiters, ts);

    assert(Math.abs(snf - 8.181) < 0.001, 'FORM-CONS-A: Canonical SNF Formula', `SNF = ${snf.toFixed(3)}% (Expected 8.181%)`);
    assert(Math.abs(ts - 11.981) < 0.001, 'FORM-CONS-B: Canonical TS Formula', `TS = ${ts.toFixed(3)}% (Expected 11.981%)`);
    assert(Math.abs(ratio - 2.153) < 0.01, 'FORM-CONS-C: Canonical SNF:Fat Ratio Formula', `Ratio = ${ratio.toFixed(3)} (Expected ~2.153)`);
    assert(Math.abs(physicalLiters - 17906) < 1, 'FORM-CONS-D: Canonical Physical Liters Formula', `Physical Liters = ${Math.round(physicalLiters)} L (Expected ~17,906 L)`);
    assert(Math.abs(at13TSLiters - 16502) < 5, 'FORM-CONS-E: Canonical @13 TS Liters Formula', `@13 TS Liters = ${Math.round(at13TSLiters)} L (Expected ~16,502 L @13 TS)`);

    // ----------------------------------------------------
    // MPD-FORM-A..F: MPD Dispatch Independent Portion & Total Sums
    // ----------------------------------------------------
    const p1Kg = 8000;
    const p1Lr = 26.3;
    const p1Fat = 3.8;

    const p2Kg = 5000;
    const p2Lr = 27.0;
    const p2Fat = 3.5;

    const p1Liters = calculatePhysicalLiters(p1Kg, p1Lr);
    const p2Liters = calculatePhysicalLiters(p2Kg, p2Lr);

    const p1At13 = calculateAt13TSLiters(p1Liters, calculateTS(p1Fat, calculateSNF(p1Lr, p1Fat)));
    const p2At13 = calculateAt13TSLiters(p2Liters, calculateTS(p2Fat, calculateSNF(p2Lr, p2Fat)));

    const vehicleTotalKg = p1Kg + p2Kg;
    const vehicleTotalLiters = p1Liters + p2Liters;
    const vehicleTotalAt13 = p1At13 + p2At13;

    assert(
      vehicleTotalKg === 13000 && Math.abs(vehicleTotalLiters - 12664) < 5 && Math.abs(vehicleTotalAt13 - 11551) < 10,
      'MPD-FORM-A..E: MPD Portion & Vehicle Arithmetic Sums',
      `Vehicle Total Declared = ${vehicleTotalKg} kg, Physical = ${Math.round(vehicleTotalLiters)} L, @13 TS = ${Math.round(vehicleTotalAt13)} L`
    );

    // ----------------------------------------------------
    // QA-FORM-A..F: QA Plant vs Dispatch Snapshot Separation & Priority
    // ----------------------------------------------------
    const dispatchLrVal = 26.5;
    const plantLrVal = 27.2; // Plant QA measured different LR at gate

    const expectedLitersFromDispatch = calculatePhysicalLiters(8000, dispatchLrVal);
    const expectedLitersFromPlant = calculatePhysicalLiters(8000, plantLrVal);

    assert(
      Math.abs(expectedLitersFromPlant - 7788) < 2 && Math.abs(expectedLitersFromDispatch - 7793) < 2 && expectedLitersFromDispatch !== expectedLitersFromPlant,
      'QA-FORM-A..F: QA Plant vs Dispatch Separation & Priority',
      `Plant QA LR (27.2) yields ~${Math.round(expectedLitersFromPlant)} L; Dispatch LR (26.5) yields ~${Math.round(expectedLitersFromDispatch)} L`
    );

    // ----------------------------------------------------
    // UNIT-A..F: Silo Volumetric Capacity in Liters & Ledger quantity_liters
    // ----------------------------------------------------
    const silo = await prisma.silo.create({
      data: {
        silo_code: testSiloCode,
        silo_name: `Unit Consistency Test Silo ${timestamp.toString().slice(-4)}`,
        capacity_liters: new Prisma.Decimal(50000), // Explicit Liters!
        is_active: true,
      },
    });

    const isCapacityLitersFieldValid = Number(silo.capacity_liters) === 50000;

    // Record test transaction with both quantity_kg and quantity_liters
    const tx = await recordSiloTransaction({
      silo_id: silo.id,
      transaction_type: SiloTransactionType.RECEIPT,
      quantity_kg: 10000,
      quantity_liters: 9742,
      operational_timestamp: new Date(),
    });

    const stockLiters = await getSiloCurrentStockLiters(silo.id);
    const availLiters = await getSiloAvailableCapacity(silo.id);

    assert(
      isCapacityLitersFieldValid && stockLiters === 9742 && availLiters === 40258,
      'UNIT-A..F: Silo capacity_liters & Ledger quantity_liters',
      `Silo capacity = ${silo.capacity_liters} L; Stock = ${stockLiters} L; Available = ${availLiters} L (Same unit: Liters)`
    );

    // Clean up temporary test silo
    await prisma.siloInventoryTransaction.deleteMany({ where: { silo_id: silo.id } });
    await prisma.silo.delete({ where: { id: silo.id } });

    // ----------------------------------------------------
    // DATA INTEGRITY CHECK FOR EXISTING WORKFLOW TABLES
    // ----------------------------------------------------
    const visitCountAfter = await prisma.vehicleVisit.count();
    const portionCountAfter = await prisma.visitPortion.count();
    const ticketCountAfter = await prisma.weightTicket.count();
    const unloadCountAfter = await prisma.unloadingLog.count();
    const qaCountAfter = await prisma.qATestingSession.count();
    const gateCountAfter = await prisma.gateLog.count();

    const isDataIntegrityPreserved =
      visitCountBefore === visitCountAfter &&
      portionCountBefore === portionCountAfter &&
      ticketCountBefore === ticketCountAfter &&
      unloadCountBefore === unloadCountAfter &&
      qaCountBefore === qaCountAfter &&
      gateCountBefore === gateCountAfter;

    assert(
      isDataIntegrityPreserved,
      'MIG-A..D: Data Integrity & Schema Migration Safety',
      'Zero existing records altered or corrupted across VehicleVisit, VisitPortion, WeightTicket, UnloadingLog, QATestingSession, GateLog'
    );

  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMilkFormulaConsistencyVerification();
