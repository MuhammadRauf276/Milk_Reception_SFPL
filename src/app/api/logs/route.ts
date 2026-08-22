import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@backend/core/auth';
import { getOperationalLogs } from '@backend/services/operationalReadModelService';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    const contractor = searchParams.get('contractor') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;

    // Date validation
    if (fromDate && toDate && fromDate > toDate) {
      return NextResponse.json(
        { error: 'From Date cannot be after To Date.' },
        { status: 400 }
      );
    }

    const logs = await getOperationalLogs({ fromDate, toDate, contractor, status, search }, user);
    return NextResponse.json({ logs });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to fetch logs' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Legacy POST /api/logs is deprecated. Use POST /api/dispatches for operational submissions.' },
    { status: 405 }
  );
}

export async function PATCH() {
  return NextResponse.json(
    { error: 'Legacy PATCH /api/logs is deprecated. Use departmental APIs for state transitions.' },
    { status: 405 }
  );
}


