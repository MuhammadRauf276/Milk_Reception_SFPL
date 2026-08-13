import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';

export async function GET() {
  const authUser = await getCurrentUser();
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'Admin')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin authorization required.' }, { status: 403 });
  }

  try {
    const totalUsers = await prisma.user.count();
    const activeUsers = await prisma.user.count({ where: { is_active: true } });

    const totalSources = await prisma.procurementSource.count();
    const activeZmccs = await prisma.procurementSource.count({ where: { source_type: 'ZMCC', is_active: true } });
    const activeContractors = await prisma.procurementSource.count({ where: { source_type: 'CONTRACTOR', is_active: true } });

    const totalSilos = await prisma.silo.count();
    const activeSilos = await prisma.silo.count({ where: { is_active: true } });

    const totalLabTests = await prisma.labTest.count();
    const activeLabTests = await prisma.labTest.count({ where: { isActive: true } });
    const activeRules = await prisma.labTestRule.count({ where: { is_active: true } });

    // Pending Inventory Finalization definition: Vehicles that have completed Tare (TARE_WEIGHED status)
    // where final silo receipt transaction is still pending
    const pendingInventoryCount = await prisma.vehicleVisit.count({
      where: { current_status: 'TARE_WEIGHED' },
    });

    const recentAuditLogs = await prisma.auditLog.findMany({
      take: 10,
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { username: true, full_name: true },
        },
      },
    });

    const formattedAudit = recentAuditLogs.map((log) => ({
      id: log.id.toString(),
      timestamp: log.created_at.toISOString(),
      user: log.user?.full_name || log.user?.username || 'System',
      action: log.action,
      entity: log.table_name,
      summary: log.new_values ? JSON.stringify(log.new_values).substring(0, 100) : log.action,
    }));

    return NextResponse.json({
      metrics: {
        totalUsers,
        activeUsers,
        totalSources,
        activeZmccs,
        activeContractors,
        totalSilos,
        activeSilos,
        totalLabTests,
        activeLabTests,
        activeRules,
        pendingInventoryCount,
      },
      recentAudit: formattedAudit,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
