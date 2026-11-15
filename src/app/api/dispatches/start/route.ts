import { isDraftVisitNumber } from '@/backend/services/dispatch/visitNumber';
import { previewNewDispatch } from '@/backend/services/dispatch/unsentVisit';
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

    // Opening the form saves nothing in the visit table. What is typed is kept in the draft store and the visit
    // is created when the form is submitted, so an opened or half-filled form is never a record.
    //
    // Rows left by the older version of this form (it used to create one each time it was opened) are closed
    // here, unless they still hold saved values someone may want to continue.
    const leftovers = await prisma.vehicleVisit.findMany({
      where: { created_by: userId, current_status: 'DRAFT_DISPATCH', procurement_source_id: resolvedSourceId },
      select: { id: true },
    });
    if (leftovers.length > 0) {
      const stillInUse = await prisma.formDraft.findMany({
        where: { scope_id: { in: leftovers.map((v) => v.id) }, form_type: { contains: 'DISPATCH', mode: 'insensitive' } },
        select: { scope_id: true },
      });
      const keepIds = new Set(stillInUse.map((d) => d.scope_id.toString()));
      await prisma.vehicleVisit.updateMany({
        where: { id: { in: leftovers.map((v) => v.id).filter((id) => !keepIds.has(id.toString())) }, current_status: 'DRAFT_DISPATCH' },
        // Marked the same way as the other closed empty forms, so every list already leaves them out.
        data: { current_status: 'CANCELLED', vehicle_number: 'DRAFT' },
      });
    }

    const preview = await previewNewDispatch(resolvedSourceId);
    return NextResponse.json({
      success: true,
      // No visit yet: the form sends its values without one and the submit creates it.
      visitId: null,
      visitNumber: null,
      sourceId: resolvedSourceId.toString(),
      assignedTests: preview.assignedTests,
      quantityPolicy: preview.quantityPolicy,
    });
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



