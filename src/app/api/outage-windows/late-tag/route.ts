import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { lateEntryTags } from '@/backend/services/outageWindowService';

const TABLES = new Set(['vehicle_visit', 'zmcc_mot_arrival', 'zmcc_local_supplier_arrival', 'silo_transaction']);

/** The "Entered late (outage)" tag for one record on Inspect: the window it was entered under, or null. */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    const url = new URL(req.url);
    const table = url.searchParams.get('table') ?? '';
    const id = url.searchParams.get('id') ?? '';
    if (!TABLES.has(table) || !/^\d{1,19}$/.test(id)) return NextResponse.json({ error: 'Unknown record.' }, { status: 400 });
    const windowId = (await lateEntryTags(table, [id])).get(id);
    if (!windowId) return NextResponse.json({ window: null }, { headers: { 'Cache-Control': 'no-store' } });
    const w = await prisma.outageWindow.findUnique({
      where: { id: BigInt(windowId) },
      select: { id: true, starts_at: true, ends_at: true, reason: true },
    });
    return NextResponse.json(
      {
        window: w
          ? { id: String(w.id), starts_at: w.starts_at.toISOString(), ends_at: w.ends_at.toISOString(), reason: w.reason }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('GET /api/outage-windows/late-tag error:', err);
    return NextResponse.json({ error: 'Could not check the late entry.' }, { status: 500 });
  }
}
