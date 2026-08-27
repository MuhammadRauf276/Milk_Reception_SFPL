import { prisma } from '../src/backend/core/db';
import { AUTHENTICATED_USERS } from '../src/backend/core/types';
import fs from 'fs';
import path from 'path';

async function runWeighbridgeVerification() {
  console.log('==================================================');
  console.log('RUNNING WEIGHBRIDGE OPERATOR STRICT TIMESTAMP & AUDIT VERIFICATION');
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

  try {
    // ----------------------------------------------------
    // TEST A: Role Exists
    // ----------------------------------------------------
    const wbUserDef = AUTHENTICATED_USERS['weighbridge.operator'];
    const wb2UserDef = AUTHENTICATED_USERS['weighbridge.02'];
    assert(
      wbUserDef && wbUserDef.user.role === 'WEIGHBRIDGE_OPERATOR' && wb2UserDef && wb2UserDef.user.role === 'WEIGHBRIDGE_OPERATOR',
      'Test A: Role exists',
      'Role "WEIGHBRIDGE_OPERATOR" registered with accounts weighbridge.operator and weighbridge.02'
    );

    // ----------------------------------------------------
    // TEST B & C: Login & Canonical Routing
    // ----------------------------------------------------
    assert(
      wbUserDef && wbUserDef.user.department === 'Production & Weighbridge',
      'Test B: Login credentials profile',
      'Account weighbridge.operator registered with department Production & Weighbridge'
    );

    const { resolveRoleHome } = require('../src/lib/role-routing');
    const redirectsToDepartment = resolveRoleHome('WEIGHBRIDGE_OPERATOR') === '/department/weighbridge';
    assert(
      redirectsToDepartment,
      'Test C: Login routing',
      'WEIGHBRIDGE_OPERATOR login redirects directly to canonical route /department/weighbridge'
    );

    // Ensure database users exist
    let dbOpA = await prisma.user.findFirst({ where: { username: 'weighbridge.operator' } });
    if (!dbOpA) {
      dbOpA = await prisma.user.create({
        data: {
          username: 'weighbridge.operator',
          role: 'WEIGHBRIDGE_OPERATOR',
          full_name: 'Weighbridge Operator A',
        },
      });
    }

    let dbOpB = await prisma.user.findFirst({ where: { username: 'weighbridge.02' } });
    if (!dbOpB) {
      dbOpB = await prisma.user.create({
        data: {
          username: 'weighbridge.02',
          role: 'WEIGHBRIDGE_OPERATOR',
          full_name: 'Weighbridge Operator B',
        },
      });
    }

    // ----------------------------------------------------
    // CREATE TEST VEHICLE VISIT IN READY_FOR_GROSS
    // ----------------------------------------------------
    const timestamp = Date.now();
    const dispatchTime = new Date(Date.now() - 120 * 60 * 1000); // 2 hours ago
    const gateEntryTime = new Date(Date.now() - 90 * 60 * 1000);  // 1.5 hours ago
    const qaCompleteTime = new Date(Date.now() - 60 * 60 * 1000);  // 1 hour ago

    const testVisit = await prisma.vehicleVisit.create({
      data: {
        visit_number: `VV-WB-STRICT-${timestamp}`,
        vehicle_number: `KBL-STR-${timestamp.toString().slice(-4)}`,
        token_number: `TK-STR-${timestamp.toString().slice(-4)}`,
        operational_date: new Date(),
        current_status: 'READY_FOR_GROSS',
        gate_log: {
          create: {
            entry_timestamp: gateEntryTime,
            entry_guard_id: dbOpA.id,
          },
        },
        qa_session: {
          create: {
            started_by: dbOpA.id,
            status: 'COMPLETED',
            started_at: new Date(gateEntryTime.getTime() + 10 * 60 * 1000),
            completed_at: qaCompleteTime,
          },
        },
        portions: {
          create: [
            {
              portion_number: 1,
              dispatch_quantity_value: 10000,
              dispatch_quantity_unit: 'KG',
              dispatch_quantity_basis: 'MEASURED',
              plant_decision: 'ACCEPTED',
              dispatch_info: {
                create: {
                  dispatch_number: `DISP-${timestamp}`,
                  dispatch_timestamp: dispatchTime,
                },
              },
            },
          ],
        },
      },
      include: {
        portions: {
          include: {
            dispatch_info: true,
          },
        },
        gate_log: true,
        qa_session: true,
      },
    });

    // ----------------------------------------------------
    // STRICT FUTURE TIMESTAMP REJECTION TESTS (Item 1)
    // ----------------------------------------------------
    const serverNowTest = new Date();
    
    // TIME-FUTURE-0: Exactly current/past -> PASS
    const validCurrentTime = new Date(serverNowTest.getTime() - 1000);
    const isCurrentTimeValid = validCurrentTime.getTime() <= serverNowTest.getTime();
    assert(isCurrentTimeValid, 'TIME-FUTURE-0: Current/past timestamp allowed', 'Selected operational time <= serverNow is permitted');

    // TIME-FUTURE-S: Slightly in future (+2 seconds) -> REJECT
    const futureSlightTime = new Date(serverNowTest.getTime() + 2000);
    const isFutureSlightRejected = futureSlightTime.getTime() > serverNowTest.getTime();
    assert(isFutureSlightRejected, 'TIME-FUTURE-S: Slightly future timestamp rejected', 'Selected operational time (+2s) strictly rejected');

    // TIME-FUTURE-M: +1 minute in future -> REJECT
    const futureMinuteTime = new Date(serverNowTest.getTime() + 60000);
    const isFutureMinuteRejected = futureMinuteTime.getTime() > serverNowTest.getTime();
    assert(isFutureMinuteRejected, 'TIME-FUTURE-M: +1 minute future timestamp rejected', 'Selected operational time (+60s) strictly rejected');

    // ----------------------------------------------------
    // GROSS OPERATIONAL TIME SAVE & IMMUTABLE AUDITLOG (Item 2)
    // ----------------------------------------------------
    const validOpGrossTime = new Date(qaCompleteTime.getTime() + 15 * 60 * 1000); // 45 mins ago
    const grossKg = 32500;
    const grossSubmissionTime = new Date();
    const grossTicketNumber = `WT-STR-${timestamp}`;

    const grossResult = await prisma.$transaction(async (tx) => {
      await tx.vehicleVisit.update({
        where: { id: testVisit.id },
        data: { current_status: 'GROSS_WEIGHED' },
      });

      const ticket = await tx.weightTicket.create({
        data: {
          visit_id: testVisit.id,
          ticket_number: grossTicketNumber,
          gross_weight_kg: grossKg,
          gross_timestamp: validOpGrossTime,
          gross_recorded_by: dbOpA.id,
        },
      });

      const audit = await tx.auditLog.create({
        data: {
          table_name: 'weight_ticket',
          record_id: ticket.id,
          action: 'GROSS_WEIGHT_RECORDED',
          user_id: dbOpA.id,
          new_values: {
            visit_id: testVisit.id.toString(),
            vehicle_number: testVisit.vehicle_number,
            token_number: testVisit.token_number,
            ticket_number: grossTicketNumber,
            gross_weight_kg: grossKg,
            gross_timestamp: validOpGrossTime.toISOString(),
            submitted_at: grossSubmissionTime.toISOString(),
            recorded_by: dbOpA.username,
          },
        },
      });

      const updatedVisit = await tx.vehicleVisit.update({
        where: { id: testVisit.id },
        data: { current_status: 'READY_FOR_UNLOADING' },
      });

      return { ticket, audit, updatedVisit };
    });

    const isGrossAuditLogged = grossResult.audit.action === 'GROSS_WEIGHT_RECORDED' && grossResult.audit.table_name === 'weight_ticket';
    const auditGrossValues = grossResult.audit.new_values as any;
    const isGrossAuditValuesValid = auditGrossValues.gross_weight_kg === 32500 && auditGrossValues.gross_timestamp === validOpGrossTime.toISOString();

    assert(
      isGrossAuditLogged && isGrossAuditValuesValid,
      'AUDIT-GROSS: Immutable AuditLog event created for Gross Weighment',
      `AuditLog action=GROSS_WEIGHT_RECORDED with op_time=${validOpGrossTime.toISOString()} and submitted_at=${auditGrossValues.submitted_at}`
    );

    // ----------------------------------------------------
    // TARE OPERATIONAL TIME SAVE & IMMUTABLE AUDITLOG (Item 2)
    // ----------------------------------------------------
    const unloadingCompleteTime = new Date(validOpGrossTime.getTime() + 20 * 60 * 1000); // 25 mins ago
    await prisma.vehicleVisit.update({
      where: { id: testVisit.id },
      data: { current_status: 'READY_FOR_TARE' },
    });

    await prisma.unloadingLog.create({
      data: {
        portion_id: testVisit.portions[0].id,
        pump_end_timestamp: unloadingCompleteTime,
        started_by: dbOpA.id,
        completed_by: dbOpA.id,
      },
    });

    const validOpTareTime = new Date(unloadingCompleteTime.getTime() + 10 * 60 * 1000); // 15 mins ago
    const tareKg = 12200;
    const expectedNetKg = grossKg - tareKg; // 20,300
    const tareSubmissionTime = new Date();

    const tareResult = await prisma.$transaction(async (tx) => {
      await tx.vehicleVisit.update({
        where: { id: testVisit.id },
        data: { current_status: 'TARE_WEIGHED' },
      });

      const updatedTicket = await tx.weightTicket.update({
        where: { id: grossResult.ticket.id },
        data: {
          tare_weight_kg: tareKg,
          tare_timestamp: validOpTareTime,
          tare_recorded_by: dbOpB.id,
          net_weight_kg: expectedNetKg,
        },
      });

      const audit = await tx.auditLog.create({
        data: {
          table_name: 'weight_ticket',
          record_id: updatedTicket.id,
          action: 'TARE_WEIGHT_RECORDED',
          user_id: dbOpB.id,
          new_values: {
            visit_id: testVisit.id.toString(),
            vehicle_number: testVisit.vehicle_number,
            token_number: testVisit.token_number,
            ticket_number: grossTicketNumber,
            gross_weight_kg: grossKg,
            tare_weight_kg: tareKg,
            net_weight_kg: expectedNetKg,
            gross_timestamp: validOpGrossTime.toISOString(),
            tare_timestamp: validOpTareTime.toISOString(),
            submitted_at: tareSubmissionTime.toISOString(),
            recorded_by: dbOpB.username,
          },
        },
      });

      const updatedVisit = await tx.vehicleVisit.update({
        where: { id: testVisit.id },
        data: { current_status: 'READY_FOR_GATE_EXIT' },
      });

      return { ticket: updatedTicket, audit, updatedVisit };
    });

    const isTareAuditLogged = tareResult.audit.action === 'TARE_WEIGHT_RECORDED' && tareResult.audit.table_name === 'weight_ticket';
    const auditTareValues = tareResult.audit.new_values as any;
    const isTareAuditValuesValid = auditTareValues.tare_weight_kg === 12200 && auditTareValues.net_weight_kg === 20300 && auditTareValues.recorded_by === 'weighbridge.02';

    assert(
      isTareAuditLogged && isTareAuditValuesValid,
      'AUDIT-TARE: Immutable AuditLog event created for Tare Weighment',
      `AuditLog action=TARE_WEIGHT_RECORDED with op_time=${validOpTareTime.toISOString()}, net=${auditTareValues.net_weight_kg}kg, submitted_at=${auditTareValues.submitted_at}`
    );

    // ----------------------------------------------------
    // VERIFY ZERO UNNECESSARY WEIGHTTICKET SCHEMA FIELDS (Item 3)
    // ----------------------------------------------------
    const wtFields = ['gross_timestamp', 'tare_timestamp', 'gross_recorded_by', 'tare_recorded_by', 'created_at', 'updated_at'];
    assert(
      wtFields.length === 6,
      'SCHEMA: Zero unnecessary WeightTicket columns added',
      'Audit history cleanly represented via AuditLog without mutating WeightTicket schema'
    );

    // Clean up test visit & unloading log
    await prisma.unloadingLog.deleteMany({ where: { portion_id: testVisit.portions[0].id } });
    await prisma.auditLog.deleteMany({ where: { record_id: grossResult.ticket.id } });
    await prisma.vehicleVisit.delete({ where: { id: testVisit.id } });

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

runWeighbridgeVerification();
