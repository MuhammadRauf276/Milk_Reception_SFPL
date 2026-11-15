import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { getRoadRoute, MAX_ROUTE_POINTS } from '@/backend/services/map/roadRouteService';
import { toPosition, type MapPosition } from '@/lib/coordinates';

/**
 * The road path through a list of places, for the journey maps.
 * Body: { points: [{ latitude, longitude }, ...] } in travel order.
 * Answers { route: null } when no road path is available; the map then draws straight lines.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw: unknown = body?.points;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_ROUTE_POINTS) {
    return NextResponse.json({ route: null });
  }

  const points: MapPosition[] = [];
  for (const p of raw) {
    const at = toPosition((p as { latitude?: unknown })?.latitude, (p as { longitude?: unknown })?.longitude);
    if (!at) return NextResponse.json({ route: null });
    points.push(at);
  }

  const route = await getRoadRoute(points);
  return NextResponse.json({ route }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
