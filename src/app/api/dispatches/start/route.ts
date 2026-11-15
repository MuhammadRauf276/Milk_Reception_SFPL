import { isDraftVisitNumber, newDraftVisitNumber } from '@/backend/services/dispatch/visitNumber';
import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { ACTING_AS_HEADER, requireRoles, scopeFailureResponse } from '@core/route-guards';
import { z } from 'zod';

import { getOrAssignDispatchTests, serializeAssignment } from '@/backend/services/labTestAssignmentService';
import { getOrFreezeDispatchQuantityPolicy } from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import { getErrorCode, getErrorMessage } from '@/lib/errors';
import type { ActingContextResult } from '@/backend/core/acting-context';
import {
  DISPATCH_SOURCE_FAILURE_MESSAGES,
  DISPATCH_WRITE_ROLES,
  checkDispatchSource,
  dispatchSourceIdToLoad,
  isScopeFailure,
  resolveDispatchActing,
  type DispatchSourceFailure,
} from '@/backend/services/dispatchScope';

function dispatchSourceFailureResponse(code: DispatchSourceFailure) {
  if (isScopeFailure(code)) return scopeFailureResponse(code);
  return NextResponse.json({ error: DISPATCH_SOURCE_FAILURE_MESSAGES[code], code }, { status: 400 });
}

function actingFailureResponse(result: Extract<ActingContextResult, { ok: false }>) {
  return result.code === 'FORBIDDEN'
    ? NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    : scopeFailureResponse(result.code);
}



/** An opened dispatch form that nobody came back to is closed after this many days. */
const ABANDONED_DRAFT_DAYS = 7;

const startDispatchSchema = z.object({
  visitId: z.string().optional(),
  vehicleNumber: z.string().optional(),
  procurementSourceId: z.string().optional(),
  operationalDate: z.string().optional(),
  motVehicleId: z.string().optional().nullable(),
  motProfileId: z.string().optional().nullable(),
  driverName: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  // Dispatch role (ZMCC Lab Attendant / Contractor Operator) or a superior doing their work.
  // Source binding is checked against the acting scope, never the stored role.
  const guard = await requireRoles(req, DISPATCH_WRITE_ROLES);
  if ('response' in guard) return guard.response;
  const requestedAs = req.headers.get(ACTING_AS_HEADER);
  const userId = guard.acting.userId;

  try {
    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const validated = startDispatchSchema.parse(body);

    // 1. If visitId is provided, validate and idempotently fetch the existing work item
    if (validated.visitId) {
      const existingVisitId = BigInt(validated.visitId);
      const existingVisit = await prisma.vehicleVisit.findUnique({
        where: { id: existingVisitId },
      });

      if (!existingVisit) {
        return NextResponse.json(
          { error: 'Dispatch work item not found.', code: 'DRAFT_NOT_FOUND' },
          { status: 404 }
        );
      }

      // Validate that the work item is still in editable draft state
      if (existingVisit.current_status !== 'DRAFT_DISPATCH') {
        return NextResponse.json(
          { error: 'Dispatch work item is no longer in draft status.', code: 'DRAFT_ALREADY_PROGRESSED' },
          { status: 400 }
        );
      }

      // Validate draft creator ownership (Requirement C)
      if (existingVisit.created_by?.toString() !== userId.toString()) {
        return NextResponse.json(
          { error: 'Unauthorized. Draft visit belongs to another operator.', code: 'DRAFT_OWNER_MISMATCH' },
          { status: 403 }
        );
      }


      // SYSTEM scope: a selected source must match the draft's source.
      if (
        guard.acting.scope.kind === 'SYSTEM' &&
        validated.procurementSourceId &&
        existingVisit.procurement_source_id?.toString() !== validated.procurementSourceId
      ) {
        return NextResponse.json(
          { error: 'Draft procurement source does not match selected source.', code: 'DRAFT_SOURCE_MISMATCH' },
          { status: 400 }
        );
      }

      // The draft's source must be inside the acting scope and match the acting role's source type.
      const draftSourceId = existingVisit.procurement_source_id;
      if (!draftSourceId) {
        return NextResponse.json(
          { error: 'Draft visit has no procurement source.', code: 'DRAFT_SOURCE_MISMATCH' },
          { status: 400 }
        );
      }
      const draftSourceToLoad = dispatchSourceIdToLoad(guard.acting.scope, draftSourceId);
      if (!draftSourceToLoad.ok) return dispatchSourceFailureResponse(draftSourceToLoad.code);
      const draftSource = await prisma.procurementSource.findUnique({ where: { id: draftSourceToLoad.sourceId } });
      const draftActing = resolveDispatchActing(guard.user, requestedAs, draftSource?.source_type);
      if (!draftActing.ok) return actingFailureResponse(draftActing);
      const draftCheck = checkDispatchSource(draftActing.ctx, draftSourceId, draftSource);
      if (!draftCheck.ok) return dispatchSourceFailureResponse(draftCheck.code);

      const assigned = await getOrAssignDispatchTests(prisma, existingVisit.id);
      const quantityPolicy = await getOrFreezeDispatchQuantityPolicy(
        prisma,
        existingVisit.id,
        existingVisit.procurement_source_id!
      );

      return NextResponse.json({
        success: true,
        visitId: existingVisit.id.toString(),
        visitNumber: isDraftVisitNumber(existingVisit.visit_number) ? null : existingVisit.visit_number,
        assignedTests: assigned.map(serializeAssignment),
        quantityPolicy: quantityPolicy,
      });
    }

    // 2. Resolve authoritative procurement source for a new Dispatch start:
    // SOURCE scope -> forced to the bound source; SYSTEM scope -> procurementSourceId required.
    // The source must exist, be active and match the acting role's source type (Super Admin too).
    const sourceToLoad = dispatchSourceIdToLoad(guard.acting.scope, validated.procurementSourceId);
    if (!sourceToLoad.ok) return dispatchSourceFailureResponse(sourceToLoad.code);
    const sourceRecord = await prisma.procurementSource.findUnique({ where: { id: sourceToLoad.sourceId } });
    const actingResult = resolveDispatchActing(guard.user, requestedAs, sourceRecord?.source_type);
    if (!actingResult.ok) return actingFailureResponse(actingResult);
    const sourceCheck = checkDispatchSource(actingResult.ctx, validated.procurementSourceId, sourceRecord);
    if (!sourceCheck.ok) return dispatchSourceFailureResponse(sourceCheck.code);
    const resolvedSourceId: bigint = sourceCheck.sourceId;

    // A form that was opened and left is closed once it is 7 days old: by then its saved draft values have expired
    // too, so nothing can be continued from it. This also covers forms that were opened with a vehicle already chosen.
    const staleBefore = new Date(Date.now() - ABANDONED_DRAFT_DAYS * 24 * 60 * 60 * 1000);
    const stale = await prisma.vehicleVisit.findMany({
      where: { created_by: userId, current_status: 'DRAFT_DISPATCH', created_at: { lt: staleBefore } },
      select: { id: true },
    });
    if (stale.length > 0) {
      // A form someone is still filling in keeps saved values; those are never closed.
      const stillInUse = await prisma.formDraft.findMany({
        where: { scope_id: { in: stale.map((v) => v.id) }, form_type: { contains: 'DISPATCH', mode: 'insensitive' } },
        select: { scope_id: true },
      });
      const keepIds = new Set(stillInUse.map((d) => d.scope_id.toString()));
      await prisma.vehicleVisit.updateMany({
        where: { id: { in: stale.map((v) => v.id).filter((id) => !keepIds.has(id.toString())) }, current_status: 'DRAFT_DISPATCH' },
        // Marked the same way as the other closed empty forms, so every list already leaves them out.
        data: { current_status: 'CANCELLED', vehicle_number: 'DRAFT' },
      });
    }

    // The form needs a visit to hold its tests and photos, but opening it again must not make another one: an operator
    // keeps one empty draft per source per day, and older empty ones are closed.
    if (!validated.vehicleNumber && !validated.motVehicleId) {
      const dayStart = new Date(`${getPakistanCalendarDate(new Date())}T00:00:00+05:00`);
      const ownDrafts = await prisma.vehicleVisit.findMany({
        where: {
          created_by: userId,
          current_status: 'DRAFT_DISPATCH',
          procurement_source_id: resolvedSourceId,
          vehicle_number: 'DRAFT',
        },
        orderBy: { id: 'desc' },
        select: { id: true, created_at: true },
      });
      const reusable = ownDrafts.find((d) => d.created_at >= dayStart) ?? null;
      const extras = ownDrafts.filter((d) => d.id !== reusable?.id).map((d) => d.id);
      if (extras.length > 0) {
        const withWork = await prisma.formDraft.findMany({
          where: { scope_id: { in: extras }, form_type: { contains: 'DISPATCH', mode: 'insensitive' } },
          select: { scope_id: true },
        });
        const keep = new Set(withWork.map((d) => d.scope_id.toString()));
        await prisma.vehicleVisit.updateMany({
          where: { id: { in: extras.filter((id) => !keep.has(id.toString())) }, current_status: 'DRAFT_DISPATCH' },
          data: { current_status: 'CANCELLED' },
        });
      }
      if (reusable) {
        const visit = await prisma.vehicleVisit.findUniqueOrThrow({ where: { id: reusable.id } });
        const assigned = await getOrAssignDispatchTests(prisma, visit.id);
        const quantityPolicy = await getOrFreezeDispatchQuantityPolicy(prisma, visit.id, resolvedSourceId);
        return NextResponse.json({
          success: true,
          visitId: visit.id.toString(),
          visitNumber: isDraftVisitNumber(visit.visit_number) ? null : visit.visit_number,
          assignedTests: assigned.map(serializeAssignment),
          quantityPolicy: quantityPolicy,
        });
      }
    }

    // 3. Create persistent DRAFT_DISPATCH work item with frozen assignment and quantity policy
    const result = await prisma.$transaction(async (tx) => {
      // The real visit number is given at submit, so a form that is never sent uses up nothing.
      const visit = await tx.vehicleVisit.create({
        data: {
          visit_number: newDraftVisitNumber(),
          vehicle_number: (validated.vehicleNumber || 'DRAFT').toUpperCase().trim(),
          operational_date: null,
          current_status: 'DRAFT_DISPATCH',
          creator: { connect: { id: userId } },
          procurement_source: resolvedSourceId ? { connect: { id: resolvedSourceId } } : undefined,
          mot_vehicle: validated.motVehicleId ? { connect: { id: BigInt(validated.motVehicleId) } } : undefined,
          mot_profile: validated.motProfileId ? { connect: { id: BigInt(validated.motProfileId) } } : undefined,
          driver_name: validated.driverName?.trim() || null,
        },
      });

      // Atomically snapshot active DISPATCH/BOTH tests
      const assigned = await getOrAssignDispatchTests(tx, visit.id);

      // Atomically freeze resolved Dispatch Quantity Policy snapshot
      const quantityPolicy = await getOrFreezeDispatchQuantityPolicy(tx, visit.id, resolvedSourceId!);

      return { visit, assigned, quantityPolicy };
    });

    return NextResponse.json(
      {
        success: true,
        visitId: result.visit.id.toString(),
        visitNumber: null,
        assignedTests: result.assigned.map(serializeAssignment),
        quantityPolicy: result.quantityPolicy,
      },
      { status: 201 }
    );
  } catch (error) {
    if (getErrorCode(error) === 'DISPATCH_QUANTITY_POLICY_INVALID') {
      return NextResponse.json(
        {
          error: 'Configured dispatch quantity policy for this procurement source is invalid.',
          code: 'DISPATCH_QUANTITY_POLICY_INVALID',
        },
        { status: 400 }
      );
    }
    if (getErrorCode(error) === 'SNAPSHOT_SOURCE_MISMATCH' || getErrorCode(error) === 'VISIT_SOURCE_MISMATCH') {
      return NextResponse.json(
        {
          error: getErrorMessage(error) || 'Procurement source mismatch.',
          code: getErrorCode(error),
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to start dispatch work item' }, { status: 500 });
  }
}



