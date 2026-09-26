import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { paperLinkedIdentity } from '@/backend/modules/paper-references';

const SECURITY_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Security' } as const;

export async function GET(req: Request) {
  const access = await requireCapability('VIEW', SECURITY_SCOPE, { request: req });
  if (!access.allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';

  try {
    const visits = await prisma.vehicleVisit.findMany({
      where: {
        current_status: 'READY_FOR_GATE_EXIT',
        gate_log: {
          entry_timestamp: { not: null },
          exit_timestamp: null,
        },
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
        weight_ticket: true,
      },
      orderBy: { updated_at: 'desc' },
    });

    const formatted = visits.map((v) => {
      const portions = v.portions || [];
      const decisions = portions.map((p) => p.plant_decision);
      const allRejected = decisions.length > 0 && decisions.every((d) => d === 'REJECTED');

      const netWeight = v.weight_ticket?.net_weight_kg ? Number(v.weight_ticket.net_weight_kg) : null;
      const grossWeight = v.weight_ticket?.gross_weight_kg ? Number(v.weight_ticket.gross_weight_kg) : null;
      const tareWeight = v.weight_ticket?.tare_weight_kg ? Number(v.weight_ticket.tare_weight_kg) : null;

      const exitReason = allRejected ? 'QA Rejected' : 'Processing Complete';

      return {
        id: v.id.toString(),
        visit_number: v.visit_number,
        reception_number: v.reception_number || null,
        vehicle_number: v.vehicle_number,
        token_number: v.token_number || null,
        identifiers: paperLinkedIdentity(
          { entity: 'vehicle_visit', id: v.id.toString(), number: v.visit_number },
          [{ type: 'PLANT_GATE_TOKEN', value: v.token_number || null }]
        ),
        entry_timestamp: v.gate_log?.entry_timestamp ? v.gate_log.entry_timestamp.toISOString() : null,
        portion_count: portions.length,
        current_status: v.current_status,
        exit_reason: exitReason,
        is_all_rejected: allRejected,
        gross_weight_kg: grossWeight,
        tare_weight_kg: tareWeight,
        net_weight_kg: netWeight,
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch ready-for-exit visits' }, { status: 500 });
  }
}
