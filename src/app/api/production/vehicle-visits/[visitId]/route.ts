import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ visitId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visitId: visitIdStr } = await params;
    const visitId = BigInt(visitIdStr);

    const v = await prisma.vehicleVisit.findUnique({
      where: { id: visitId },
      include: {
        portions: {
          include: {
            unloading_log: true,
          },
          orderBy: { portion_number: 'asc' },
        },
        weight_ticket: true,
      },
    });

    if (!v) {
      return NextResponse.json({ error: 'Vehicle visit not found' }, { status: 404 });
    }

    const acceptedPortions = v.portions.filter((p) => p.plant_decision === 'ACCEPTED');
    const rejectedPortions = v.portions.filter((p) => p.plant_decision === 'REJECTED');
    const totalAcceptedDeclaredKg = acceptedPortions.reduce(
      (sum, p) => sum + (p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0),
      0
    );

    const formatted = {
      id: String(v.id),
      visit_number: v.visit_number,
      vehicle_number: v.vehicle_number,
      token_number: v.token_number,
      current_status: v.current_status,
      gross_weight_kg: v.weight_ticket?.gross_weight_kg ? Number(v.weight_ticket.gross_weight_kg) : null,
      gross_timestamp: v.weight_ticket?.gross_timestamp ? v.weight_ticket.gross_timestamp.toISOString() : null,
      tare_weight_kg: v.weight_ticket?.tare_weight_kg ? Number(v.weight_ticket.tare_weight_kg) : null,
      portion_count: v.portions.length,
      accepted_portion_count: acceptedPortions.length,
      rejected_portion_count: rejectedPortions.length,
      total_accepted_declared_kg: totalAcceptedDeclaredKg,
      portions: v.portions.map((p) => ({
        id: String(p.id),
        portion_number: p.portion_number,
        declared_quantity_kg: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0,
        plant_decision: p.plant_decision || 'PENDING',
        plant_rejection_reason: p.plant_rejection_reason || null,
        current_status: p.current_status,
        unloading_log: p.unloading_log
          ? {
              id: String(p.unloading_log.id),
              silo_number: p.unloading_log.silo_number,
              pump_start_timestamp: p.unloading_log.pump_start_timestamp
                ? p.unloading_log.pump_start_timestamp.toISOString()
                : null,
              pump_end_timestamp: p.unloading_log.pump_end_timestamp
                ? p.unloading_log.pump_end_timestamp.toISOString()
                : null,
            }
          : null,
      })),
    };

    return NextResponse.json({ visit: formatted });
  } catch (err: any) {
    console.error('Error fetching vehicle visit details:', err);
    return NextResponse.json({ error: 'Failed to fetch vehicle visit details' }, { status: 500 });
  }
}
