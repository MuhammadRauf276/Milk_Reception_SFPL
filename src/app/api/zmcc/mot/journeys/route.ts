import { NextResponse } from 'next/server';
import { resolveMotAuth, listMotJourneys } from '@/backend/services/motService';

export async function GET(req: Request) {
  // A superior covering MOT work picks a journey here. A real MOT is still refused, by its own role.
  const coveringMot = req.headers.get('x-acting-as') === 'MOT';
  const { auth, errorResponse } = await resolveMotAuth(req, 'READ', coveringMot ? { requestedAs: null } : {});
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const operational_date = searchParams.get('operational_date') || undefined;
  const zmcc_id = searchParams.get('zmcc_id') || searchParams.get('zmccId') || req.headers.get('x-acting-source-id') || undefined;
  const route_id = searchParams.get('route_id') || undefined;
  const mot_profile_id = searchParams.get('mot_profile_id') || undefined;
  const mot_vehicle_id = searchParams.get('mot_vehicle_id') || undefined;

  try {
    const journeys = await listMotJourneys(auth!, {
      status,
      operational_date,
      zmcc_id,
      route_id,
      mot_profile_id,
      mot_vehicle_id,
    });
    return NextResponse.json({ journeys });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching Mobile Tester journeys.' }, { status: 500 });
  }
}
