import { prisma } from '../src/backend/core/db';
import { Prisma, SiloTransactionType } from '@prisma/client';
import { finalizeSiloReceiptForVisit, getSiloCurrentStockLiters } from '../src/backend/services/siloInventoryService';
import { calculateVehicleReceivedQuantity } from '../src/backend/services/vehicleQuantityService';
import { calculatePhysicalLiters, calculateAt13TSLiters, calculateTS, calculateSNF } from '../src/backend/utils/milkFormulas';
import fs from 'fs';
import path from 'path';

async function runChunk5IntegrationTests() {
  console.log('==================================================');
  console.log('RUNNING CHUNK 5: AUTHORITATIVE FINAL RECEIPT INTEGRATION (CASES A-P)');
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

  const wbUser = await prisma.user.findFirst({
    where: { role: { in: ['WEIGHBRIDGE_OPERATOR', 'Weighbridge_Operator', 'Admin'] } },
  });
  if (!wbUser) throw new Error('Weighbridge operator user not found');

  const contractorSource = await prisma.procurementSource.findFirst({ where: { source_type: 'CONTRACTOR' } });
  if (!contractorSource) throw new Error('Contractor source not found');

  const lrTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000008' } });
  const fatTest = await prisma.labTest.findFirst({ where: { testCode: 'LT-000026' } });
  if (!lrTest || !fatTest) throw new Error('Lab tests LT-000008 and LT-000026 required');

  const timestamp = Date.now();

  // Create isolated test silos
  const siloA = await prisma.silo.create({
    data: {
      silo_code: `S-A-${timestamp.toString().slice(-4)}`,
      silo_name: `Test Silo A ${timestamp}`,
      capacity_liters: new Prisma.Decimal(100000),
      is_active: true,
    },
  });

  const siloB = await prisma.silo.create({
    data: {
      silo_code: `S-B-${timestamp.toString().slice(-4)}`,
      silo_name: `Test Silo B ${timestamp}`,
      capacity_liters: new Prisma.Decimal(100000),
      is_active: true,
    },
  });

  const createdVisits: bigint[] = [];

  try {
    // ----------------------------------------------------
    // CASE A: Single accepted portion
    // ----------------------------------------------------
    console.log('--- CASE A: Single accepted portion ---');
    const visitA = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-A-${timestamp}`,
        vehicle_number: `TL-CASE-A`,
        token_number: `TK-A`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-A-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(32000),
            tare_weight_kg: new Prisma.Decimal(17000),
            net_weight_kg: new Prisma.Decimal(15000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [
            {
              portion_number: 1,
              dispatch_quantity_value: 15000,
              dispatch_quantity_unit: 'KG',
              plant_decision: 'ACCEPTED',
              current_status: 'UNLOADED',
            },
          ],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitA.id);

    const pA = visitA.portions[0];
    await prisma.unloadingLog.create({
      data: {
        portion_id: pA.id,
        silo_id: siloA.id,
        silo_number: siloA.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });

    await prisma.plantLabResult.createMany({
      data: [
        {
          visit_id: visitA.id,
          portion_id: pA.id,
          test_id: lrTest.id,
          performance_status: 'PERFORMED',
          numeric_value: new Prisma.Decimal(28.0),
          is_passed: true,
          tested_by: wbUser.id,
        },
        {
          visit_id: visitA.id,
          portion_id: pA.id,
          test_id: fatTest.id,
          performance_status: 'PERFORMED',
          numeric_value: new Prisma.Decimal(3.8),
          is_passed: true,
          tested_by: wbUser.id,
        },
      ],
    });

    const resA = await finalizeSiloReceiptForVisit(visitA.id, wbUser.id);
    const txA = await prisma.siloInventoryTransaction.findFirst({
      where: { visit_id: visitA.id, transaction_type: SiloTransactionType.RECEIPT },
    });

    // 15,000 / 1.028 = 14591.439688715953 L
    const expectedLitA = 15000 / 1.028;
    assert(
      resA.success && resA.receiptCreated && Math.abs((resA.finalPhysicalLiters || 0) - expectedLitA) < 0.01,
      'Case A: Final physical liters from engine',
      `Got ${resA.finalPhysicalLiters}, expected ${expectedLitA.toFixed(2)}`
    );
    assert(
      txA !== null && Number(txA.quantity_kg) === 15000 && Math.abs(Number(txA.quantity_liters) - expectedLitA) < 0.01,
      'Case A: Silo RECEIPT quantity_kg and quantity_liters',
      `Silo transaction posted kg=${txA?.quantity_kg}, liters=${txA?.quantity_liters}`
    );

    // ----------------------------------------------------
    // CASE B: Two accepted portions with different QA (P1 LR 27/Fat 3.5, P2 LR 29/Fat 3.9)
    // ----------------------------------------------------
    console.log('\n--- CASE B: Two accepted portions with different QA ---');
    const visitB = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-B-${timestamp}`,
        vehicle_number: `TL-CASE-B`,
        token_number: `TK-B`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-B-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [
            {
              portion_number: 1,
              dispatch_quantity_value: 5000,
              dispatch_quantity_unit: 'KG',
              plant_decision: 'ACCEPTED',
              current_status: 'UNLOADED',
            },
            {
              portion_number: 2,
              dispatch_quantity_value: 5000,
              dispatch_quantity_unit: 'KG',
              plant_decision: 'ACCEPTED',
              current_status: 'UNLOADED',
            },
          ],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitB.id);

    for (const p of visitB.portions) {
      await prisma.unloadingLog.create({
        data: {
          portion_id: p.id,
          silo_id: siloA.id,
          silo_number: siloA.silo_code,
          pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
          pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
          started_by: wbUser.id,
          completed_by: wbUser.id,
        },
      });
    }

    const pB1 = visitB.portions[0];
    const pB2 = visitB.portions[1];

    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visitB.id, portion_id: pB1.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(27.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitB.id, portion_id: pB1.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.5), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitB.id, portion_id: pB2.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(29.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitB.id, portion_id: pB2.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.9), is_passed: true, tested_by: wbUser.id },
      ],
    });

    const resB = await finalizeSiloReceiptForVisit(visitB.id, wbUser.id);
    // Avg LR = (27 + 29) / 2 = 28.0 -> density = 1.028 -> 10,000 / 1.028 = 9727.626459143968 L
    const expectedLitB = 10000 / 1.028;
    assert(
      resB.success && Math.abs((resB.finalPhysicalLiters || 0) - expectedLitB) < 0.01,
      'Case B: Arithmetic average LR basis across 2 portions',
      `Got ${resB.finalPhysicalLiters}, expected ${expectedLitB.toFixed(2)} (no first-LR 27 basis)`
    );

    // ----------------------------------------------------
    // CASE C: Two accepted + one rejected extreme
    // ----------------------------------------------------
    console.log('\n--- CASE C: Two accepted + one rejected extreme ---');
    const visitC = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-C-${timestamp}`,
        vehicle_number: `TL-CASE-C`,
        token_number: `TK-C`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-C-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [
            { portion_number: 1, dispatch_quantity_value: 5000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' },
            { portion_number: 2, dispatch_quantity_value: 5000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' },
            { portion_number: 3, dispatch_quantity_value: 5000, plant_decision: 'REJECTED', plant_rejection_reason: 'High LR', current_status: 'REJECTED' },
          ],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitC.id);

    const pC1 = visitC.portions[0];
    const pC2 = visitC.portions[1];
    const pC3 = visitC.portions[2];

    for (const p of [pC1, pC2]) {
      await prisma.unloadingLog.create({
        data: {
          portion_id: p.id,
          silo_id: siloA.id,
          silo_number: siloA.silo_code,
          pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
          pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
          started_by: wbUser.id,
          completed_by: wbUser.id,
        },
      });
    }

    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visitC.id, portion_id: pC1.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(27.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitC.id, portion_id: pC1.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.5), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitC.id, portion_id: pC2.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(29.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitC.id, portion_id: pC2.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.9), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitC.id, portion_id: pC3.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(100.0), is_passed: false, tested_by: wbUser.id },
        { visit_id: visitC.id, portion_id: pC3.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(20.0), is_passed: false, tested_by: wbUser.id },
      ],
    });

    const resC = await finalizeSiloReceiptForVisit(visitC.id, wbUser.id);
    assert(
      resC.success && Math.abs((resC.finalPhysicalLiters || 0) - expectedLitB) < 0.01,
      'Case C: Rejected portion extreme values completely excluded',
      `Got ${resC.finalPhysicalLiters}, exactly matches Case B ${expectedLitB.toFixed(2)}`
    );

    // ----------------------------------------------------
    // CASE D: First-LR regression proof (P1 LR 20, P2 LR 40)
    // ----------------------------------------------------
    console.log('\n--- CASE D: First-LR regression proof ---');
    const visitD = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-D-${timestamp}`,
        vehicle_number: `TL-CASE-D`,
        token_number: `TK-D`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-D-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [
            { portion_number: 1, dispatch_quantity_value: 5000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' },
            { portion_number: 2, dispatch_quantity_value: 5000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' },
          ],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitD.id);

    for (const p of visitD.portions) {
      await prisma.unloadingLog.create({
        data: {
          portion_id: p.id,
          silo_id: siloA.id,
          silo_number: siloA.silo_code,
          pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
          pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
          started_by: wbUser.id,
          completed_by: wbUser.id,
        },
      });
    }

    const pD1 = visitD.portions[0];
    const pD2 = visitD.portions[1];

    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visitD.id, portion_id: pD1.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(20.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitD.id, portion_id: pD1.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitD.id, portion_id: pD2.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(40.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitD.id, portion_id: pD2.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
      ],
    });

    const resD = await finalizeSiloReceiptForVisit(visitD.id, wbUser.id);
    // Avg LR = (20 + 40) / 2 = 30.0 -> Density = 1.030 -> 10,000 / 1.030 = 9708.73786407767 L
    // First-LR would have been 10,000 / 1.020 = 9803.92 L
    const expectedLitD = 10000 / 1.030;
    const oldFirstLrLitD = 10000 / 1.020;
    assert(
      resD.success && Math.abs((resD.finalPhysicalLiters || 0) - expectedLitD) < 0.01 && Math.abs((resD.finalPhysicalLiters || 0) - oldFirstLrLitD) > 50,
      'Case D: First-LR superseded by arithmetic basis LR (30 vs 20)',
      `Got ${resD.finalPhysicalLiters}, expected ${expectedLitD.toFixed(2)}, strictly distinct from legacy ${oldFirstLrLitD.toFixed(2)}`
    );

    // ----------------------------------------------------
    // CASE E: Contractor declaration unit independence (KG vs LITER)
    // ----------------------------------------------------
    console.log('\n--- CASE E: Contractor declaration unit independence ---');
    const visitE_KG = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-E-KG-${timestamp}`,
        vehicle_number: `TL-CASE-E-KG`,
        token_number: `TK-EKG`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-EKG-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 10000, dispatch_quantity_unit: 'KG', plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitE_KG.id);

    const visitE_L = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-E-L-${timestamp}`,
        vehicle_number: `TL-CASE-E-L`,
        token_number: `TK-EL`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-EL-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 9728, dispatch_quantity_unit: 'LITER', plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitE_L.id);

    for (const v of [visitE_KG, visitE_L]) {
      const p = v.portions[0];
      await prisma.unloadingLog.create({
        data: {
          portion_id: p.id,
          silo_id: siloA.id,
          silo_number: siloA.silo_code,
          pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
          pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
          started_by: wbUser.id,
          completed_by: wbUser.id,
        },
      });
      await prisma.plantLabResult.createMany({
        data: [
          { visit_id: v.id, portion_id: p.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(28.0), is_passed: true, tested_by: wbUser.id },
          { visit_id: v.id, portion_id: p.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
        ],
      });
    }

    const resE_KG = await finalizeSiloReceiptForVisit(visitE_KG.id, wbUser.id);
    const resE_L = await finalizeSiloReceiptForVisit(visitE_L.id, wbUser.id);

    assert(
      resE_KG.success && resE_L.success && Math.abs((resE_KG.finalPhysicalLiters || 0) - (resE_L.finalPhysicalLiters || 0)) < 0.0001,
      'Case E: Contractor declaration unit independence',
      `KG final liters (${resE_KG.finalPhysicalLiters}) == LITER final liters (${resE_L.finalPhysicalLiters})`
    );

    // ----------------------------------------------------
    // CASE F: Missing Plant LR
    // ----------------------------------------------------
    console.log('\n--- CASE F: Missing Plant LR ---');
    const visitF = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-F-${timestamp}`,
        vehicle_number: `TL-CASE-F`,
        token_number: `TK-F`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-F-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 10000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitF.id);

    const pF = visitF.portions[0];
    await prisma.unloadingLog.create({
      data: {
        portion_id: pF.id,
        silo_id: siloA.id,
        silo_number: siloA.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });
    // Only Fat attached, NO Plant LR
    await prisma.plantLabResult.create({
      data: { visit_id: visitF.id, portion_id: pF.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
    });

    const resF = await finalizeSiloReceiptForVisit(visitF.id, wbUser.id);
    const txF = await prisma.siloInventoryTransaction.findFirst({ where: { visit_id: visitF.id } });
    assert(
      !resF.success && resF.reason === 'MISSING_PLANT_LR' && txF === null,
      'Case F: Missing Plant LR blocks final receipt',
      `Reason: ${resF.reason}, zero inventory created`
    );

    // ----------------------------------------------------
    // CASE G: Missing Plant Fat
    // ----------------------------------------------------
    console.log('\n--- CASE G: Missing Plant Fat ---');
    const visitG = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-G-${timestamp}`,
        vehicle_number: `TL-CASE-G`,
        token_number: `TK-G`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-G-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 10000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitG.id);

    const pG = visitG.portions[0];
    await prisma.unloadingLog.create({
      data: {
        portion_id: pG.id,
        silo_id: siloA.id,
        silo_number: siloA.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });
    // Only LR attached, NO Plant Fat
    await prisma.plantLabResult.create({
      data: { visit_id: visitG.id, portion_id: pG.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(28.0), is_passed: true, tested_by: wbUser.id },
    });

    const resG = await finalizeSiloReceiptForVisit(visitG.id, wbUser.id);
    const txG = await prisma.siloInventoryTransaction.findFirst({ where: { visit_id: visitG.id } });
    assert(
      !resG.success && resG.reason === 'MISSING_PLANT_FAT' && txG === null,
      'Case G: Missing Plant Fat blocks final receipt',
      `Reason: ${resG.reason}, zero inventory created`
    );

    // ----------------------------------------------------
    // CASE H: Duplicate performed LR -> AMBIGUOUS_PLANT_LR
    // ----------------------------------------------------
    console.log('\n--- CASE H: Duplicate performed LR ---');
    const visitH = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-H-${timestamp}`,
        vehicle_number: `TL-CASE-H`,
        token_number: `TK-H`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-H-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 10000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitH.id);

    const pH = visitH.portions[0];
    await prisma.unloadingLog.create({
      data: {
        portion_id: pH.id,
        silo_id: siloA.id,
        silo_number: siloA.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });
    // Two performed LR in same portion!
    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visitH.id, portion_id: pH.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(28.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitH.id, portion_id: pH.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(29.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitH.id, portion_id: pH.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
      ],
    });

    const resH = await finalizeSiloReceiptForVisit(visitH.id, wbUser.id);
    const txH = await prisma.siloInventoryTransaction.findFirst({ where: { visit_id: visitH.id } });
    assert(
      !resH.success && resH.reason === 'AMBIGUOUS_PLANT_LR' && txH === null,
      'Case H: Duplicate performed LR triggers AMBIGUOUS_PLANT_LR',
      `Reason: ${resH.reason}, zero inventory created`
    );

    // ----------------------------------------------------
    // CASE I: Duplicate performed Fat -> AMBIGUOUS_PLANT_FAT
    // ----------------------------------------------------
    console.log('\n--- CASE I: Duplicate performed Fat ---');
    const visitI = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-I-${timestamp}`,
        vehicle_number: `TL-CASE-I`,
        token_number: `TK-I`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-I-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 10000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitI.id);

    const pI = visitI.portions[0];
    await prisma.unloadingLog.create({
      data: {
        portion_id: pI.id,
        silo_id: siloA.id,
        silo_number: siloA.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });
    // Two performed Fat in same portion!
    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visitI.id, portion_id: pI.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(28.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitI.id, portion_id: pI.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitI.id, portion_id: pI.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(4.2), is_passed: true, tested_by: wbUser.id },
      ],
    });

    const resI = await finalizeSiloReceiptForVisit(visitI.id, wbUser.id);
    const txI = await prisma.siloInventoryTransaction.findFirst({ where: { visit_id: visitI.id } });
    assert(
      !resI.success && resI.reason === 'AMBIGUOUS_PLANT_FAT' && txI === null,
      'Case I: Duplicate performed Fat triggers AMBIGUOUS_PLANT_FAT',
      `Reason: ${resI.reason}, zero inventory created`
    );

    // ----------------------------------------------------
    // CASE J: Dispatch conflict immunity
    // ----------------------------------------------------
    console.log('\n--- CASE J: Dispatch conflict immunity ---');
    const visitJ = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-J-${timestamp}`,
        vehicle_number: `TL-CASE-J`,
        token_number: `TK-J`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-J-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [{ portion_number: 1, dispatch_quantity_value: 10000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' }],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitJ.id);

    const pJ = visitJ.portions[0];
    await prisma.unloadingLog.create({
      data: {
        portion_id: pJ.id,
        silo_id: siloA.id,
        silo_number: siloA.silo_code,
        pump_start_timestamp: new Date(Date.now() - 20 * 60 * 1000),
        pump_end_timestamp: new Date(Date.now() - 10 * 60 * 1000),
        started_by: wbUser.id,
        completed_by: wbUser.id,
      },
    });
    // Plant LR = 28.0, Dispatch LR = 45.0
    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visitJ.id, portion_id: pJ.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(28.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitJ.id, portion_id: pJ.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
      ],
    });
    await prisma.dispatchLabResult.createMany({
      data: [
        { visit_id: visitJ.id, portion_id: pJ.id, test_id: lrTest.id, numeric_value: new Prisma.Decimal(45.0), is_passed: true, tested_by: wbUser.id },
        { visit_id: visitJ.id, portion_id: pJ.id, test_id: fatTest.id, numeric_value: new Prisma.Decimal(10.0), is_passed: true, tested_by: wbUser.id },
      ],
    });

    const resJ = await finalizeSiloReceiptForVisit(visitJ.id, wbUser.id);
    const expectedLitJ = 10000 / 1.028;
    assert(
      resJ.success && Math.abs((resJ.finalPhysicalLiters || 0) - expectedLitJ) < 0.01,
      'Case J: Final receipt uses Plant calculation only (Dispatch LR 45 ignored)',
      `Got ${resJ.finalPhysicalLiters}, expected ${expectedLitJ.toFixed(2)}`
    );

    // ----------------------------------------------------
    // CASE K: Multi-silo guard
    // ----------------------------------------------------
    console.log('\n--- CASE K: Multi-silo guard ---');
    const visitK = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-K-${timestamp}`,
        vehicle_number: `TL-CASE-K`,
        token_number: `TK-K`,
        current_status: 'TARE_WEIGHED',
        procurement_source_id: contractorSource.id,
        operational_date: new Date(),
        created_by: wbUser.id,
        weight_ticket: {
          create: {
            ticket_number: `WT-K-${timestamp}`,
            gross_weight_kg: new Prisma.Decimal(30000),
            tare_weight_kg: new Prisma.Decimal(20000),
            net_weight_kg: new Prisma.Decimal(10000),
            gross_timestamp: new Date(Date.now() - 30 * 60 * 1000),
            tare_timestamp: new Date(),
            gross_recorded_by: wbUser.id,
            tare_recorded_by: wbUser.id,
          },
        },
        portions: {
          create: [
            { portion_number: 1, dispatch_quantity_value: 5000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' },
            { portion_number: 2, dispatch_quantity_value: 5000, plant_decision: 'ACCEPTED', current_status: 'UNLOADED' },
          ],
        },
      },
      include: { portions: true, weight_ticket: true },
    });
    createdVisits.push(visitK.id);

    const pK1 = visitK.portions[0];
    const pK2 = visitK.portions[1];

    // P1 -> Silo A, P2 -> Silo B
    await prisma.unloadingLog.create({
      data: { portion_id: pK1.id, silo_id: siloA.id, silo_number: siloA.silo_code, pump_start_timestamp: new Date(), pump_end_timestamp: new Date(), started_by: wbUser.id, completed_by: wbUser.id },
    });
    await prisma.unloadingLog.create({
      data: { portion_id: pK2.id, silo_id: siloB.id, silo_number: siloB.silo_code, pump_start_timestamp: new Date(), pump_end_timestamp: new Date(), started_by: wbUser.id, completed_by: wbUser.id },
    });

    for (const p of [pK1, pK2]) {
      await prisma.plantLabResult.createMany({
        data: [
          { visit_id: visitK.id, portion_id: p.id, test_id: lrTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(28.0), is_passed: true, tested_by: wbUser.id },
          { visit_id: visitK.id, portion_id: p.id, test_id: fatTest.id, performance_status: 'PERFORMED', numeric_value: new Prisma.Decimal(3.8), is_passed: true, tested_by: wbUser.id },
        ],
      });
    }

    const resK = await finalizeSiloReceiptForVisit(visitK.id, wbUser.id);
    const txK = await prisma.siloInventoryTransaction.findFirst({ where: { visit_id: visitK.id } });
    assert(
      !resK.success && resK.reason === 'MULTI_SILO_ALLOCATION_REQUIRED' && txK === null,
      'Case K: Multi-silo returns MULTI_SILO_ALLOCATION_REQUIRED and creates no receipt',
      `Reason: ${resK.reason}, zero inventory created`
    );

    // ----------------------------------------------------
    // CASE L: Silo stock uses physical liters, NOT @13TS liters
    // ----------------------------------------------------
    console.log('\n--- CASE L: Silo stock uses physical liters ---');
    // For Visit A: finalPhysicalLiters is ~14,591.44 L, while finalAt13TSLiters is ~13,868.60 L
    const stockAfterA = await getSiloCurrentStockLiters(siloA.id);
    assert(
      Math.abs(stockAfterA - (resA.finalPhysicalLiters || 0) - (resB.finalPhysicalLiters || 0) - (resC.finalPhysicalLiters || 0) - (resD.finalPhysicalLiters || 0) - (resE_KG.finalPhysicalLiters || 0) - (resE_L.finalPhysicalLiters || 0) - (resJ.finalPhysicalLiters || 0)) < 1,
      'Case L: Silo stock equals sum of physical liters, not @13TS',
      `Current stock in Silo A is ${stockAfterA} L`
    );

    // ----------------------------------------------------
    // CASE M: Idempotent retry after success
    // ----------------------------------------------------
    console.log('\n--- CASE M: Idempotent retry after success ---');
    const retryResA = await finalizeSiloReceiptForVisit(visitA.id, wbUser.id);
    const countA = await prisma.siloInventoryTransaction.count({
      where: { visit_id: visitA.id, transaction_type: SiloTransactionType.RECEIPT },
    });
    assert(
      retryResA.success && Boolean(retryResA.alreadyFinalized) && countA === 1,
      'Case M: Retry after success returns alreadyFinalized and does not duplicate RECEIPT',
      `alreadyFinalized=${retryResA.alreadyFinalized}, receipt count=${countA}`
    );

    // ----------------------------------------------------
    // CASE N: Invalid Second Weight (Second >= Gross)
    // ----------------------------------------------------
    console.log('\n--- CASE N: Invalid Second Weight ---');
    const calcInvalid = calculateVehicleReceivedQuantity({
      grossWeightKg: 20000,
      secondWeightKg: 20000,
      portions: [
        {
          portionId: 'p1',
          portionNumber: 1,
          plantDecision: 'ACCEPTED',
          plantLabResults: [
            { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
            { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
          ],
        },
      ],
    });
    const isInvalidWeight = !calcInvalid.isCalculable && calcInvalid.reason === 'INVALID_WEIGHT_ORDER';
    assert(
      isInvalidWeight,
      'Case N: Tare >= Gross rejected with INVALID_WEIGHT_ORDER',
      `Reason: ${!calcInvalid.isCalculable ? calcInvalid.reason : 'NONE'}`
    );

    // ----------------------------------------------------
    // CASE O: No visible average QA in Weighbridge UI
    // ----------------------------------------------------
    console.log('\n--- CASE O: No visible average QA in Weighbridge UI ---');
    const uiSource = fs.readFileSync(path.resolve(__dirname, '../src/frontend/modules/dashboard/WeighbridgeWorkspace.tsx'), 'utf-8');
    const hasAverageLrText = uiSource.includes('Average Plant LR') || uiSource.includes('Average LR') || uiSource.includes('Composite QA') || uiSource.includes('averagePlantLr');
    assert(
      !hasAverageLrText,
      'Case O: Weighbridge UI contains zero average QA or composite QA text',
      `hasAverageLrText=${hasAverageLrText}`
    );

    // ----------------------------------------------------
    // CASE P: Old LR preview removed
    // ----------------------------------------------------
    console.log('\n--- CASE P: Old LR preview removed ---');
    const hasPlantLrBasisText = uiSource.includes('Plant LR Basis');
    const readyRouteSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/scale/ready-for-tare/route.ts'), 'utf-8');
    const hasPlantLrInReady = readyRouteSource.includes('plant_lr:');
    assert(
      !hasPlantLrBasisText && !hasPlantLrInReady,
      'Case P: Plant LR Basis and ready-for-tare plant_lr removed',
      `UI hasPlantLrBasis=${hasPlantLrBasisText}, API hasPlantLr=${hasPlantLrInReady}`
    );
  } finally {
    // Cleanup created visits and silos
    for (const vId of createdVisits) {
      await prisma.plantLabResult.deleteMany({ where: { visit_id: vId } });
      await prisma.dispatchLabResult.deleteMany({ where: { visit_id: vId } });
      await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: vId } });
      await prisma.unloadingLog.deleteMany({ where: { portion: { visit_id: vId } } });
      await prisma.weightTicket.deleteMany({ where: { visit_id: vId } });
      await prisma.visitPortion.deleteMany({ where: { visit_id: vId } });
      await prisma.auditLog.deleteMany({ where: { record_id: vId } });
      await prisma.vehicleVisit.deleteMany({ where: { id: vId } });
    }
    await prisma.silo.deleteMany({ where: { id: { in: [siloA.id, siloB.id] } } });
  }

  console.log('\n==================================================');
  console.log(`CHUNK 5 FINAL RECEIPT INTEGRATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runChunk5IntegrationTests().catch((err) => {
  console.error('Error running Chunk 5 integration tests:', err);
  process.exit(1);
});
