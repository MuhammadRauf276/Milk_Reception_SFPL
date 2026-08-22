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
    const visits = await prisma.vehicleVisit.findMany({
      where: {
        current_status: 'READY_FOR_GROSS',
        gate_log: { entry_timestamp: { not: null } },
        weight_ticket: { is: null },
        ...(query
          ? {
              OR: [
                { vehicle_number: { contains: query, mode: 'insensitive' } },
                { token_number: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
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
      orderBy: {
        gate_log: {
          entry_timestamp: 'asc',
        },
      },
    });

    const formatted = visits.map((v) => {
      const portions = v.portions || [];
      const acceptedPortions = portions.filter((p) => (p.plant_decision || '').toUpperCase() === 'ACCEPTED');
      const rejectedPortions = portions.filter((p) => (p.plant_decision || '').toUpperCase() === 'REJECTED');
      const acceptedDeclaredKg = acceptedPortions.reduce(
        (sum, p) => sum + (p.dispatch_quantity_value ? Number(p.dispatch_quantity_value) : 0),
        0
      );

      // Determine plant decision summary
      const decisions = portions.map((p) => (p.plant_decision || 'PENDING').toUpperCase());
      const allAccepted = decisions.length > 0 && decisions.every((d) => d === 'ACCEPTED');
      const hasAccepted = decisions.some((d) => d === 'ACCEPTED');
      const hasRejected = decisions.some((d) => d === 'REJECTED');

      let plantDecisionSummary = 'PENDING';
      if (allAccepted) plantDecisionSummary = 'ACCEPTED';
      else if (hasAccepted && hasRejected) plantDecisionSummary = 'PARTIALLY_ACCEPTED';

      const now = new Date();
      const entryTime = v.gate_log?.entry_timestamp ? new Date(v.gate_log.entry_timestamp) : now;
      const firstDispatchInfo = portions.find((p) => p.dispatch_info)?.dispatch_info;
      const dispatchTime = firstDispatchInfo?.dispatch_timestamp ? new Date(firstDispatchInfo.dispatch_timestamp) : null;
      const qaCompletedTime = v.qa_session?.completed_at ? new Date(v.qa_session.completed_at) : (v.qa_session?.updated_at ? new Date(v.qa_session.updated_at) : null);

      // Determine minimum allowed operational timestamp (latest of dispatch, gate entry, QA completion)
      const timestampsToCompare: number[] = [];
      if (dispatchTime) timestampsToCompare.push(dispatchTime.getTime());
      if (entryTime) timestampsToCompare.push(entryTime.getTime());
      if (qaCompletedTime) timestampsToCompare.push(qaCompletedTime.getTime());

      const minAllowedTimestampMs = timestampsToCompare.length > 0 ? Math.max(...timestampsToCompare) : entryTime.getTime();
      const minAllowedTimestampIso = new Date(minAllowedTimestampMs).toISOString();

      const waitingMinutes = Math.max(0, Math.floor((now.getTime() - entryTime.getTime()) / 60000));
      const opDateStr = v.operational_date
        ? new Date(v.operational_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      return {
        id: v.id.toString(),
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        operational_date: opDateStr,
        entry_timestamp: v.gate_log?.entry_timestamp ? v.gate_log.entry_timestamp.toISOString() : null,
        dispatch_timestamp: dispatchTime ? dispatchTime.toISOString() : null,
        qa_completed_timestamp: qaCompletedTime ? qaCompletedTime.toISOString() : null,
        min_allowed_timestamp: minAllowedTimestampIso,
        current_status: v.current_status,
        portion_count: portions.length,
        accepted_portion_count: acceptedPortions.length,
        rejected_portion_count: rejectedPortions.length,
        vehicle_dispatch_quantity_value: v.vehicle_dispatch_quantity_value !== null && v.vehicle_dispatch_quantity_value !== undefined
          ? Number(v.vehicle_dispatch_quantity_value)
          : null,
        vehicle_dispatch_quantity_unit: v.vehicle_dispatch_quantity_unit || null,
        vehicle_dispatch_quantity_basis: v.vehicle_dispatch_quantity_basis || null,
        vehicle_dispatch_measurement_method: v.vehicle_dispatch_measurement_method || null,
        waiting_minutes: waitingMinutes,
        plant_decision_summary: plantDecisionSummary,
        portions: portions.map((p) => ({
          id: p.id.toString(),
          portion_number: p.portion_number,
          dispatch_quantity_value: p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? Number(p.dispatch_quantity_value) : null,
          dispatch_quantity_unit: p.dispatch_quantity_unit || null,
          dispatch_quantity_basis: p.dispatch_quantity_basis || null,
          dispatch_measurement_method: p.dispatch_measurement_method || null,
          plant_decision: p.plant_decision || 'PENDING',
          plant_rejection_reason: p.plant_rejection_reason || null,
        })),
      };
    });

    // STRICT ELIGIBILITY RULE: A vehicle must have at least 1 QA-accepted portion to be eligible for gross weighing
    const eligibleVisits = formatted.filter((v) => v.accepted_portion_count > 0);

    return NextResponse.json({ visits: eligibleVisits });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch visits ready for gross weight' }, { status: 500 });
  }
}
