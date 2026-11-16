import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getMpdExecutiveTelemetry } from '@/backend/services/mpdExecutiveService';
import { getErrorMessage } from '@/lib/errors';
import { parseLossQuery } from '@/backend/services/lossCalculationService';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const startedAt = performance.now();
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(current.id) },
    });

    if (!user?.is_active) {
      return NextResponse.json({ error: 'User account inactive or not found.' }, { status: 403 });
    }

    // Role-based authorization for MPD Executive Workspace
    const authorizedRoles = [
      'SUPER_ADMIN',
      'HEAD_OF_MPD',
      'DATA_EXECUTIVE',
      'EXECUTIVE_MANAGEMENT',
      'ADMIN',
      'QA_HEAD',
      'ZMCC_MANAGER',
      'DATA_ANALYST',
    ];

    if (!authorizedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden. MPD Executive overview is restricted to executive leadership and authorized personnel.' },
        { status: 403 }
      );
    }

    // The Loss / Gain figures follow the same filters as the Loss / Gain report; today and every ZMCC when none are sent.
    // A ZMCC manager's loss figures are always their own ZMCC.
    const parsed = parseLossQuery(new URL(req.url).searchParams, {
      role: user.role,
      managerZmccId: user.procurement_source_id,
      defaultPreset: 'TODAY',
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const telemetry = await getMpdExecutiveTelemetry({
      lossFilter: parsed.filters,
      // ERP codes are visible to the owner/reporting roles only.
      includeErpCode: ['SUPER_ADMIN', 'HEAD_OF_MPD', 'DATA_EXECUTIVE', 'DATA_ANALYST'].includes(user.role),
    });
    const durationMs = performance.now() - startedAt;

    return NextResponse.json(
      {
        success: true,
        data: telemetry,
        queryDurationMs: Math.round(durationMs),
      },
      {
        headers: {
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          'Server-Timing': `mpd-telemetry;dur=${durationMs.toFixed(1)}`,
        },
      }
    );
  } catch (error) {
    console.error('Error loading MPD Executive telemetry:', error);
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to load MPD Executive telemetry.' },
      { status: 500 }
    );
  }
}
