import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@backend/core/auth';
import { prisma } from '@backend/core/db';
import { User, Role } from '@backend/core/types';
import { getOperationalLogs } from '@backend/services/operationalReadModelService';
import { getOperationalBusinessDate } from '@backend/core/business-day';
import { isValidDateOnly } from '@/lib/datetime-utils';

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
    const hasFromDate = searchParams.has('fromDate');
    const hasToDate = searchParams.has('toDate');
    const fromDateRaw = searchParams.get('fromDate');
    const toDateRaw = searchParams.get('toDate');
    const contractor = searchParams.get('contractor') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;

    // Date validation
    if (hasFromDate) {
      if (!fromDateRaw || !isValidDateOnly(fromDateRaw)) {
        return NextResponse.json(
          { error: 'Invalid fromDate parameter. Expected valid calendar date in YYYY-MM-DD format.' },
          { status: 400 }
        );
      }
    }
    if (hasToDate) {
      if (!toDateRaw || !isValidDateOnly(toDateRaw)) {
        return NextResponse.json(
          { error: 'Invalid toDate parameter. Expected valid calendar date in YYYY-MM-DD format.' },
          { status: 400 }
        );
      }
    }

    const fromDate = hasFromDate ? fromDateRaw! : undefined;
    const toDate = hasToDate ? toDateRaw! : undefined;

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


