import { approveHcSupplier, rejectHcSupplier } from '@/backend/services/zmccLocalSupplierService';
import { approveRoute, approveShop, rejectRoute, rejectShop, resolveZmccAuth } from '@/backend/services/zmccMasterDataService';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { resolveActingContext } from '@/backend/core/acting-context';
import { writeAuditLog } from '@/backend/core/audit';
import {
  canDecideApproval,
  type ApprovalType,
} from '@/backend/services/escalation/approvalMatrix';
import { reviewMotShopException } from '@/backend/services/mot/motShopReviewService';
import { reviewPortionException } from '@/backend/services/zmcc/labPortionReviewService';
import { decideDispatchApproval } from '@/backend/services/dispatch/dispatchDecisionService';
import {
  clearHandledNotifications,
  emitSelfApprovalReviewNotification,
} from '@/backend/services/notificationService';

/** The bell items each approval type answers. */
const EVENTS_BY_APPROVAL_TYPE: Partial<Record<ApprovalType, string[]>> = {
  STAGE_1_SHOP_EXCEPTION: ['MOT_SHOP_EXCEPTION_PENDING'],
  STAGE_1_NEW_ROUTE: ['NEW_ROUTE_PENDING'],
  STAGE_1_NEW_SHOP: ['NEW_SHOP_PENDING'],
  STAGE_2_PORTION_EXCEPTION: ['ZMCC_LAB_EXCEPTION_PENDING'],
  STAGE_2_NEW_HC: ['NEW_HC_PENDING', 'HC_APPROVAL_PENDING'],
  STAGE_3_ZMCC_DISPATCH_EXCEPTION: ['DISPATCH_APPROVAL_PENDING'],
  STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION: ['DISPATCH_APPROVAL_PENDING'],
  STAGE_4_PORTION_EXCEPTION: ['PLANT_QA_EXCEPTION_PENDING'],
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { id: authUser.id ? BigInt(authUser.id) : undefined },
        { username: authUser.username },
      ],
      is_active: true,
    },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'User account not found or inactive.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const approvalType = body.approvalType as ApprovalType;
  const verdict = body.verdict as 'OKAY' | 'NO';
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
  const version = typeof body.version === 'number' ? body.version : Number(body.version);

  if (verdict !== 'OKAY' && verdict !== 'NO') {
    return NextResponse.json({ error: 'Invalid verdict. Must be OKAY or NO.' }, { status: 400 });
  }

  if (isNaN(version)) {
    return NextResponse.json({ error: 'Concurrency version number is required.' }, { status: 400 });
  }

  if (verdict === 'NO' && remarks.length < 5) {
    return NextResponse.json(
      { error: 'Please write a reason for saying NO (minimum 5 characters required).' },
      { status: 400 }
    );
  }

  // Parse pure numeric ID from composite string
  const rawIdStr = id.replace(/^[a-z_]+_/, '');
  let numericId: bigint;
  try {
    numericId = BigInt(rawIdStr);
  } catch {
    return NextResponse.json({ error: 'Invalid record ID format.' }, { status: 400 });
  }

  // Extract acting context for this operation using authUser
  const actingResult = resolveActingContext(authUser, [
    'SUPER_ADMIN',
    'HEAD_OF_MPD',
    'ZMCC_MANAGER',
    'QA_HEAD',
    'CONTRACTOR_MANAGER',
    'MDO',
  ]);
  if (!actingResult.ok) {
    return NextResponse.json({ error: 'Forbidden. Role not permitted to perform approvals.' }, { status: 403 });
  }
  const ctx = actingResult.ctx;

  // -----------------------------------------------------------------------------------------------
  // Pre-fetch item context and perform Segregation of Duties checks
  // -----------------------------------------------------------------------------------------------
  let submitterUserId: bigint | null = null;
  let submitterRole: string | null = null;
  let zmccId: bigint | null = null;
  let contractorId: bigint | null = null;
  let dbVersion: number = version;

  if (approvalType === 'STAGE_1_SHOP_EXCEPTION') {
    const col = await prisma.motShopCollection.findUnique({
      where: { id: numericId },
    });
    if (!col) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 });
    submitterUserId = col.submitted_by_user_id;
    const submitter = await prisma.user.findUnique({ where: { id: col.submitted_by_user_id } });
    submitterRole = submitter?.role || col.performed_as_role || 'MOT';
    zmccId = col.zmcc_id;
    dbVersion = col.version;
  } else if (approvalType === 'STAGE_1_NEW_ROUTE') {
    const route = await prisma.zmccRoute.findUnique({
      where: { id: numericId },
      include: { creator: true },
    });
    if (!route) return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
    submitterUserId = route.created_by;
    submitterRole = route.creator?.role || route.created_as_role || 'MDO';
    zmccId = route.zmcc_id;
  } else if (approvalType === 'STAGE_1_NEW_SHOP') {
    const shop = await prisma.zmccShop.findUnique({
      where: { id: numericId },
      include: { creator: true },
    });
    if (!shop) return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
    submitterUserId = shop.created_by;
    submitterRole = shop.creator?.role || shop.created_as_role || 'MOT';
    zmccId = shop.zmcc_id;
  } else if (approvalType === 'STAGE_2_PORTION_EXCEPTION') {
    const portion = await prisma.zmccLabPortion.findUnique({
      where: { id: numericId },
      include: { lab_session: true, creator: true },
    });
    if (!portion) return NextResponse.json({ error: 'Lab portion not found.' }, { status: 404 });
    submitterUserId = portion.created_by_user_id;
    submitterRole = portion.creator?.role || portion.performed_as_role || 'ZMCC_LAB_ATTENDANT';
    zmccId = portion.lab_session?.zmcc_id || null;
    dbVersion = portion.version;
  } else if (approvalType === 'STAGE_2_NEW_HC') {
    const hc = await prisma.zmccLocalSupplier.findUnique({
      where: { id: numericId },
      include: { creator: true },
    });
    if (!hc) return NextResponse.json({ error: 'Local supplier not found.' }, { status: 404 });
    submitterUserId = hc.created_by_user_id;
    submitterRole = hc.creator?.role || hc.created_as_role || 'PHE_OPERATOR';
    zmccId = hc.zmcc_id;
  } else if (
    approvalType === 'STAGE_3_ZMCC_DISPATCH_EXCEPTION' ||
    approvalType === 'STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION'
  ) {
    const disp = await prisma.vehicleVisit.findUnique({
      where: { id: numericId },
      include: { procurement_source: true, approval_requester: true, creator: true },
    });
    if (!disp) return NextResponse.json({ error: 'Dispatch visit not found.' }, { status: 404 });
    const isContractor = (disp.procurement_source?.source_type || '').toUpperCase() === 'CONTRACTOR';
    submitterUserId = disp.approval_requested_by ?? disp.dispatch_submitted_by ?? disp.created_by;
    submitterRole = disp.approval_requester?.role || disp.creator?.role || disp.approval_requested_as_role || (isContractor ? 'CONTRACTOR_OPERATOR' : 'ZMCC_LAB_ATTENDANT');
    if (isContractor) {
      contractorId = disp.procurement_source_id;
    } else {
      zmccId = disp.procurement_source_id;
    }
    dbVersion = disp.dispatch_version;
  } else if (approvalType === 'STAGE_4_PORTION_EXCEPTION') {
    const p = await prisma.visitPortion.findUnique({
      where: { id: numericId },
      include: { visit: true, manager_requester: true },
    });
    if (!p) return NextResponse.json({ error: 'Plant visit portion not found.' }, { status: 404 });
    submitterUserId = p.manager_review_requested_by_user_id;
    submitterRole = p.manager_requester?.role || 'QA_LAB_ATTENDANT';
    dbVersion = Math.floor(p.updated_at.getTime() / 1000);
  }

  // Evaluate Segregation of Duties
  const decisionCheck = canDecideApproval(
    {
      userId: dbUser.id,
      role: dbUser.role,
      procurementSourceId: dbUser.procurement_source_id,
    },
    {
      approvalType,
      submittedByUserId: submitterUserId,
      submitterRole,
      zmccId,
      contractorId,
    },
    remarks
  );

  if (!decisionCheck.allowed) {
    return NextResponse.json(
      { error: decisionCheck.disabledReason || 'Action forbidden by Segregation of Duties.' },
      { status: 403 }
    );
  }

  // Version Concurrency Check (skip if record type has no numerical version)
  if (approvalType !== 'STAGE_1_NEW_ROUTE' && approvalType !== 'STAGE_1_NEW_SHOP' && approvalType !== 'STAGE_2_NEW_HC') {
    if (dbVersion !== version) {
      return NextResponse.json(
        {
          error: 'Concurrency conflict: this item was updated or already decided. Please refresh.',
          code: 'VERSION_MISMATCH',
        },
        { status: 409 }
      );
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Atomic Delegation to Underlying Stage Service
  // -----------------------------------------------------------------------------------------------
  try {
    if (approvalType === 'STAGE_1_SHOP_EXCEPTION') {
      const res = await reviewMotShopException(ctx, numericId, {
        verdict,
        remarks,
        version,
      });
      if (res.error) {
        return NextResponse.json({ error: res.error }, { status: res.status });
      }
    } else if (approvalType === 'STAGE_1_NEW_ROUTE') {
      const { auth: routeAuth, errorResponse: routeAuthError } = await resolveZmccAuth(req, 'APPROVE_ROUTE');
      if (routeAuthError) return NextResponse.json({ error: routeAuthError.error }, { status: routeAuthError.status });
      const res =
        verdict === 'OKAY' ? await approveRoute(routeAuth!, numericId) : await rejectRoute(routeAuth!, numericId, remarks);
      if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    } else if (approvalType === 'STAGE_1_NEW_SHOP') {
      // The same approval as the shop screens: gives the real code, activates it and adds it to running journeys.
      const { auth: shopAuth, errorResponse: shopAuthError } = await resolveZmccAuth(req, 'APPROVE_SHOP');
      if (shopAuthError) return NextResponse.json({ error: shopAuthError.error }, { status: shopAuthError.status });
      const res =
        verdict === 'OKAY' ? await approveShop(shopAuth!, numericId) : await rejectShop(shopAuth!, numericId, remarks);
      if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    } else if (approvalType === 'STAGE_2_PORTION_EXCEPTION') {
      const res = await reviewPortionException(ctx, numericId, {
        verdict,
        remarks,
        version,
      });
      if (res.error) {
        return NextResponse.json({ error: res.error }, { status: res.status });
      }
    } else if (approvalType === 'STAGE_2_NEW_HC') {
      // The same decision as the HC screens: the HC becomes usable for arrivals and tokens.
      const res =
        verdict === 'OKAY'
          ? await approveHcSupplier(req, numericId.toString())
          : await rejectHcSupplier(req, numericId.toString(), remarks);
      if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    } else if (
      approvalType === 'STAGE_3_ZMCC_DISPATCH_EXCEPTION' ||
      approvalType === 'STAGE_3_CONTRACTOR_DISPATCH_EXCEPTION'
    ) {
      const res = await decideDispatchApproval(authUser, ctx.actingAs, numericId, {
        verdict,
        remarks,
        version,
      });
      if (res.error) {
        return NextResponse.json({ error: res.error, code: res.code }, { status: res.status });
      }
    } else if (approvalType === 'STAGE_4_PORTION_EXCEPTION') {
      await prisma.$transaction(async (tx) => {
        const portion = await tx.visitPortion.findUnique({
          where: { id: numericId },
          include: { visit: true },
        });
        if (!portion || portion.manager_review_status !== 'PENDING') {
          throw new Error('Portion not in pending review state.');
        }

        const newStatus = verdict === 'OKAY' ? 'APPROVED' : 'REJECTED';
        const finalPlantDecision =
          verdict === 'OKAY'
            ? portion.manager_requested_decision || 'ACCEPT'
            : portion.manager_requested_decision === 'ACCEPT'
            ? 'REJECT'
            : 'ACCEPT';

        await tx.visitPortion.update({
          where: { id: numericId },
          data: {
            manager_review_status: newStatus,
            plant_decision: finalPlantDecision,
            manager_reviewed_by_user_id: dbUser.id,
            manager_review_reason: remarks || portion.manager_review_reason,
            manager_reviewed_at: new Date(),
          },
        });

        await writeAuditLog(tx, {
          tableName: 'visit_portion',
          recordId: numericId,
          action: 'PLANT_QA_EXCEPTION_REVIEWED',
          oldValues: {
            manager_review_status: portion.manager_review_status,
            plant_decision: portion.plant_decision,
          },
          newValues: {
            manager_review_status: newStatus,
            plant_decision: finalPlantDecision,
            verdict,
            remarks,
          },
          actor: {
            userId: dbUser.id,
            actorRole: dbUser.role,
            performedAsRole: ctx.actingAs,
            isDelegated: ctx.isDelegated,
            selfApproved: decisionCheck.isSelfApproval,
          },
        });
      });
    }

    // ---------------------------------------------------------------------------------------------
    // Post-decision notification handling
    // ---------------------------------------------------------------------------------------------
    await clearHandledNotifications(prisma, EVENTS_BY_APPROVAL_TYPE[approvalType] ?? [], numericId);

    if (decisionCheck.isSelfApproval) {
      await emitSelfApprovalReviewNotification(prisma, {
        sourceId: numericId.toString(),
        approvalType,
        adminName: dbUser.full_name || dbUser.username,
        remarks,
      });
    }

    return NextResponse.json({
      success: true,
      verdict,
      message: `Approval decided successfully: ${verdict === 'OKAY' ? 'Approved' : 'Rejected'}.`,
    });
  } catch (err: unknown) {
    console.error('POST /api/approvals/[id]/decision error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to record approval decision.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
