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
        visitNumber: existingVisit.visit_number,
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

    const dateStr = validated.operationalDate || getPakistanCalendarDate(new Date());
    const dateCode = dateStr.replace(/-/g, '');

    // 3. Create persistent DRAFT_DISPATCH work item with frozen assignment and quantity policy
    const result = await prisma.$transaction(async (tx) => {
      const latestToday = await tx.vehicleVisit.findFirst({
        where: {
          visit_number: { startsWith: `VV-${dateCode}` },
        },
        orderBy: { visit_number: 'desc' },
        select: { visit_number: true },
      });

      let seq = 1;
      if (latestToday?.visit_number) {
        const parts = latestToday.visit_number.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
      const visitNumber = `VV-${dateCode}-${String(seq).padStart(4, '0')}`;

      const visit = await tx.vehicleVisit.create({
        data: {
          visit_number: visitNumber,
          vehicle_number: (validated.vehicleNumber || 'DRAFT').toUpperCase().trim(),
          operational_date: null,
          current_status: 'DRAFT_DISPATCH',
          created_by: userId,
          procurement_source_id: resolvedSourceId,
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
        visitNumber: result.visit.visit_number,
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



