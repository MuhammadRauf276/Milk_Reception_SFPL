import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { vehicleVisitPaperIdentity } from '@/backend/modules/paper-references';

const WEIGHBRIDGE_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Production & Weighbridge' } as const;

export async function GET(req: Request) {
  const access = await requireCapability('VIEW', WEIGHBRIDGE_SCOPE, { request: req });
  if (!access.allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });
  }

  try {
    const tickets = await prisma.weightTicket.findMany({
      where: {
        gross_weight_kg: { not: null },
        tare_weight_kg: null,
      },
      include: {
        visit: true,
      },
      orderBy: {
        gross_timestamp: 'desc',
      },
    });

    const formatted = tickets.map((t) => ({
      id: t.id.toString(),
      visit_id: t.visit_id.toString(),
      ticket_number: t.ticket_number,
      token_number: t.visit.token_number || null,
      vehicle_number: t.visit.vehicle_number,
      gross_weight_kg: t.gross_weight_kg ? Number(t.gross_weight_kg) : 0,
      gross_timestamp: t.gross_timestamp ? t.gross_timestamp.toISOString() : null,
      current_status: t.visit.current_status,
      identifiers: vehicleVisitPaperIdentity(t.visit),
    }));

    return NextResponse.json({ tickets: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch open scale tickets' }, { status: 500 });
  }
}
