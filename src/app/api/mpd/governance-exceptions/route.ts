import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(current.id) },
    });

    if (!user?.is_active) {
      return NextResponse.json({ error: 'User account inactive.' }, { status: 403 });
    }

    // Return audit logs / override records
    return NextResponse.json({
      success: true,
      items: [
        {
          id: 'OVR-001',
          reference: 'TKR-0941',
          sourceName: 'Hasilpur ZMCC',
          stage: 'ZMCC_GATE',
          failedParameter: 'Temperature',
          failedValue: '10.4°C',
          toleranceLimit: '10.0°C',
          attendantNote: 'Attendant flagged temperature out of spec (+0.4°C drift).',
          managerJustification: 'Chiller power dip resolved at 07:00, milk organoleptic fresh and negative COB.',
          overruledBy: 'Muhammad Akram (ZMCC Manager)',
          timestamp: new Date().toISOString(),
          status: 'PENDING_AUDIT',
        },
      ],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch governance exceptions.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(current.id) },
    });

    if (!user?.is_active || (user.role !== 'HEAD_OF_MPD' && user.role !== 'SUPER_ADMIN' && user.role !== 'QA_HEAD')) {
      return NextResponse.json(
        { error: 'Forbidden. Only MPD Head, QA Head, or Super Admin can audit governance exceptions.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { exceptionId, action, remarks } = body;

    if (!exceptionId || !['APPROVED', 'FLAGGED'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action or exceptionId.' }, { status: 400 });
    }

    // In a production setup with persistent audit log table, we would record the audit log here.
    return NextResponse.json({
      success: true,
      message: `Override ${exceptionId} has been marked as ${action}.`,
      auditedBy: user.username,
      auditedAt: new Date().toISOString(),
      remarks: remarks || '',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to audit governance exception.' },
      { status: 500 }
    );
  }
}
