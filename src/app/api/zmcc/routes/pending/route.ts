import { NextResponse } from 'next/server';
import { resolveZmccAuth, listPendingRoutes } from '@/backend/services/zmccMasterDataService';

export async function GET(req: Request) {
  const { auth, errorResponse } = await resolveZmccAuth(req, 'READ');
  if (errorResponse) {
    return NextResponse.json({ error: errorResponse.error }, { status: errorResponse.status });
  }

  try {
    const routes = await listPendingRoutes(auth!);
    return NextResponse.json({ routes });
  } catch (_err) {
    return NextResponse.json({ error: 'An unexpected error occurred while fetching pending routes.' }, { status: 500 });
  }
}
