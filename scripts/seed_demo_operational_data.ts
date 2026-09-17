import { prisma } from '../src/backend/core/db';
import { evaluateLabResult } from '../src/lib/lab-rules';
import {
  calculateSNF,
  calculateTS,
  calculateDensity,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
  computeCanonicalMilkMetrics,
} from '../src/backend/utils/milkFormulas';
import {
  calculateVehicleReceivedQuantity,
  VehicleCalculationPortion,
} from '../src/backend/services/vehicleQuantityService';
import { getOperationalBusinessDate, getPakistanCalendarDate } from '../src/backend/core/business-day';
import { parseStrictDateOnly } from '../src/lib/datetime-utils';
import { getTankPhysicalStock } from '../src/backend/services/zmccTankService';

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
  let visit20Record: any = null;

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
    // Assign visit 74 (PLANT_QA) to ZMCC Hasilpur for live active tanker visibility in Hasilpur overview
    let sourceObj = i === 74
      ? (sources.find((s) => s.code === 'ZMCC-HASILPUR') || sources[(i - 1) % sources.length])
      : sources[(i - 1) % sources.length];

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

    if (i === 20) {
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
        created_at: dispatchTime,
        updated_at: targetStatus === 'COMPLETED' ? gateExitTime : qaCompleteTime,
      },
    });

    createdVisits++;
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
          await prisma.siloInventoryTransaction.create({
            data: {
              silo_id: targetSilo.id,
              visit_id: visit.id,
              portion_id: acceptedPortions.length === 1 ? acceptedPortions[0].id : null,
              transaction_type: 'RECEIPT',
              quantity_kg: netKg,
              quantity_liters: calcResult.finalPhysicalLiters,
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

  // Canonical Tank Stock Seeding for Scenario A (Visit 20):
  // Ensure truthful, positive tank stock balance by seeding an opening receipt before Visit 20 dispatch,
  // followed by the canonical whole-vehicle tank ISSUE (8,000 L) for Visit 20.
  if (visit20Record) {
    const openingStockLiters = 15000.0;
    const openingTimestamp = new Date(visit20Record.created_at.getTime() - 3600000); // 1 hr before dispatch

    await prisma.zmccTankInventoryTransaction.create({
      data: {
        tank_id: hasilpurTank.id,
        zmcc_id: hasilpurSource.id,
        transaction_type: 'RECEIPT',
        quantity_liters: openingStockLiters,
        reference_type: 'OPENING_STOCK',
        reference_id: `INIT-${hasilpurSource.id}`,
        idempotency_key: `ZMCC_TANK_RECEIPT:OPENING_STOCK:${hasilpurSource.id}`,
        operational_timestamp: openingTimestamp,
        performed_by_user_id: zmccManager.id,
        notes: 'Initial opening stock receipt for Hasilpur storage tank',
      },
    });

    await prisma.zmccTankInventoryTransaction.create({
      data: {
        tank_id: hasilpurTank.id,
        zmcc_id: hasilpurSource.id,
        transaction_type: 'ISSUE',
        quantity_liters: Number(visit20Record.vehicle_dispatch_quantity_value), // 8000.00
        dispatch_id: visit20Record.id,
        reference_type: 'DISPATCH',
        reference_id: visit20Record.id.toString(),
        idempotency_key: `ZMCC_TANK_ISSUE:DISPATCH:${visit20Record.id}`,
        operational_timestamp: visit20Record.created_at,
        performed_by_user_id: zmccLabUser.id,
        notes: `Whole-vehicle dispatch issue for visit ${visit20Record.visit_number} (${visit20Record.vehicle_number})`,
      },
    });
  }

  // Ensure active testing policies exist for ZMCC_LAB_MOT and ZMCC_LAB_CONTRACTOR
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
    for (const point of ['ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR']) {
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

  // Ensure MOT Route, Profile, and Vehicle exist for Hasilpur
  let zmccRoute = await prisma.zmccRoute.findFirst({
    where: { zmcc_id: hasilpurSource.id, route_code: 'DEMO-R-HAS-01' },
  });
  if (!zmccRoute) {
    zmccRoute = await prisma.zmccRoute.create({
      data: {
        zmcc_id: hasilpurSource.id,
        route_code: 'DEMO-R-HAS-01',
        name: 'Hasilpur Rural Route 01',
        origin: 'Hasilpur Sub-Div',
        destination: 'ZMCC Hasilpur',
        is_active: true,
        created_by: zmccManager.id,
      },
    });
  }

  let motProfile = await prisma.motProfile.findFirst({
    where: { zmcc_id: hasilpurSource.id, mot_code: 'DEMO-MOT-HAS-01' },
  });
  if (!motProfile) {
    motProfile = await prisma.motProfile.create({
      data: {
        zmcc_id: hasilpurSource.id,
        mot_code: 'DEMO-MOT-HAS-01',
        name: 'Muhammad Tariq (MOT Officer)',
        phone_number: '03001234568',
        cnic: '31202-1234568-1',
        is_active: true,
        created_by: zmccManager.id,
      },
    });
  }

  let motVehicle = await prisma.motVehicle.findFirst({
    where: { zmcc_id: hasilpurSource.id, vehicle_number: 'DEMO-BWP-5522' },
  });
  if (!motVehicle) {
    motVehicle = await prisma.motVehicle.create({
      data: {
        zmcc_id: hasilpurSource.id,
        vehicle_number: 'DEMO-BWP-5522',
        is_active: true,
        created_by: zmccManager.id,
      },
    });
  }

  // Deterministic Local Supplier sequence code helper
  async function allocateSupplierCode(): Promise<string> {
    const seqResult = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('zmcc_local_supplier_code_seq') as nextval
    `;
    const seqNum = Number(seqResult[0].nextval);
    return `ZLS-${String(seqNum).padStart(6, '0')}`;
  }

  // A. Local Supplier Master Data
  // Supplier 1: Active, available for new arrival
  const supplier1 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Bashir Milk Collection Center',
      phone: '03001234501',
      cnic: '31202-1234567-1',
      erp_reference: 'DEMO-ERP-LS-HAS-001',
      erp_mapping_status: 'PENDING',
      is_active: true,
      created_by_user_id: pheUser.id,
    },
  });

  // Supplier 2: Active, for directory / search visibility
  const supplier2 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Chaudhry Dairy & Cattle Farm',
      phone: '03017654321',
      cnic: '31202-7654321-2',
      erp_reference: 'DEMO-ERP-LS-HAS-002',
      erp_mapping_status: 'PENDING',
      is_active: true,
      created_by_user_id: zmccManager.id,
    },
  });

  // Supplier 3: Created active initially so it can participate in historical Arrival 4, then deactivated later
  const supplier3 = await prisma.zmccLocalSupplier.create({
    data: {
      local_supplier_code: await allocateSupplierCode(),
      zmcc_id: hasilpurSource.id,
      name: 'DEMO - Rehman Dairy Supplies (Inactive)',
      phone: '03029876543',
      cnic: '31202-9876543-3',
      erp_reference: 'DEMO-ERP-LS-INACT-03',
      erp_mapping_status: 'PENDING',
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
  const timeTodayArr1 = new Date(`${pktTodayDateStr}T09:15:00+05:00`); // 09:15 PKT
  const timeTodayArr2 = new Date(`${pktTodayDateStr}T09:30:00+05:00`); // 09:30 PKT
  const timeTodayArr3 = new Date(`${pktTodayDateStr}T07:15:00+05:00`); // 07:15 PKT
  const timeTodayArr3Exit = new Date(`${pktTodayDateStr}T08:15:00+05:00`); // 08:15 PKT

  const timeYestArr5 = new Date(`${yesterdayDateStr}T11:00:00+05:00`); // 11:00 PKT
  const timeYestArr5Exit = new Date(`${yesterdayDateStr}T12:30:00+05:00`); // 12:30 PKT

  const timeThreeDaysArr4 = new Date(`${threeDaysAgoDateStr}T14:00:00+05:00`); // 14:00 PKT
  const timeThreeDaysArr4Exit = new Date(`${threeDaysAgoDateStr}T14:45:00+05:00`); // 14:45 PKT

  // B. PHE / Arrivals View Scenarios:
  // Arrival 1: Local Supplier arrival currently inside ZMCC and waiting for Lab
  const arr1 = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: hasilpurSource.id,
      local_supplier_id: supplier1.id,
      rmr_number: '0000101',
      vehicle_number: 'BWP-4411',
      arrival_timestamp: timeTodayArr1,
      arrival_date: pktTodayDate,
      zmcc_token: 'TK-HAS-LS-001',
      client_event_id: `evt-arr-ls-01-${pktTodayDateStr}`,
      recorded_by_user_id: pheUser.id,
      gate_exit_required: true,
      exit_timestamp: null, // Inside ZMCC
    },
  });

  // Arrival 2: MOT arrival currently inside ZMCC and in-progress lab session
  const journey2 = await prisma.motJourney.create({
    data: {
      journey_number: `J-HAS-${pktTodayDateStr.replace(/-/g, '')}-01`,
      idempotency_key: `mot-journey-01-${pktTodayDateStr}`,
      zmcc_id: hasilpurSource.id,
      route_id: zmccRoute.id,
      mot_profile_id: motProfile.id,
      mot_vehicle_id: motVehicle.id,
      status: 'COMPLETED',
      operational_date: pktTodayDate,
      assigned_by: zmccManager.id,
      assigned_at: new Date(timeTodayArr2.getTime() - 7200000),
      started_at: new Date(timeTodayArr2.getTime() - 5400000),
      ended_at: new Date(timeTodayArr2.getTime() - 600000),
      assignment_latitude: 29.6974,
      assignment_longitude: 72.5539,
      start_latitude: 29.6974,
      start_longitude: 72.5539,
    },
  });

  const arr2 = await prisma.zmccMotArrival.create({
    data: {
      journey_id: journey2.id,
      zmcc_id: hasilpurSource.id,
      route_milk_token: 'RM-HAS-0201',
      zmcc_token: 'TK-HAS-MOT-001',
      arrival_timestamp: timeTodayArr2,
      arrival_date: pktTodayDate,
      client_event_id: `evt-arr-mot-01-${pktTodayDateStr}`,
      recorded_by_user_id: pheUser.id,
      gate_exit_required: true,
      exit_timestamp: null, // Inside ZMCC
    },
  });

  // In-progress Lab session on Arrival 2
  const session2 = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: hasilpurSource.id,
      arrival_type: 'MOT',
      mot_arrival_id: arr2.id,
      status: 'IN_PROGRESS',
      started_by_user_id: zmccLabUser.id,
      started_at: new Date(timeTodayArr2.getTime() + 600000),
    },
  });

  if (lrTest && fatTest) {
    await prisma.zmccLabResult.createMany({
      data: [
        {
          session_id: session2.id,
          test_id: lrTest.id,
          test_code_snapshot: lrTest.testCode,
          test_name_snapshot: lrTest.testName,
          result_type_snapshot: lrTest.resultType,
          unit_snapshot: lrTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 1,
          evaluation_status: 'PENDING',
        },
        {
          session_id: session2.id,
          test_id: fatTest.id,
          test_code_snapshot: fatTest.testCode,
          test_name_snapshot: fatTest.testName,
          result_type_snapshot: fatTest.resultType,
          unit_snapshot: fatTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 2,
          evaluation_status: 'PENDING',
        },
      ],
    });
  }

  // Arrival 3: Accepted Local Supplier arrival completed through Lab + tank receipt + ZMCC gate exit
  const arr3 = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: hasilpurSource.id,
      local_supplier_id: supplier2.id,
      rmr_number: '0000102',
      vehicle_number: 'BWP-3322',
      arrival_timestamp: timeTodayArr3,
      arrival_date: pktTodayDate,
      zmcc_token: 'TK-HAS-LS-002',
      client_event_id: `evt-arr-ls-02-${pktTodayDateStr}`,
      recorded_by_user_id: pheUser.id,
      gate_exit_required: true,
      exit_timestamp: timeTodayArr3Exit,
      exit_recorded_by_user_id: pheUser.id,
      exit_client_event_id: `evt-exit-ls-02-${pktTodayDateStr}`,
      exit_submitted_at: new Date(timeTodayArr3Exit.getTime() + 120000),
    },
  });

  const arr3QtyLiters = 2400.0;
  const arr3Lr = 28.5;
  const arr3Fat = 3.8;
  const arr3Metrics = computeCanonicalMilkMetrics(arr3QtyLiters, 'LITER', arr3Lr, arr3Fat);

  const session3 = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: hasilpurSource.id,
      arrival_type: 'LOCAL_SUPPLIER',
      local_supplier_arrival_id: arr3.id,
      status: 'COMPLETED',
      decision: 'ACCEPTED',
      started_by_user_id: zmccLabUser.id,
      started_at: new Date(timeTodayArr3.getTime() + 600000),
      completed_by_user_id: zmccLabUser.id,
      completed_at: new Date(timeTodayArr3.getTime() + 1800000),
      completion_client_event_id: `evt-comp-ls-02-${pktTodayDateStr}`,
      quantity_value: arr3QtyLiters,
      quantity_unit: 'LITER',
      density: arr3Metrics.density,
      gross_liters: arr3Metrics.grossLiters,
      snf: arr3Metrics.snf,
      ts: arr3Metrics.ts,
      at_13ts_liters: arr3Metrics.at13tsLiters,
      calculation_version: arr3Metrics.calculationVersion,
    },
  });

  if (lrTest && fatTest) {
    await prisma.zmccLabResult.createMany({
      data: [
        {
          session_id: session3.id,
          test_id: lrTest.id,
          test_code_snapshot: lrTest.testCode,
          test_name_snapshot: lrTest.testName,
          result_type_snapshot: lrTest.resultType,
          unit_snapshot: lrTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 1,
          numeric_value: arr3Lr,
          evaluation_status: 'PASSED',
          is_passed: true,
          recorded_at: new Date(timeTodayArr3.getTime() + 1200000),
        },
        {
          session_id: session3.id,
          test_id: fatTest.id,
          test_code_snapshot: fatTest.testCode,
          test_name_snapshot: fatTest.testName,
          result_type_snapshot: fatTest.resultType,
          unit_snapshot: fatTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 2,
          numeric_value: arr3Fat,
          evaluation_status: 'PASSED',
          is_passed: true,
          recorded_at: new Date(timeTodayArr3.getTime() + 1200000),
        },
      ],
    });
  }

  const receipt3 = await prisma.zmccTankReceipt.create({
    data: {
      lab_session_id: session3.id,
      zmcc_id: hasilpurSource.id,
      tank_id: hasilpurTank.id,
      arrival_type: 'LOCAL_SUPPLIER',
      quantity_value: arr3QtyLiters,
      quantity_unit: 'LITER',
      density: arr3Metrics.density,
      gross_liters: arr3Metrics.grossLiters,
      lr: arr3Lr,
      fat: arr3Fat,
      snf: arr3Metrics.snf,
      ts: arr3Metrics.ts,
      at_13ts_liters: arr3Metrics.at13tsLiters,
      calculation_version: arr3Metrics.calculationVersion,
      received_at: new Date(timeTodayArr3.getTime() + 2100000),
      received_by_user_id: zmccLabUser.id,
    },
  });

  await prisma.zmccTankInventoryTransaction.create({
    data: {
      tank_id: hasilpurTank.id,
      zmcc_id: hasilpurSource.id,
      transaction_type: 'RECEIPT',
      quantity_liters: arr3QtyLiters,
      tank_receipt_id: receipt3.id,
      reference_type: 'ZMCC_LAB_SESSION',
      reference_id: session3.id.toString(),
      idempotency_key: `ZMCC_TANK_RECEIPT:LAB_SESSION:${session3.id}`,
      operational_timestamp: new Date(timeTodayArr3.getTime() + 2100000),
      performed_by_user_id: zmccLabUser.id,
      notes: 'Demo Local Supplier Tank Receipt - Hasilpur',
    },
  });

  // Arrival 4: Rejected Local Supplier arrival completed and exited without tank receipt (Inactive supplier continuity)
  const arr4 = await prisma.zmccLocalSupplierArrival.create({
    data: {
      zmcc_id: hasilpurSource.id,
      local_supplier_id: supplier3.id,
      rmr_number: '0000103',
      vehicle_number: 'BWP-8877',
      arrival_timestamp: timeThreeDaysArr4,
      arrival_date: threeDaysAgoDateOnly,
      zmcc_token: 'TK-HAS-LS-003',
      client_event_id: `evt-arr-ls-03-${threeDaysAgoDateStr}`,
      recorded_by_user_id: pheUser.id,
      gate_exit_required: true,
      exit_timestamp: timeThreeDaysArr4Exit,
      exit_recorded_by_user_id: pheUser.id,
      exit_client_event_id: `evt-exit-ls-03-${threeDaysAgoDateStr}`,
      exit_submitted_at: new Date(timeThreeDaysArr4Exit.getTime() + 120000),
    },
  });

  const arr4QtyLiters = 1200.0;
  const arr4Lr = 22.0;
  const arr4Fat = 2.2;
  const arr4Metrics = computeCanonicalMilkMetrics(arr4QtyLiters, 'LITER', arr4Lr, arr4Fat);

  const session4 = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: hasilpurSource.id,
      arrival_type: 'LOCAL_SUPPLIER',
      local_supplier_arrival_id: arr4.id,
      status: 'COMPLETED',
      decision: 'REJECTED',
      rejection_reason: 'Acidity 0.21% & COB Positive. High temperature 12°C detected.',
      remarks: 'Rejected at intake platform. Gate exit authorized without tank receipt.',
      started_by_user_id: zmccLabUser.id,
      started_at: new Date(timeThreeDaysArr4.getTime() + 600000),
      completed_by_user_id: zmccLabUser.id,
      completed_at: new Date(timeThreeDaysArr4.getTime() + 1800000),
      completion_client_event_id: `evt-comp-ls-03-${threeDaysAgoDateStr}`,
      quantity_value: arr4QtyLiters,
      quantity_unit: 'LITER',
      density: arr4Metrics.density,
      gross_liters: arr4Metrics.grossLiters,
      snf: arr4Metrics.snf,
      ts: arr4Metrics.ts,
      at_13ts_liters: arr4Metrics.at13tsLiters,
      calculation_version: arr4Metrics.calculationVersion,
    },
  });

  if (lrTest && fatTest) {
    await prisma.zmccLabResult.createMany({
      data: [
        {
          session_id: session4.id,
          test_id: lrTest.id,
          test_code_snapshot: lrTest.testCode,
          test_name_snapshot: lrTest.testName,
          result_type_snapshot: lrTest.resultType,
          unit_snapshot: lrTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 1,
          numeric_value: arr4Lr,
          evaluation_status: 'FAILED',
          is_passed: false,
          recorded_at: new Date(timeThreeDaysArr4.getTime() + 1200000),
        },
        {
          session_id: session4.id,
          test_id: fatTest.id,
          test_code_snapshot: fatTest.testCode,
          test_name_snapshot: fatTest.testName,
          result_type_snapshot: fatTest.resultType,
          unit_snapshot: fatTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 2,
          numeric_value: arr4Fat,
          evaluation_status: 'FAILED',
          is_passed: false,
          recorded_at: new Date(timeThreeDaysArr4.getTime() + 1200000),
        },
      ],
    });
  }

  // Deactivate supplier3 now that historical arrival has completed (models realistic supplier lifecycle)
  await prisma.zmccLocalSupplier.update({
    where: { id: supplier3.id },
    data: { is_active: false, updated_by_user_id: zmccManager.id },
  });

  // Arrival 5: Completed MOT arrival that can appear in recent history
  const journey5 = await prisma.motJourney.create({
    data: {
      journey_number: `J-HAS-${yesterdayDateStr.replace(/-/g, '')}-02`,
      idempotency_key: `mot-journey-02-${yesterdayDateStr}`,
      zmcc_id: hasilpurSource.id,
      route_id: zmccRoute.id,
      mot_profile_id: motProfile.id,
      mot_vehicle_id: motVehicle.id,
      status: 'COMPLETED',
      operational_date: yesterdayDateOnly,
      assigned_by: zmccManager.id,
      assigned_at: new Date(timeYestArr5.getTime() - 7200000),
      started_at: new Date(timeYestArr5.getTime() - 5400000),
      ended_at: new Date(timeYestArr5.getTime() - 600000),
      assignment_latitude: 29.6974,
      assignment_longitude: 72.5539,
      start_latitude: 29.6974,
      start_longitude: 72.5539,
    },
  });

  const arr5 = await prisma.zmccMotArrival.create({
    data: {
      journey_id: journey5.id,
      zmcc_id: hasilpurSource.id,
      route_milk_token: 'RM-HAS-0202',
      zmcc_token: 'TK-HAS-MOT-002',
      arrival_timestamp: timeYestArr5,
      arrival_date: yesterdayDateOnly,
      client_event_id: `evt-arr-mot-02-${yesterdayDateStr}`,
      recorded_by_user_id: pheUser.id,
      gate_exit_required: true,
      exit_timestamp: timeYestArr5Exit,
      exit_recorded_by_user_id: pheUser.id,
      exit_client_event_id: `evt-exit-mot-02-${yesterdayDateStr}`,
      exit_submitted_at: new Date(timeYestArr5Exit.getTime() + 120000),
    },
  });

  const arr5QtyLiters = 4500.0;
  const arr5Lr = 29.0;
  const arr5Fat = 4.1;
  const arr5Metrics = computeCanonicalMilkMetrics(arr5QtyLiters, 'LITER', arr5Lr, arr5Fat);

  const session5 = await prisma.zmccLabSession.create({
    data: {
      zmcc_id: hasilpurSource.id,
      arrival_type: 'MOT',
      mot_arrival_id: arr5.id,
      status: 'COMPLETED',
      decision: 'ACCEPTED',
      started_by_user_id: zmccLabUser.id,
      started_at: new Date(timeYestArr5.getTime() + 600000),
      completed_by_user_id: zmccLabUser.id,
      completed_at: new Date(timeYestArr5.getTime() + 2400000),
      completion_client_event_id: `evt-comp-mot-02-${yesterdayDateStr}`,
      quantity_value: arr5QtyLiters,
      quantity_unit: 'LITER',
      density: arr5Metrics.density,
      gross_liters: arr5Metrics.grossLiters,
      snf: arr5Metrics.snf,
      ts: arr5Metrics.ts,
      at_13ts_liters: arr5Metrics.at13tsLiters,
      calculation_version: arr5Metrics.calculationVersion,
    },
  });

  if (lrTest && fatTest) {
    await prisma.zmccLabResult.createMany({
      data: [
        {
          session_id: session5.id,
          test_id: lrTest.id,
          test_code_snapshot: lrTest.testCode,
          test_name_snapshot: lrTest.testName,
          result_type_snapshot: lrTest.resultType,
          unit_snapshot: lrTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 1,
          numeric_value: arr5Lr,
          evaluation_status: 'PASSED',
          is_passed: true,
          recorded_at: new Date(timeYestArr5.getTime() + 1800000),
        },
        {
          session_id: session5.id,
          test_id: fatTest.id,
          test_code_snapshot: fatTest.testCode,
          test_name_snapshot: fatTest.testName,
          result_type_snapshot: fatTest.resultType,
          unit_snapshot: fatTest.unit,
          is_required_snapshot: true,
          display_order_snapshot: 2,
          numeric_value: arr5Fat,
          evaluation_status: 'PASSED',
          is_passed: true,
          recorded_at: new Date(timeYestArr5.getTime() + 1800000),
        },
      ],
    });
  }

  const receipt5 = await prisma.zmccTankReceipt.create({
    data: {
      lab_session_id: session5.id,
      zmcc_id: hasilpurSource.id,
      tank_id: hasilpurTank.id,
      arrival_type: 'MOT',
      quantity_value: arr5QtyLiters,
      quantity_unit: 'LITER',
      density: arr5Metrics.density,
      gross_liters: arr5Metrics.grossLiters,
      lr: arr5Lr,
      fat: arr5Fat,
      snf: arr5Metrics.snf,
      ts: arr5Metrics.ts,
      at_13ts_liters: arr5Metrics.at13tsLiters,
      calculation_version: arr5Metrics.calculationVersion,
      received_at: new Date(timeYestArr5.getTime() + 2700000),
      received_by_user_id: zmccLabUser.id,
    },
  });

  await prisma.zmccTankInventoryTransaction.create({
    data: {
      tank_id: hasilpurTank.id,
      zmcc_id: hasilpurSource.id,
      transaction_type: 'RECEIPT',
      quantity_liters: arr5QtyLiters,
      tank_receipt_id: receipt5.id,
      reference_type: 'ZMCC_LAB_SESSION',
      reference_id: session5.id.toString(),
      idempotency_key: `ZMCC_TANK_RECEIPT:LAB_SESSION:${session5.id}`,
      operational_timestamp: new Date(timeYestArr5.getTime() + 2700000),
      performed_by_user_id: zmccLabUser.id,
      notes: 'Demo MOT Tank Receipt - Hasilpur',
    },
  });

  console.log('✅ ZMCC Hasilpur Demo Records successfully created:');
  console.log('  - Local Suppliers: 3 created (2 Active, 1 Inactive)');
  console.log('  - Arrivals: 5 created (2 Inside ZMCC, 3 Exited)');
  console.log('  - Lab Sessions: 4 created (1 In-Progress, 2 Accepted, 1 Rejected)');
  console.log('  - Tank Receipts: 2 created (Total Stock: 6,900 L into TK-HAS-01)\n');

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
  console.log(`\nReconciled ZMCC Tank Stock Balance:`);
  console.log(`  - ${hasilpurTank.tank_code} (${hasilpurTank.tank_name}): Physical Stock Ledger Balance = ${physicalStock.toLocaleString()} L`);
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
      hasilpurSuppliers: 3,
      hasilpurArrivals: 5,
      hasilpurLabSessions: 4,
      hasilpurTankReceipts: 2,
      hasilpurTankStockLiters: physicalStock,
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
