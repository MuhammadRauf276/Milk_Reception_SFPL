import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    }));

    return NextResponse.json({ tickets: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch open scale tickets' }, { status: 500 });
  }
}
