import { prisma } from '../src/backend/core/db';
import { evaluateLabResult } from '../src/lib/lab-rules';
import {
  calculateSNF,
  calculateTS,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';

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

  const mpdUser = users.find((u) => u.role === 'MPD_Operator' || u.role === 'MPD_Zone_Manager') || users[0];
  const gateUser = users.find((u) => u.role === 'Security_Operator') || users[0];
  const qaUser = users.find((u) => u.role === 'QA_Operator' || u.role === 'QA') || users[0];
  const weighUser = users.find((u) => u.role === 'WEIGHBRIDGE_OPERATOR' || u.role === 'Weighbridge_Operator') || users[0];
  const prodUser = users.find((u) => u.role === 'Production_Operator' || u.role === 'Production') || users[0];

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

  console.log(`Master references verified: ${users.length} Users, ${sources.length} Sources, ${activeSilos.length} Silos, ${activeTests.length} Lab Tests.\n`);

  // Target Breakdown for 75 VehicleVisits:
  // 55 Fully Accepted & Completed
  // 8 All-Rejected & Completed Exit
  // 6 Hold -> Resume -> Accept & Completed
  // 3 Hold -> Resume -> Reject & Completed Exit
  // 3 In-Progress (1 TOKEN_ISSUED, 1 PLANT_QA, 1 READY_FOR_GROSS)

  const TOTAL_VISITS = 75;
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

  console.log('Seeding 75 realistic, deterministic vehicle journeys...\n');

  for (let i = 1; i <= TOTAL_VISITS; i++) {
    // Determine category
    let category: 'ACCEPTED' | 'REJECTED' | 'HOLD_ACCEPT' | 'HOLD_REJECT' | 'IN_PROGRESS';
    let targetStatus: string;

    if (i <= 55) {
      category = 'ACCEPTED';
      targetStatus = 'COMPLETED';
    } else if (i <= 63) {
      category = 'REJECTED';
      targetStatus = 'COMPLETED';
    } else if (i <= 69) {
      category = 'HOLD_ACCEPT';
      targetStatus = 'COMPLETED';
    } else if (i <= 72) {
      category = 'HOLD_REJECT';
      targetStatus = 'COMPLETED';
    } else if (i === 73) {
      category = 'IN_PROGRESS';
      targetStatus = 'TOKEN_ISSUED';
    } else if (i === 74) {
      category = 'IN_PROGRESS';
      targetStatus = 'PLANT_QA';
    } else {
      category = 'IN_PROGRESS';
      targetStatus = 'READY_FOR_GROSS';
    }

    // Determine operational timestamp & business date boundaries
    // Spread evenly across last 28 days with deliberate boundary hours
    const daysAgo = Math.floor((TOTAL_VISITS - i) * (28 / TOTAL_VISITS));
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
    const sourceObj = sources[(i - 1) % sources.length];
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
    const totalDeclaredKg = 7000 + ((i * 350) % 7500); // 7,000 to 14,500 kg

    // Create VehicleVisit
    const visit = await prisma.vehicleVisit.create({
      data: {
        visit_number: visitNumber,
        reception_number: receptionNumber,
        vehicle_number: vehicleNum,
        token_number: tokenNumber,
        operational_date: dispatchTime,
        current_status: targetStatus,
        created_by: mpdUser.id,
        procurement_source_id: sourceObj.id,
        created_at: dispatchTime,
        updated_at: targetStatus === 'COMPLETED' ? gateExitTime : qaCompleteTime,
      },
    });

    createdVisits++;

    // Create Portions & Dispatch Info
    const portionCount = hasTwoPortions ? 2 : 1;
    for (let pIdx = 1; pIdx <= portionCount; pIdx++) {
      const portionKg = hasTwoPortions ? Math.round(totalDeclaredKg / 2) : totalDeclaredKg;

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

      const portion = await prisma.visitPortion.create({
        data: {
          visit_id: visit.id,
          portion_number: pIdx,
          declared_quantity_value: portionKg,
          current_status: portionStatus,
          plant_decision: targetStatus === 'TOKEN_ISSUED' || targetStatus === 'PLANT_QA' ? 'PENDING' : portionDecision,
          plant_rejection_reason: portionDecision === 'REJECTED' ? 'COB Positive & High Acidity. Off-flavor detected during organoleptic testing.' : null,
          plant_decided_by: targetStatus === 'TOKEN_ISSUED' || targetStatus === 'PLANT_QA' ? null : qaUser.id,
          plant_decided_at: targetStatus === 'TOKEN_ISSUED' || targetStatus === 'PLANT_QA' ? null : qaCompleteTime,
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
      const lrVal = 27.5 + ((i + pIdx) % 8) * 0.2; // 27.5 - 29.0
      const tempVal = 4.0 + (i % 4) * 0.5;
      const acidVal = 0.12 + (i % 3) * 0.01;

      for (const t of activeTests) {
        if (t.testScope === 'DISPATCH' || t.testScope === 'BOTH') {
          let numVal: number | null = null;
          let textVal: string | null = null;
          let isPassed = true;

          if (t.testName === 'Fat') numVal = fatVal;
          else if (t.testName.includes('Lactometer') || t.testName.includes('LR')) numVal = lrVal;
          else if (t.testName === 'Temperature') numVal = tempVal;
          else if (t.testName === 'Acidity') numVal = acidVal;
          else if (t.testName === 'pH at 20 Celsius') numVal = 6.65;
          else if (t.resultType === 'OK_NOT_OK') textVal = 'OK';
          else if (t.resultType === 'POSITIVE_NEGATIVE') textVal = 'NEGATIVE';
          else if (t.resultType === 'NUMERIC') numVal = 10.0;

          if (t.resultType !== 'CALCULATED') {
            await prisma.dispatchLabResult.create({
              data: {
                visit_id: visit.id,
                portion_id: portion.id,
                test_id: t.id,
                sample_timestamp: dispatchTime,
                result_timestamp: dispatchTime,
                numeric_value: numVal,
                text_value: textVal,
                is_passed: isPassed,
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
        const plantFat = isPlantReject ? 2.5 : fatVal;
        const plantLr = isPlantReject ? 24.0 : lrVal;

        for (const t of activeTests) {
          if (t.testScope === 'PLANT' || t.testScope === 'BOTH') {
            let numVal: number | null = null;
            let textVal: string | null = null;
            let isPassed = !isPlantReject;

            if (t.testName === 'Fat') numVal = plantFat;
            else if (t.testName.includes('Lactometer') || t.testName.includes('LR')) numVal = plantLr;
            else if (t.testName === 'Temperature') numVal = tempVal;
            else if (t.testName === 'Acidity') numVal = isPlantReject ? 0.19 : acidVal;
            else if (t.testName === 'Clot on Boiling') {
              textVal = isPlantReject ? 'POSITIVE' : 'NEGATIVE';
              isPassed = !isPlantReject;
            } else if (t.resultType === 'OK_NOT_OK') textVal = isPlantReject ? 'NOT_OK' : 'OK';
            else if (t.resultType === 'POSITIVE_NEGATIVE') textVal = 'NEGATIVE';
            else if (t.resultType === 'NUMERIC') numVal = 10.0;

            if (t.resultType !== 'CALCULATED') {
              await prisma.plantLabResult.create({
                data: {
                  visit_id: visit.id,
                  portion_id: portion.id,
                  test_id: t.id,
                  sample_timestamp: qaStartTime,
                  result_timestamp: qaCompleteTime,
                  numeric_value: numVal,
                  text_value: textVal,
                  is_passed: isPassed,
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
    const isPastQA = targetStatus === 'READY_FOR_GROSS' || targetStatus === 'COMPLETED';

    if (isAcceptedWorkflow && isPastQA) {
      const grossKg = Math.round(totalDeclaredKg + 14500);
      const tareKg = 14500;
      const netKg = grossKg - tareKg;

      // Weight Ticket
      await prisma.weightTicket.create({
        data: {
          visit_id: visit.id,
          ticket_number: `WT-${tokenNumber}`,
          gross_weight_kg: grossKg,
          gross_timestamp: grossTime,
          gross_recorded_by: weighUser.id,
          gross_submitted_at: new Date(grossTime.getTime() + 240000),
          tare_weight_kg: targetStatus === 'COMPLETED' ? tareKg : null,
          tare_timestamp: targetStatus === 'COMPLETED' ? tareTime : null,
          tare_recorded_by: targetStatus === 'COMPLETED' ? weighUser.id : null,
          tare_submitted_at: targetStatus === 'COMPLETED' ? new Date(tareTime.getTime() + 300000) : null,
          net_weight_kg: targetStatus === 'COMPLETED' ? netKg : null,
          created_at: grossTime,
        },
      });
      weightTicketsCount++;

      // Unloading Log & Silo Receipt for Completed Accepted Visits
      if (targetStatus === 'COMPLETED') {
        const visitPortions = await prisma.visitPortion.findMany({ where: { visit_id: visit.id } });
        const targetSilo = activeSilos[(i - 1) % activeSilos.length];

        for (const p of visitPortions) {
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

        // Exactly ONE Vehicle-Level Final Silo Receipt for eligible accepted visits
        const acceptedPortions = visitPortions.filter((p) => p.plant_decision === 'ACCEPTED');
        if (acceptedPortions.length > 0) {
          const plantLr = 28.5;
          const receiptLiters = Math.round(calculatePhysicalLiters(netKg, plantLr));

          await prisma.siloInventoryTransaction.create({
            data: {
              silo_id: targetSilo.id,
              visit_id: visit.id,
              portion_id: acceptedPortions.length === 1 ? acceptedPortions[0].id : null,
              transaction_type: 'RECEIPT',
              quantity_kg: netKg,
              quantity_liters: receiptLiters,
              operational_timestamp: tareTime,
              performed_by: weighUser.id,
              idempotency_key: `FINAL_RECEIPT:VISIT:${visit.id}`,
              created_at: new Date(tareTime.getTime() + 120000),
            },
          });
          finalReceiptsCount++;
        }
      }
    }

    if (targetStatus === 'COMPLETED') completedVisits++;
    else inProgressVisits++;

    if (category === 'REJECTED' || category === 'HOLD_REJECT') rejectedVisits++;
    if (category.includes('HOLD')) holdVisits++;
  }

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
  console.log('==================================================\n');

  return {
    createdVisits,
    createdPortions,
    completedVisits,
    rejectedVisits,
    holdVisits,
    inProgressVisits,
    sourceStats,
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
