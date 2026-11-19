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
          OR: [{ approval_status: { in: ['PENDING', 'APPROVED'] } }, { portions: { some: { manager_review_status: 'PENDING' } } }],
        },
        select: {
          id: true,
          approval_status: true,
          approver_role: true,
          procurement_source_id: true,
        },
      })
    : [];
  // A dispatch the ZMCC Manager already approved shows "Approved"; it is not waiting on anyone.
  const approvedDispatch = new Set(waits.filter((v) => v.approval_status === 'APPROVED').map((v) => v.id.toString()));
  const pendingPortions = new Set(
    (visitIds.length
      ? await prisma.visitPortion.findMany({
          where: { visit_id: { in: visitIds }, manager_review_status: 'PENDING' },
          select: { visit_id: true },
        })
      : []
    ).map((p) => p.visit_id.toString())
  );
  const approvals = new Map<string, TvVehicleApproval>();
  for (const v of waits) {
    if (v.approval_status !== 'PENDING' && !pendingPortions.has(v.id.toString())) continue;
    approvals.set(
      v.id.toString(),
      v.approval_status === 'PENDING'
        ? { stageId: 'DISPATCH', role: v.approver_role || 'ZMCC_MANAGER', name: null }
        : { stageId: 'PLANT_QA', role: 'QA_HEAD', name: null }
    );
  }
  const waiting = waits.filter((v) => approvals.has(v.id.toString()));
  if (user && waiting.length) {
    const names = await resolveApproverNames(
      waiting.map((v) => ({ role: approvals.get(v.id.toString())!.role, sourceId: v.procurement_source_id }))
    );
    for (const v of waiting) {
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
    plant13TsLiters: g.plant13TsLiters,
    dispatchGrossLiters: g.totalDispatchGrossLiters,
    dispatchQuantityValue: g.vehicleDispatchQuantityValue,
    dispatchQuantityUnit: g.vehicleDispatchQuantityUnit,
    firstWeightKg: g.firstWeightKg,
    secondWeightKg: g.secondWeightKg,
    lifecycle: g.lifecycle,
    approval: approvals.get(String(g.visitId)) ?? null,
    dispatchApproved: approvedDispatch.has(String(g.visitId)),
  }));
  // Names are for signed-in viewers only, so their copy is never stored by a shared cache.
  return NextResponse.json(
    { vehicles },
    { headers: { 'Cache-Control': user ? 'private, no-store' : 'public, max-age=30' } }
  );
}
