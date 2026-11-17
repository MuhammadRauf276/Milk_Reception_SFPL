import { NextResponse } from 'next/server';
import { prisma } from '@/backend/core/db';
import { getCurrentUser } from '@/backend/core/auth';
import { getPaginatedOperationalLogs } from '@/backend/services/operationalReadModelService';
import { approverKey, resolveApproverNames, type TvVehicleApproval } from '@/backend/services/tvBoardApprovals';
import { buildVehicleVisitGroups } from '@/frontend/modules/dashboard/zmcc/zmccManagerHelpers';

export const dynamic = 'force-dynamic';

/**
 * Public yard display: every vehicle dispatched to the plant that has not completed,
 * with its stage progress. Only lifecycle and quantity summaries are exposed (no lab values).
 * A vehicle waiting for an approval names the approver's role; signed-in viewers also see the name.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser(req).catch(() => null);
  const { items } = await getPaginatedOperationalLogs({ mode: 'live', pageSize: 100 }, null, { kind: 'ALL' });
  const groups = buildVehicleVisitGroups(items)
    .filter((g) => !g.lifecycle.isComplete)
    .sort((a, b) => a.visitId - b.visitId);

  const visitIds = groups.map((g) => BigInt(g.visitId));
  const waits = visitIds.length
    ? await prisma.vehicleVisit.findMany({
        where: {
          id: { in: visitIds },
          OR: [{ approval_status: 'PENDING' }, { portions: { some: { manager_review_status: 'PENDING' } } }],
        },
        select: {
          id: true,
          approval_status: true,
          approver_role: true,
          procurement_source_id: true,
        },
      })
    : [];
  const approvals = new Map<string, TvVehicleApproval>();
  for (const v of waits) {
    approvals.set(
      v.id.toString(),
      v.approval_status === 'PENDING'
        ? { stageId: 'DISPATCH', role: v.approver_role || 'ZMCC_MANAGER', name: null }
        : { stageId: 'PLANT_QA', role: 'QA_HEAD', name: null }
    );
  }
  if (user && waits.length) {
    const names = await resolveApproverNames(
      waits.map((v) => ({ role: approvals.get(v.id.toString())!.role, sourceId: v.procurement_source_id }))
    );
    for (const v of waits) {
      const a = approvals.get(v.id.toString())!;
      a.name = names.get(approverKey(a.role, v.procurement_source_id)) ?? null;
    }
  }

  const vehicles = groups.map((g) => ({
    visitId: String(g.visitId),
    vehicleNumber: g.vehicleNumber,
    tokenNumber: g.tokenNumber,
    sourceName: g.sourceName,
    portionCount: g.portions.length,
    dispatch13TsLiters: g.totalDispatch13TsLiters,
    dispatchGrossLiters: g.totalDispatchGrossLiters,
    dispatchQuantityValue: g.vehicleDispatchQuantityValue,
    dispatchQuantityUnit: g.vehicleDispatchQuantityUnit,
    firstWeightKg: g.firstWeightKg,
    secondWeightKg: g.secondWeightKg,
    lifecycle: g.lifecycle,
    approval: approvals.get(String(g.visitId)) ?? null,
  }));
  // Names are for signed-in viewers only, so their copy is never stored by a shared cache.
  return NextResponse.json(
    { vehicles },
    { headers: { 'Cache-Control': user ? 'private, no-store' : 'public, max-age=30' } }
  );
}
