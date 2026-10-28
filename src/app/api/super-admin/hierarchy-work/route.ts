import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { formatRoleLabel } from '@/frontend/modules/shared/navigation/NavPanel';

export const dynamic = 'force-dynamic';

interface HierarchyWorkItem {
  id: string;
  timestamp: string;
  actualUserId: string;
  actualUserName: string;
  actualUserRole: string;
  actualUserRoleLabel: string;
  performedRole: string;
  performedRoleLabel: string;
  actionTaken: string;
  station: string;
  referenceNumber: string;
  reason: string;
}

export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser || (authUser.role !== 'SUPER_ADMIN' && authUser.role !== 'DATA_EXECUTIVE' && authUser.role !== 'EXECUTIVE_MANAGEMENT')) {
    return NextResponse.json({ error: 'Unauthorized. Super Admin or Executive authorization required.' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userIdParam = searchParams.get('userId');
    const performedRoleParam = searchParams.get('performedRole');
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));

    // 1. Query plant QA portions where decider role differed from base role, or decided by SUPER_ADMIN
    const plantPortions = await prisma.visitPortion.findMany({
      where: {
        plant_decided_by: { not: null },
        plant_decision: { in: ['ACCEPTED', 'REJECTED'] },
      },
      orderBy: { plant_decided_at: 'desc' },
      take: limit,
      include: {
        visit: {
          select: {
            vehicle_number: true,
            token_number: true,
            procurement_source: { select: { name: true, code: true } },
          },
        },
        decided_by: {
          select: {
            id: true,
            username: true,
            full_name: true,
            role: true,
          },
        },
      },
    });

    const items: HierarchyWorkItem[] = [];

    for (const p of plantPortions) {
      if (!p.decided_by) continue;
      const decider = p.decided_by;
      const baseRole = decider.role;
      const performedRole = p.plant_decided_as_role || 'QA_LAB_ATTENDANT';

      // Check if superior hierarchy action occurred:
      // Either user is SUPER_ADMIN acting on portion, or user role is higher than performed role
      const isSuperAdminAction = baseRole === 'SUPER_ADMIN';
      const isCrossRole = baseRole !== performedRole && canActAs(baseRole, performedRole);

      if (isSuperAdminAction || isCrossRole || p.plant_decided_is_delegated) {
        items.push({
          id: `plant-portion-${p.id.toString()}`,
          timestamp: (p.plant_decided_at || p.created_at).toISOString(),
          actualUserId: decider.id.toString(),
          actualUserName: decider.full_name || decider.username,
          actualUserRole: baseRole,
          actualUserRoleLabel: formatRoleLabel(baseRole) || baseRole,
          performedRole: isSuperAdminAction ? 'AVP Reception Lab' : performedRole,
          performedRoleLabel: isSuperAdminAction ? 'AVP Reception Lab' : (formatRoleLabel(performedRole) || performedRole),
          actionTaken: `Portion #${p.portion_number} ${p.plant_decision}: Tanker ${p.visit.vehicle_number}`,
          station: 'Plant QA Reception Lab',
          referenceNumber: `Token: ${p.visit.token_number || p.visit.vehicle_number}`,
          reason: p.plant_rejection_reason || p.manager_review_reason || 'Executive hierarchy authorization',
        });
      }
    }

    // 2. Query ZMCC lab portions where reviewer differed from attendant
    const zmccPortions = await prisma.zmccLabPortion.findMany({
      where: {
        reviewed_by_user_id: { not: null },
      },
      orderBy: { reviewed_at: 'desc' },
      take: limit,
      include: {
        reviewer: {
          select: { id: true, username: true, full_name: true, role: true },
        },
        lab_session: {
          select: { zmcc: { select: { name: true, code: true } } },
        },
      },
    });

    for (const zp of zmccPortions) {
      if (!zp.reviewer) continue;
      const reviewer = zp.reviewer;
      const baseRole = reviewer.role;

      if (baseRole === 'SUPER_ADMIN' || baseRole === 'HEAD_OF_MPD' || baseRole === 'ZMCC_MANAGER') {
        items.push({
          id: `zmcc-portion-${zp.id.toString()}`,
          timestamp: (zp.reviewed_at || new Date()).toISOString(),
          actualUserId: reviewer.id.toString(),
          actualUserName: reviewer.full_name || reviewer.username,
          actualUserRole: baseRole,
          actualUserRoleLabel: formatRoleLabel(baseRole) || baseRole,
          performedRole: 'ZMCC_LAB_ATTENDANT',
          performedRoleLabel: 'ZMCC Lab Attendant',
          actionTaken: `Lab Portion Decision: ${zp.final_decision || zp.status}`,
          station: 'ZMCC Laboratory',
          referenceNumber: `Portion #${zp.portion_number}`,
          reason: zp.review_remarks || zp.decision_remarks || 'Managerial review authorization',
        });
      }
    }

    // Filter if requested
    let filtered = items;
    if (userIdParam) {
      filtered = filtered.filter((i) => i.actualUserId === userIdParam);
    }
    if (performedRoleParam) {
      filtered = filtered.filter((i) => i.performedRole.toUpperCase() === performedRoleParam.toUpperCase());
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      items: filtered.slice(0, limit),
      totalCount: filtered.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to query hierarchy work report.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
