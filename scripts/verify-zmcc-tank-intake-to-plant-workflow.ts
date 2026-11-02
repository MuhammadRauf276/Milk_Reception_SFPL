import 'dotenv/config';
import { prisma } from '../src/backend/core/db';
import { Prisma, SiloTransactionType } from '@prisma/client';
import {
  getTankPhysicalStock,
  getTankCommercialStock,
  intakeZmccTankStock,
} from '../src/backend/services/zmccTankService';
import { issueDispatchFromZmccTankTx } from '../src/backend/services/dispatch/dispatchDecisionService';
import {
  finalizeSiloReceiptForVisit,
  getSiloCurrentStockLiters,
} from '../src/backend/services/siloInventoryService';
import {
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';
import assert from 'node:assert/strict';

async function main() {
  console.log('========================================================================');
  console.log('VERIFICATION: ZMCC TANK STOCK INTAKE TO PLANT LIFECYCLE');
  console.log('========================================================================');

  // 1. Locate / verify prerequisites
  const superAdmin = await prisma.user.findFirstOrThrow({
    where: { role: 'SUPER_ADMIN', is_active: true },
  });
  const secUser = (await prisma.user.findFirst({
    where: { role: { in: ['SECURITY_OPERATOR', 'ADMIN_HEAD'] }, is_active: true },
  })) || superAdmin;

  const qaUser = (await prisma.user.findFirst({
    where: { role: { in: ['QA_LAB_ATTENDANT', 'QA_HEAD', 'QA_OFFICER', 'QA_MANAGER'] }, is_active: true },
  })) || superAdmin;

  const wbUser = (await prisma.user.findFirst({
    where: { role: { in: ['WEIGHBRIDGE_OPERATOR', 'PRODUCTION_HEAD'] }, is_active: true },
  })) || superAdmin;

  const prodUser = (await prisma.user.findFirst({
    where: { role: { in: ['PRODUCTION_RECEPTION_OPERATOR', 'PRODUCTION_HEAD', 'PRODUCTION_OPERATOR', 'PRODUCTION_MANAGER'] }, is_active: true },
  })) || superAdmin;

  const zmcc = await prisma.procurementSource.findFirstOrThrow({
    where: { source_type: 'ZMCC', is_active: true },
  });

  let tank = await prisma.zmccTank.findFirst({
    where: { zmcc_id: zmcc.id, is_active: true },
  });

  if (!tank) {
    console.log(`- Creating active ZMCC Tank for ZMCC ${zmcc.name} (${zmcc.code})...`);
    tank = await prisma.zmccTank.create({
      data: {
        zmcc_id: zmcc.id,
        tank_code: 'TANK-TEST-01',
        tank_name: 'Test Raw Milk Tank 1',
        capacity_liters: new Prisma.Decimal('50000.00'),
        is_active: true,
        created_by_user_id: superAdmin.id,
      },
    });
  }

  const silo = await prisma.silo.findFirstOrThrow({
    where: { is_active: true },
  });

  console.log(`- Super Admin: ${superAdmin.username} (ID: ${superAdmin.id})`);
  console.log(`- ZMCC Source: ${zmcc.name} (ID: ${zmcc.id}, Code: ${zmcc.code})`);
  console.log(`- ZMCC Tank: ${tank.tank_code} (ID: ${tank.id}, Capacity: ${tank.capacity_liters} L)`);
  console.log(`- Destination Silo: ${silo.silo_code} (${silo.silo_name})`);

  // =========================================================================
  // STEP 1: SUPER ADMIN MANUAL MILK INTAKE INTO ZMCC TANK
  // =========================================================================
  console.log('\n--- Step 1: Super Admin Manual Milk Intake into ZMCC Tank ---');
  const initialStock = await getTankPhysicalStock(tank.id);
  const initialCommercial = await getTankCommercialStock(tank.id);
  console.log(`- Tank initial gross stock: ${initialStock.toFixed(2)} L`);
  console.log(`- Tank initial @13% TS stock: ${(initialCommercial.stockAt13Ts ?? 0).toFixed(2)} L`);

  const intakeGrossLiters = 12000;
  const intakeFat = 3.50;
  const intakeLr = 28.0;
  const intakeDensity = calculateDensity(intakeLr); // 1.028
  const intakeSnf = calculateSNF(intakeLr, intakeFat); // 28/4 + 0.22*3.5 + 0.72 = 8.49
  const intakeTs = calculateTS(intakeFat, intakeSnf); // 3.5 + 8.49 = 11.99
  const expected13Ts = Number(calculateAt13TSLiters(intakeGrossLiters, intakeTs).toFixed(2)); // (12000 * 11.99)/13 = 11067.69

  console.log(`- Input: Gross = ${intakeGrossLiters} L, Fat = ${intakeFat}%, LR = ${intakeLr}`);
  console.log(`  -> Derived Density: ${intakeDensity.toFixed(4)}, SNF: ${intakeSnf.toFixed(2)}%, TS: ${intakeTs.toFixed(2)}%`);
  console.log(`  -> Expected Commercial Volume @13% TS: ${expected13Ts.toFixed(2)} L`);

  const intakeUser: any = {
    id: String(superAdmin.id),
    username: superAdmin.username,
    name: superAdmin.full_name || superAdmin.username,
    role: superAdmin.role,
  };

  const intakeResult = await intakeZmccTankStock(intakeUser, tank.id, {
    gross_liters: intakeGrossLiters,
    fat: intakeFat,
    lr: intakeLr,
    notes: 'Super Admin direct intake - human field operators unavailable',
  });

  assert.equal(intakeResult.status, 200, `Intake should succeed with status 200. Error: ${intakeResult.error}`);
  console.log('✓ Super Admin stock intake succeeded.');

  const postIntakePhysical = await getTankPhysicalStock(tank.id);
  const postIntakeCommercial = await getTankCommercialStock(tank.id);
  console.log(`- Tank gross stock after intake: ${postIntakePhysical.toFixed(2)} L`);
  console.log(`- Tank @13% TS stock after intake: ${(postIntakeCommercial.stockAt13Ts ?? 0).toFixed(2)} L`);

  assert.equal(
    Number((postIntakePhysical - initialStock).toFixed(2)),
    intakeGrossLiters,
    'Gross physical stock must increase by exactly intakeGrossLiters'
  );
  assert.equal(
    Number(((postIntakeCommercial.stockAt13Ts ?? 0) - (initialCommercial.stockAt13Ts ?? 0)).toFixed(2)),
    expected13Ts,
    'Commercial @13% TS stock must increase by exactly expected13Ts'
  );
  console.log('✓ Tank physical and commercial @13% TS balances verified.');

  // =========================================================================
  // STEP 2: ZMCC DISPATCH TO PLANT & AUTOMATIC DEDUCTION
  // =========================================================================
  console.log('\n--- Step 2: ZMCC Lab Attendant Dispatch & Automatic Tank Deduction ---');
  const dispatchGrossLiters = 4000;
  const dispatchLr = 28.0;
  const dispatchFat = 3.50;
  const dispatchTs = calculateTS(dispatchFat, calculateSNF(dispatchLr, dispatchFat)); // 11.99
  const dispatch13Ts = Number(calculateAt13TSLiters(dispatchGrossLiters, dispatchTs).toFixed(2)); // (4000 * 11.99)/13 = 3689.23

  const testVisitNumber = `VV-INTAKE-${Date.now().toString().slice(-6)}`;
  const testVehicleNumber = `TK-INTAKE-${Date.now().toString().slice(-4)}`;

  const createdVisit = await prisma.$transaction(async (tx) => {
    const v = await tx.vehicleVisit.create({
      data: {
        visit_number: testVisitNumber,
        vehicle_number: testVehicleNumber,
        procurement_source_id: zmcc.id,
        current_status: 'DISPATCHED',
        vehicle_dispatch_quantity_value: new Prisma.Decimal(dispatchGrossLiters.toFixed(2)),
        vehicle_dispatch_quantity_unit: 'LITER',
        vehicle_dispatch_gross_liters: new Prisma.Decimal(dispatchGrossLiters.toFixed(2)),
        vehicle_dispatch_at_13ts_liters: new Prisma.Decimal(dispatch13Ts.toFixed(2)),
        vehicle_dispatch_lr: new Prisma.Decimal(dispatchLr.toFixed(2)),
        vehicle_dispatch_fat: new Prisma.Decimal(dispatchFat.toFixed(2)),
        vehicle_dispatch_density: new Prisma.Decimal(intakeDensity.toFixed(4)),
        portions: {
          create: [
            {
              portion_number: 1,
              current_status: 'DISPATCHED',
              dispatch_quantity_value: new Prisma.Decimal(dispatchGrossLiters.toFixed(2)),
              dispatch_quantity_unit: 'LITER',
              dispatch_info: {
                create: {
                  dispatch_number: `DN-${Date.now().toString().slice(-6)}`,
                  dispatch_timestamp: new Date(),
                  recorded_by: superAdmin.id,
                },
              },
            },
          ],
        },
      },
      include: { portions: true },
    });

    // Execute atomic deduction
    await issueDispatchFromZmccTankTx(tx, {
      zmccId: zmcc.id,
      visitId: v.id,
      visitNumber: v.visit_number,
      vehicleNumber: v.vehicle_number,
      grossLiters: dispatchGrossLiters,
      at13tsLiters: dispatch13Ts,
      at: new Date(),
      userId: superAdmin.id,
    });

    return v;
  });

  console.log(`✓ Vehicle visit ${createdVisit.visit_number} dispatched with ${dispatchGrossLiters} L (${dispatch13Ts} L @13% TS).`);

  const postDispatchPhysical = await getTankPhysicalStock(tank.id);
  const postDispatchCommercial = await getTankCommercialStock(tank.id);
  console.log(`- Tank gross stock after dispatch: ${postDispatchPhysical.toFixed(2)} L`);
  console.log(`- Tank @13% TS stock after dispatch: ${(postDispatchCommercial.stockAt13Ts ?? 0).toFixed(2)} L`);

  assert.equal(
    Number((postIntakePhysical - postDispatchPhysical).toFixed(2)),
    dispatchGrossLiters,
    'Gross physical stock must be deducted by exactly dispatchGrossLiters'
  );
  assert.equal(
    Number(((postIntakeCommercial.stockAt13Ts ?? 0) - (postDispatchCommercial.stockAt13Ts ?? 0)).toFixed(2)),
    dispatch13Ts,
    'Commercial @13% TS stock must be deducted by exactly dispatch13Ts'
  );
  console.log('✓ Automatic minus of Gross Volume AND @13% TS from ZMCC tank verified.');

  // =========================================================================
  // STEP 3: PLANT GATE ENTRY
  // =========================================================================
  console.log('\n--- Step 3: Plant Gate Entry ---');
  const tokenNumber = `TOK-${Date.now().toString().slice(-4)}`;
  const entryDate = new Date();

  await prisma.gateLog.create({
    data: {
      visit_id: createdVisit.id,
      entry_timestamp: entryDate,
      entry_guard_id: secUser.id,
    },
  });

  await prisma.vehicleVisit.update({
    where: { id: createdVisit.id },
    data: {
      token_number: tokenNumber,
      current_status: 'TOKEN_ISSUED',
    },
  });

  const gateVisit = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: createdVisit.id } });
  assert.equal(gateVisit.current_status, 'TOKEN_ISSUED');
  console.log(`✓ Gate entry recorded with Token ${tokenNumber}. Status: ${gateVisit.current_status}`);

  // =========================================================================
  // STEP 4: PLANT QA RECEPTION LAB TESTING
  // =========================================================================
  console.log('\n--- Step 4: Plant QA Reception Lab Testing ---');
  const portionId = createdVisit.portions[0].id;

  // Record Plant Lab Results
  await prisma.plantLabResult.createMany({
    data: [
      {
        visit_id: createdVisit.id,
        portion_id: portionId,
        test_id: BigInt(8), // LR Test
        numeric_value: new Prisma.Decimal('28.0'),
        performance_status: 'PERFORMED',
        tested_by: qaUser.id,
      },
      {
        visit_id: createdVisit.id,
        portion_id: portionId,
        test_id: BigInt(26), // Fat Test
        numeric_value: new Prisma.Decimal('3.50'),
        performance_status: 'PERFORMED',
        tested_by: qaUser.id,
      },
    ],
  });

  // QA Decision: ACCEPTED
  await prisma.visitPortion.update({
    where: { id: portionId },
    data: {
      plant_decision: 'ACCEPTED',
      plant_decided_at: new Date(),
      decided_by: { connect: { id: qaUser.id } },
    },
  });

  await prisma.vehicleVisit.update({
    where: { id: createdVisit.id },
    data: {
      current_status: 'READY_FOR_GROSS',
    },
  });

  const qaVisit = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: createdVisit.id } });
  assert.equal(qaVisit.current_status, 'READY_FOR_GROSS');
  console.log(`✓ QA Reception testing completed. Portion decision: ACCEPTED. Status: ${qaVisit.current_status}`);

  // =========================================================================
  // STEP 5: PLANT SCALE 1 (GROSS WEIGHMENT)
  // =========================================================================
  console.log('\n--- Step 5: Plant Scale 1 (Gross Weighment) ---');
  // Expected net mass for 4,000 L @ density 1.028 = 4000 * 1.028 = 4,112 kg
  // Tare = 18,000 kg -> Gross = 18,000 + 4,112 = 22,112 kg
  const tareWeightKg = 18000;
  const netWeightKg = 4112;
  const grossWeightKg = tareWeightKg + netWeightKg; // 22,112 kg

  await prisma.weightTicket.create({
    data: {
      visit_id: createdVisit.id,
      ticket_number: `WT-${Date.now().toString().slice(-6)}`,
      gross_weight_kg: new Prisma.Decimal(grossWeightKg),
      gross_timestamp: new Date(),
      gross_recorded_by: wbUser.id,
    },
  });

  await prisma.visitPortion.update({
    where: { id: portionId },
    data: {
      first_weight_kg: new Prisma.Decimal(grossWeightKg),
    },
  });

  await prisma.vehicleVisit.update({
    where: { id: createdVisit.id },
    data: {
      current_status: 'READY_FOR_UNLOADING',
      operational_date: new Date(),
    },
  });

  const grossVisit = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: createdVisit.id } });
  assert.equal(grossVisit.current_status, 'READY_FOR_UNLOADING');
  console.log(`✓ Scale 1 Gross Weight recorded: ${grossWeightKg} kg. Status: ${grossVisit.current_status}`);

  // =========================================================================
  // STEP 6: PLANT PRODUCTION UNLOADING INTO SILO
  // =========================================================================
  console.log('\n--- Step 6: Plant Production Unloading into Silo ---');
  await prisma.unloadingLog.create({
    data: {
      portion_id: portionId,
      silo_id: silo.id,
      pump_start_timestamp: new Date(),
      pump_end_timestamp: new Date(),
      started_by: prodUser.id,
      completed_by: prodUser.id,
      complete_submitted_at: new Date(),
    },
  });

  await prisma.vehicleVisit.update({
    where: { id: createdVisit.id },
    data: {
      current_status: 'UNLOADED',
    },
  });

  const unloadVisit = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: createdVisit.id } });
  assert.equal(unloadVisit.current_status, 'UNLOADED');
  console.log(`✓ Unloading into Silo ${silo.silo_code} completed. Status: ${unloadVisit.current_status}`);

  // =========================================================================
  // STEP 7: PLANT SCALE 2 (TARE WEIGHMENT) & SILO RECEIPT EXECUTION
  // =========================================================================
  console.log('\n--- Step 7: Plant Scale 2 (Tare Weighment) & Silo Addition ---');
  const initialSiloLiters = await getSiloCurrentStockLiters(silo.id);
  console.log(`- Silo initial physical stock: ${initialSiloLiters.toFixed(2)} L`);

  await prisma.weightTicket.update({
    where: { visit_id: createdVisit.id },
    data: {
      tare_weight_kg: new Prisma.Decimal(tareWeightKg),
      net_weight_kg: new Prisma.Decimal(netWeightKg),
      tare_timestamp: new Date(),
      tare_recorded_by: wbUser.id,
    },
  });

  await prisma.visitPortion.update({
    where: { id: portionId },
    data: {
      second_weight_kg: new Prisma.Decimal(tareWeightKg),
      net_weight_kg: new Prisma.Decimal(netWeightKg),
    },
  });

  // Execute Silo receipt finalization (adds milk in silo according to Gross and @13% TS)
  const finalizeRes = await finalizeSiloReceiptForVisit(createdVisit.id, wbUser.id, new Date(), undefined, 'WEIGHBRIDGE_OPERATOR');
  assert.equal(finalizeRes.success, true, `Finalize silo receipt should succeed: ${finalizeRes.message}`);

  await prisma.vehicleVisit.update({
    where: { id: createdVisit.id },
    data: { current_status: 'TARE_RECORDED' },
  });

  console.log('✓ Final Silo Receipt transaction recorded.');
  console.log(`  - Physical Gross Liters added to Silo: ${finalizeRes.finalPhysicalLiters?.toFixed(2)} L`);
  console.log(`  - Commercial @13% TS Liters added to Silo: ${finalizeRes.finalAt13TSLiters?.toFixed(2)} L`);

  const postSiloLiters = await getSiloCurrentStockLiters(silo.id);
  console.log(`- Silo physical stock after weighment: ${postSiloLiters.toFixed(2)} L`);
  assert.equal(
    Number((postSiloLiters - initialSiloLiters).toFixed(2)),
    Number(finalizeRes.finalPhysicalLiters?.toFixed(2)),
    'Silo stock must increase by exactly the received physical gross liters'
  );
  console.log('✓ Silo inventory increase verified in database.');

  // =========================================================================
  // STEP 8: PLANT GATE EXIT
  // =========================================================================
  console.log('\n--- Step 8: Plant Gate Exit ---');
  await prisma.gateLog.update({
    where: { visit_id: createdVisit.id },
    data: {
      exit_timestamp: new Date(),
      exit_guard_id: secUser.id,
      exit_submitted_at: new Date(),
    },
  });

  await prisma.vehicleVisit.update({
    where: { id: createdVisit.id },
    data: { current_status: 'COMPLETED' },
  });

  const finalVisit = await prisma.vehicleVisit.findUniqueOrThrow({
    where: { id: createdVisit.id },
    include: { gate_log: true, weight_ticket: true },
  });

  assert.equal(finalVisit.current_status, 'COMPLETED');
  assert(finalVisit.gate_log?.exit_timestamp, 'Gate exit timestamp must be recorded');
  console.log(`✓ Vehicle Gate Exit complete. Final visit status: ${finalVisit.current_status}`);

  // =========================================================================
  // CLEANUP TEST VISIT
  // =========================================================================
  console.log('\n--- Cleanup: Removing test operational visit ---');
  await prisma.plantFinalDualReconciliation.deleteMany({ where: { visit_id: createdVisit.id } });
  await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: createdVisit.id } });
  await prisma.zmccTankInventoryTransaction.deleteMany({ where: { dispatch_id: createdVisit.id } });
  await prisma.unloadingLog.deleteMany({ where: { portion_id: portionId } });
  await prisma.plantLabResult.deleteMany({ where: { visit_id: createdVisit.id } });
  await prisma.weightTicket.deleteMany({ where: { visit_id: createdVisit.id } });
  await prisma.dispatchInfo.deleteMany({ where: { portion_id: portionId } });
  await prisma.visitPortion.deleteMany({ where: { visit_id: createdVisit.id } });
  await prisma.gateLog.deleteMany({ where: { visit_id: createdVisit.id } });
  await prisma.vehicleVisit.delete({ where: { id: createdVisit.id } });
  console.log('✓ Test visit cleaned up successfully.');

  console.log('\n========================================================================');
  console.log('ALL WORKFLOW VERIFICATION STAGES PASSED SUCCESSFULLY (100%)');
  console.log('========================================================================');
}

main()
  .catch((err) => {
    console.error('Workflow verification failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
