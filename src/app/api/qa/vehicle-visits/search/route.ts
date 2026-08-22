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
        current_status: { notIn: ['DISPATCHED', 'COMPLETED', 'CANCELLED'] },
        ...(query
          ? {
              OR: [
                { visit_number: { contains: query, mode: 'insensitive' } },
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
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    const formatted = visits.map((v) => {
      const portions = v.portions || [];
      const totalVehicleQty = v.vehicle_dispatch_quantity_value !== null && v.vehicle_dispatch_quantity_value !== undefined
        ? Number(v.vehicle_dispatch_quantity_value)
        : null;
      const totalVehicleUnit = v.vehicle_dispatch_quantity_unit || null;

      // Determine visit decision summary
      const decisions = portions.map((p) => p.plant_decision || 'PENDING');
      const allAccepted = decisions.length > 0 && decisions.every((d) => d === 'ACCEPTED');
      const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');
      const hasAccepted = decisions.some((d) => d === 'ACCEPTED');
      const hasRejected = decisions.some((d) => d === 'REJECTED');

      let visitDecisionSummary = 'PENDING';
      if (allAccepted) visitDecisionSummary = 'ACCEPTED';
      else if (allRejected) visitDecisionSummary = 'REJECTED';
      else if (hasAccepted && hasRejected) visitDecisionSummary = 'PARTIALLY_ACCEPTED';

      return {
        id: v.id.toString(),
        visit_number: v.visit_number,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        current_status: v.current_status,
        portion_count: portions.length,
        vehicle_dispatch_quantity_value: totalVehicleQty,
        vehicle_dispatch_quantity_unit: totalVehicleUnit,
        total_quantity_value: totalVehicleQty,
        total_quantity_unit: totalVehicleUnit,
        visit_decision_summary: visitDecisionSummary,
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to search vehicle visits' }, { status: 500 });
  }
}
