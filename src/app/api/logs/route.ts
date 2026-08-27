import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@backend/core/auth';
import { prisma } from '@backend/core/db';
import { User, Role } from '@backend/core/types';
import { getOperationalLogs } from '@backend/services/operationalReadModelService';
import { getOperationalBusinessDate } from '@backend/core/business-day';

export async function GET(req: NextRequest) {
  try {
    const authUser = await getCurrentUser(req);
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required.' }, { status: 401 });
    }

    const dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ username: authUser.username }, { id: BigInt(authUser.id) }],
        is_active: true,
      },
      include: { procurement_source: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'Unauthorized: User not found or inactive.' }, { status: 401 });
    }

    const authoritativeUser: User = {
      id: dbUser.id.toString(),
      username: dbUser.username,
      name: dbUser.full_name || dbUser.username,
      role: dbUser.role as Role,
      department: dbUser.department || '',
      zone: authUser.zone || dbUser.procurement_source?.name || null,
      scope_type: dbUser.scope_type || 'SOURCE',
      procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
    };

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    const contractor = searchParams.get('contractor') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;

    // Date validation
    if (fromDate) {
      const fromDateObj = new Date(fromDate);
      if (isNaN(fromDateObj.getTime())) {
        return NextResponse.json(
          { error: 'Invalid fromDate parameter.' },
          { status: 400 }
        );
      }
    }
    if (toDate) {
      const toDateObj = new Date(toDate);
      if (isNaN(toDateObj.getTime())) {
        return NextResponse.json(
          { error: 'Invalid toDate parameter.' },
          { status: 400 }
        );
      }
    }
    if (fromDate && toDate && fromDate > toDate) {
      return NextResponse.json(
        { error: 'From Date cannot be after To Date.' },
        { status: 400 }
      );
    }

    const logs = await getOperationalLogs({ fromDate, toDate, contractor, status, search }, authoritativeUser);
    const serverBusinessDate = getOperationalBusinessDate(new Date());

    return NextResponse.json({
      logs,
      serverBusinessDate,
      metadata: {
        serverBusinessDate,
        serverTimestamp: new Date().toISOString(),
      },
    });
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


