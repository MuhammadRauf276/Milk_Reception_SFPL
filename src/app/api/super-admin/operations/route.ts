import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get('q') || '').trim();

    const where: any = {};
    if (query) {
      where.OR = [
        { vehicle_number: { contains: query, mode: 'insensitive' } },
        { visit_number: { contains: query, mode: 'insensitive' } },
        { token_number: { contains: query, mode: 'insensitive' } },
        { current_status: { contains: query, mode: 'insensitive' } },
      ];
    }

    const visits = await prisma.vehicleVisit.findMany({
      where,
      take: 50,
      orderBy: { created_at: 'desc' },
      include: {
        portions: {
          orderBy: { portion_number: 'asc' },
          include: {
            dispatch_info: true,
            dispatch_lab_results: { include: { lab_test: true } },
            plant_lab_results: { include: { lab_test: true } },
            unloading_log: { include: { silo: true } },
          },
        },
        gate_log: true,
        weight_ticket: true,
        qa_session: true,
        procurement_source: true,
      },
    });

    const serialized = visits.map((v) => ({
      id: v.id.toString(),
      visitNumber: v.visit_number,
      vehicleNumber: v.vehicle_number,
      tokenNumber: v.token_number,
      procurementSource: v.procurement_source?.name || 'Source unavailable',
      currentStatus: v.current_status,
      createdAt: v.created_at.toISOString(),
      gateLog: v.gate_log
        ? {
            entryTimestamp: v.gate_log.entry_timestamp ? v.gate_log.entry_timestamp.toISOString() : null,
            entrySubmittedAt: v.gate_log.created_at ? v.gate_log.created_at.toISOString() : null,
            exitTimestamp: v.gate_log.exit_timestamp ? v.gate_log.exit_timestamp.toISOString() : null,
          }
        : null,
      weightTicket: v.weight_ticket
        ? {
            grossWeightKg: v.weight_ticket.gross_weight_kg ? Number(v.weight_ticket.gross_weight_kg) : null,
            grossTimestamp: v.weight_ticket.gross_timestamp ? v.weight_ticket.gross_timestamp.toISOString() : null,
            grossSubmittedAt: v.weight_ticket.created_at ? v.weight_ticket.created_at.toISOString() : null,
            tareWeightKg: v.weight_ticket.tare_weight_kg ? Number(v.weight_ticket.tare_weight_kg) : null,
            tareTimestamp: v.weight_ticket.tare_timestamp ? v.weight_ticket.tare_timestamp.toISOString() : null,
            netWeightKg: v.weight_ticket.net_weight_kg ? Number(v.weight_ticket.net_weight_kg) : null,
          }
        : null,
      portions: v.portions.map((p) => ({
        id: p.id.toString(),
        portionNumber: p.portion_number,
        contractorName: `Portion #${p.portion_number}`,
        grossLiters: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : null,
        plantDecision: p.plant_decision,
        rejectionReason: p.plant_rejection_reason,
        unloadingLog: p.unloading_log
          ? {
              siloCode: p.unloading_log.silo?.silo_code || p.unloading_log.silo_number || 'N/A',
              siloName: p.unloading_log.silo?.silo_name || 'N/A',
              status: p.unloading_log.pump_end_timestamp ? 'COMPLETED' : 'IN_PROGRESS',
              startTimestamp: p.unloading_log.pump_start_timestamp ? p.unloading_log.pump_start_timestamp.toISOString() : null,
              completeTimestamp: p.unloading_log.pump_end_timestamp ? p.unloading_log.pump_end_timestamp.toISOString() : null,
              litersUnloaded: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : null,
            }
          : null,
      })),
    }));

    return NextResponse.json({ visits: serialized });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
