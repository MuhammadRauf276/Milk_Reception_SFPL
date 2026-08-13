import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const visits = await prisma.vehicleVisit.findMany({
      where: {
        gate_log: {
          entry_timestamp: { not: null },
          exit_timestamp: null,
        },
      },
      include: {
        portions: true,
        gate_log: true,
      },
      orderBy: {
        gate_log: {
          entry_timestamp: 'asc',
        },
      },
    });

    const formatted = visits.map((v) => {
      const portions = v.portions || [];
      const totalDeclaredKg = portions.reduce(
        (sum, p) => sum + (p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0),
        0
      );

      // Determine plant decision summary
      const decisions = portions.map((p) => p.plant_decision || 'PENDING');
      const allAccepted = decisions.length > 0 && decisions.every((d) => d === 'ACCEPTED');
      const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');
      const hasAccepted = decisions.some((d) => d === 'ACCEPTED');
      const hasRejected = decisions.some((d) => d === 'REJECTED');

      let plantDecisionSummary = 'PENDING';
      if (allAccepted) plantDecisionSummary = 'ACCEPTED';
      else if (allRejected) plantDecisionSummary = 'REJECTED';
      else if (hasAccepted && hasRejected) plantDecisionSummary = 'PARTIALLY_ACCEPTED';

      return {
        id: v.id.toString(),
        visit_number: v.visit_number,
        reception_number: v.reception_number || null,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        entry_timestamp: v.gate_log?.entry_timestamp ? v.gate_log.entry_timestamp.toISOString() : null,
        portion_count: portions.length,
        total_declared_kg: totalDeclaredKg,
        current_status: v.current_status,
        plant_decision_summary: plantDecisionSummary,
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch active in-plant visits' }, { status: 500 });
  }
}
