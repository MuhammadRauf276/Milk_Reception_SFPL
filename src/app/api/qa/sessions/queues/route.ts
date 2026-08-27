import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';

  try {
    const now = new Date();

    // 1. Queue: Waiting for Testing (TOKEN_ISSUED or PLANT_QA with no active session)
    const waitingVisits = await prisma.vehicleVisit.findMany({
      where: {
        current_status: { in: ['TOKEN_ISSUED', 'Dispatched'] },
        gate_log: { entry_timestamp: { not: null } },
        qa_session: { is: null },
        ...(query
          ? {
              OR: [
                { visit_number: { contains: query, mode: 'insensitive' } },
                { reception_number: { contains: query, mode: 'insensitive' } },
                { vehicle_number: { contains: query, mode: 'insensitive' } },
                { token_number: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        portions: true,
        gate_log: true,
      },
      orderBy: { gate_log: { entry_timestamp: 'asc' } },
    });

    const waitingFormatted = waitingVisits.map((v) => {
      const entryTime = v.gate_log?.entry_timestamp ? new Date(v.gate_log.entry_timestamp) : null;
      const waitingMinutes = entryTime ? Math.max(0, Math.floor((now.getTime() - entryTime.getTime()) / (1000 * 60))) : 0;
      const portions = v.portions || [];
      const totalVehicleQty = v.vehicle_dispatch_quantity_value !== null && v.vehicle_dispatch_quantity_value !== undefined
        ? Number(v.vehicle_dispatch_quantity_value)
        : null;
      const totalVehicleUnit = v.vehicle_dispatch_quantity_unit || null;

      return {
        id: v.id.toString(),
        visit_number: v.visit_number,
        reception_number: v.reception_number || null,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        portion_count: portions.length,
        vehicle_dispatch_quantity_value: totalVehicleQty,
        vehicle_dispatch_quantity_unit: totalVehicleUnit,
        total_quantity_value: totalVehicleQty,
        total_quantity_unit: totalVehicleUnit,
        entry_timestamp: entryTime ? entryTime.toISOString() : null,
        waiting_minutes: waitingMinutes,
      };
    });

    // 2. Queue: In Testing (qa_session.status = 'IN_PROGRESS')
    const inTestingSessions = await prisma.qATestingSession.findMany({
      where: {
        status: 'IN_PROGRESS',
        visit: {
          current_status: 'PLANT_QA',
          ...(query
            ? {
                OR: [
                  { visit_number: { contains: query, mode: 'insensitive' } },
                  { reception_number: { contains: query, mode: 'insensitive' } },
                  { vehicle_number: { contains: query, mode: 'insensitive' } },
                  { token_number: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        visit: {
          include: {
            portions: true,
            gate_log: true,
          },
        },
        starter: true,
      },
      orderBy: { started_at: 'asc' },
    });

    const inTestingFormatted = inTestingSessions.map((s) => {
      const v = s.visit;
      const portions = v.portions || [];
      const finalizedCount = portions.filter((p) => p.plant_decision === 'ACCEPTED' || p.plant_decision === 'REJECTED').length;
      const startedAt = new Date(s.started_at);
      const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / (1000 * 60)));

      return {
        id: v.id.toString(),
        sessionId: s.id.toString(),
        visit_number: v.visit_number,
        reception_number: v.reception_number || null,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        started_by_name: s.starter.full_name || s.starter.username,
        started_by_user_id: s.starter.id.toString(),
        started_at: startedAt.toISOString(),
        elapsed_minutes: elapsedMinutes,
        portion_count: portions.length,
        finalized_portion_count: finalizedCount,
      };
    });

    // 3. Queue: On Hold (qa_session.status = 'ON_HOLD' or portions with decision = 'HOLD')
    const holdSessions = await prisma.qATestingSession.findMany({
      where: {
        status: 'ON_HOLD',
        visit: {
          current_status: 'PLANT_QA',
          ...(query
            ? {
                OR: [
                  { visit_number: { contains: query, mode: 'insensitive' } },
                  { reception_number: { contains: query, mode: 'insensitive' } },
                  { vehicle_number: { contains: query, mode: 'insensitive' } },
                  { token_number: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        visit: {
          include: {
            portions: true,
          },
        },
        starter: true,
        events: {
          where: { event_type: 'HOLD' },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    const holdFormatted = holdSessions.map((s) => {
      const v = s.visit;
      const portions = v.portions || [];
      const holdPortion = portions.find((p) => p.plant_decision === 'HOLD') || portions[0];
      const holdEvent = s.events[0];
      const holdReason = holdPortion?.plant_rejection_reason || holdEvent?.note || 'QA Hold for review/retest';
      const heldSince = holdEvent?.timestamp ? holdEvent.timestamp.toISOString() : s.updated_at.toISOString();

      return {
        id: v.id.toString(),
        sessionId: s.id.toString(),
        visit_number: v.visit_number,
        reception_number: v.reception_number || null,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        portion_number: holdPortion?.portion_number || 1,
        hold_reason: holdReason,
        held_since: heldSince,
        chemist_name: s.starter.full_name || s.starter.username,
        chemist_user_id: s.starter.id.toString(),
      };
    });

    return NextResponse.json({
      waiting: waitingFormatted,
      inTesting: inTestingFormatted,
      onHold: holdFormatted,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch QA queues' }, { status: 500 });
  }
}
