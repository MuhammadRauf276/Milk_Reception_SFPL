import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const sourceId = searchParams.get('sourceId');
    const yearMonth = searchParams.get('yearMonth'); // e.g. "2026-08"

    const where: any = {};
    if (sourceId) {
      where.procurement_source_id = BigInt(sourceId);
    }

    if (yearMonth && yearMonth.length === 7) {
      const [year, month] = yearMonth.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      where.created_at = { gte: startDate, lte: endDate };
    }

    const warnings = await prisma.qAWarning.findMany({
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
    });

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

    // Derive monthly count per procurement source
    const sources = await prisma.procurementSource.findMany({ where: { is_active: true } });
    const monthlySummary = await Promise.all(
      sources.map(async (s) => {
        const count = await prisma.qAWarning.count({
          where: {
            procurement_source_id: s.id,
            status: 'ACTIVE',
          },
        });
        return {
          sourceId: s.id.toString(),
          sourceCode: s.code,
          sourceName: s.name,
          sourceType: s.source_type,
          activeWarningCount: count,
        };
      })
    );

    return NextResponse.json({
      warnings: serializedWarnings,
      monthlySummary,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
