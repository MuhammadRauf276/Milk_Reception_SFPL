import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { getErrorMessage } from '@/lib/errors';
import { Prisma } from '@prisma/client';
import { QaWarningEscalationService } from '@/backend/services/qaWarningEscalationService';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'DATA_EXECUTIVE' && authUser.role !== 'QA_HEAD')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin or QA Management authorization required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const sourceId = searchParams.get('sourceId');
    const yearMonth = searchParams.get('yearMonth'); // e.g. "2026-08"

    const where: Prisma.QAWarningWhereInput = {};
    if (sourceId) {
      where.procurement_source_id = BigInt(sourceId);
    }

    if (yearMonth && yearMonth.length === 7) {
      const [year, month] = yearMonth.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      where.created_at = { gte: startDate, lte: endDate };
    }

    const [threshold, warnings, sources] = await Promise.all([
      QaWarningEscalationService.getMtdWarningThreshold(),
      prisma.qAWarning.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
          procurement_source: {
            select: { id: true, code: true, name: true, source_type: true },
          },
          lab_test: {
            select: { testCode: true, testName: true },
          },
          creator: {
            select: { username: true, full_name: true },
          },
          acknowledger: {
            select: { username: true, full_name: true },
          },
        },
      }),
      prisma.procurementSource.findMany({ where: { is_active: true } }),
    ]);

    const serializedWarnings = warnings.map((w) => ({
      id: w.id.toString(),
      procurementSourceId: w.procurement_source_id.toString(),
      procurementSource: {
        code: w.procurement_source.code,
        name: w.procurement_source.name,
        sourceType: w.procurement_source.source_type,
      },
      visitId: w.visit_id ? w.visit_id.toString() : null,
      portionId: w.portion_id ? w.portion_id.toString() : null,
      labTest: w.lab_test ? { code: w.lab_test.testCode, name: w.lab_test.testName } : null,
      reason: w.reason,
      status: w.status,
      createdAt: w.created_at.toISOString(),
      acknowledgedAt: w.acknowledged_at ? w.acknowledged_at.toISOString() : null,
      createdBy: w.creator?.full_name || w.creator?.username || 'System',
      acknowledgedBy: w.acknowledger?.full_name || w.acknowledger?.username || null,
    }));

    // Deduplicated vehicle warning count per procurement source for current MTD
    const monthlySummary = await Promise.all(
      sources.map(async (s) => {
        const count = await QaWarningEscalationService.getProcurementSourceMtdWarningCount(s.id);
        return {
          sourceId: s.id.toString(),
          sourceCode: s.code,
          sourceName: s.name,
          sourceType: s.source_type,
          activeWarningCount: count,
          threshold,
          isLimitReached: count >= threshold,
        };
      })
    );

    return NextResponse.json({
      threshold,
      warnings: serializedWarnings,
      monthlySummary,
    });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

/**
 * Super Admin updates the MTD warning limit threshold.
 */
export async function PUT(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || authUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const thresholdNum = Number(body.threshold);
    if (!Number.isFinite(thresholdNum) || thresholdNum < 1) {
      return NextResponse.json({ error: 'Threshold must be a positive integer.' }, { status: 400 });
    }

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ username: authUser.username }, { id: BigInt(authUser.id || 0) }] },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const updated = await QaWarningEscalationService.setMtdWarningThreshold(
      thresholdNum,
      dbUser.id,
      body.reason || 'Super Admin updated MTD warning threshold'
    );

    return NextResponse.json({ ok: true, threshold: updated });
  } catch (err) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
