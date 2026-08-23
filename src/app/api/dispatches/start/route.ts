import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { z } from 'zod';

import { getOrAssignDispatchTests, serializeAssignment } from '@/backend/services/labTestAssignmentService';
import { getOrFreezeDispatchQuantityPolicy } from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import { getOperationalBusinessDate } from '@/backend/core/business-day';



const startDispatchSchema = z.object({
  visitId: z.string().optional(),
  vehicleNumber: z.string().optional(),
  procurementSourceId: z.string().optional(),
  operationalDate: z.string().optional(),
});

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
    include: { procurement_source: true },
  });

  const allowedRoles = ['MPD_Operator', 'MPD', 'MPD_Zone_Manager', 'Admin', 'SUPER_ADMIN', 'Correction_Officer'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. MPD role required.' }, { status: 403 });
  }

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
      if (existingVisit.created_by?.toString() !== dbUser.id.toString()) {
        return NextResponse.json(
          { error: 'Unauthorized. Draft visit belongs to another operator.', code: 'DRAFT_OWNER_MISMATCH' },
          { status: 403 }
        );
      }


      // Check source authorization for bound users or explicit request
      const isSourceBound = !!dbUser.procurement_source_id;
      if (isSourceBound) {
        if (existingVisit.procurement_source_id?.toString() !== dbUser.procurement_source_id!.toString()) {
          return NextResponse.json(
            { error: 'Unauthorized. Visit belongs to another procurement source.', code: 'FORBIDDEN_SOURCE' },
            { status: 403 }
          );
        }
      } else if (validated.procurementSourceId) {
        // Unscoped manager/admin draft source validation
        if (existingVisit.procurement_source_id?.toString() !== validated.procurementSourceId) {
          return NextResponse.json(
            { error: 'Draft procurement source does not match selected source.', code: 'DRAFT_SOURCE_MISMATCH' },
            { status: 400 }
          );
        }
      }

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

    // 2. Resolve authoritative procurement source for a new Dispatch start
    let resolvedSourceId: bigint | null = null;
    const isSourceBound = !!dbUser.procurement_source_id;

    if (isSourceBound) {
      if (dbUser.procurement_source && !dbUser.procurement_source.is_active) {
        return NextResponse.json(
          { error: 'Bound procurement source is inactive or unavailable.', code: 'PROCUREMENT_SOURCE_INACTIVE' },
          { status: 400 }
        );
      }
      resolvedSourceId = dbUser.procurement_source_id!;
      if (validated.procurementSourceId && validated.procurementSourceId !== dbUser.procurement_source_id!.toString()) {
        return NextResponse.json(
          { error: 'Unauthorized. Source-bound user cannot create visits for another procurement source.', code: 'FORBIDDEN_SOURCE' },
          { status: 403 }
        );
      }
    } else if (validated.procurementSourceId) {
      const targetSrc = await prisma.procurementSource.findUnique({
        where: { id: BigInt(validated.procurementSourceId) },
      });
      if (!targetSrc || !targetSrc.is_active) {
        return NextResponse.json(
          { error: 'Selected procurement source is inactive or does not exist.', code: 'PROCUREMENT_SOURCE_INVALID' },
          { status: 400 }
        );
      }
      resolvedSourceId = targetSrc.id;
    } else {
      return NextResponse.json(
        { error: 'Procurement source is required for unscoped users.', code: 'PROCUREMENT_SOURCE_REQUIRED' },
        { status: 400 }
      );
    }

    const dateStr = validated.operationalDate || getOperationalBusinessDate(new Date());
    const dateCode = dateStr.replace(/-/g, '');

    // 3. Create persistent DRAFT_DISPATCH work item with frozen assignment and quantity policy
    const result = await prisma.$transaction(async (tx) => {
      const countToday = await tx.vehicleVisit.count({
        where: {
          visit_number: { startsWith: `VV-${dateCode}` },
        },
      });
      let seq = countToday + 1;
      let visitNumber = `VV-${dateCode}-${String(seq).padStart(4, '0')}`;
      while (await tx.vehicleVisit.findUnique({ where: { visit_number: visitNumber } })) {
        seq++;
        visitNumber = `VV-${dateCode}-${String(seq).padStart(4, '0')}`;
      }

      const visit = await tx.vehicleVisit.create({
        data: {
          visit_number: visitNumber,
          vehicle_number: (validated.vehicleNumber || 'DRAFT').toUpperCase().trim(),
          operational_date: new Date(dateStr),
          current_status: 'DRAFT_DISPATCH',
          created_by: dbUser.id,
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
  } catch (error: any) {
    if (error?.code === 'DISPATCH_QUANTITY_POLICY_INVALID') {
      return NextResponse.json(
        {
          error: 'Configured dispatch quantity policy for this procurement source is invalid.',
          code: 'DISPATCH_QUANTITY_POLICY_INVALID',
        },
        { status: 400 }
      );
    }
    if (error?.code === 'SNAPSHOT_SOURCE_MISMATCH' || error?.code === 'VISIT_SOURCE_MISMATCH') {
      return NextResponse.json(
        {
          error: error.message || 'Procurement source mismatch.',
          code: error.code,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error?.message || 'Failed to start dispatch work item' }, { status: 500 });
  }
}



