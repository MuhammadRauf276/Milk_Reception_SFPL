// A dispatch form that has not been sent is NOT a vehicle visit.
//
// Opening the form saves nothing in the visit table. What the person types is kept in the draft store
// (form_draft), so a lost connection or an accidental Back press loses nothing. The visit row is created
// only when the form is submitted, and it is removed again if that submit is refused.
import { prisma } from '@core/db';
import type { Prisma } from '@prisma/client';
import { newDraftVisitNumber } from '@/backend/services/dispatch/visitNumber';
import { getOrAssignDispatchTests } from '@/backend/services/labTestAssignmentService';
import { getOrFreezeDispatchQuantityPolicy, resolveSourceQuantityPolicy } from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import type { DispatchQuantityPolicySnapshotDTO } from '@/backend/modules/dispatch/quantity-policy/types';
import type { LabTestResultOption } from '@/lib/validations/labTest';

/** The draft-store key for a form that has no visit yet: one per person per source. */
export const NEW_DISPATCH_DRAFT_KEY = 'new';

/** What an opened form needs to show its fields, worked out without saving anything. */
export async function previewNewDispatch(sourceId: bigint): Promise<{
  assignedTests: Array<{
    id: string;
    testId: string;
    testCode: string;
    testName: string;
    resultType: string;
    unit: string | null;
    testScope: string;
    isRequired: boolean;
    displayOrder: number;
    resultOptions: LabTestResultOption[] | null;
  }>;
  quantityPolicy: DispatchQuantityPolicySnapshotDTO;
}> {
  const [tests, policy] = await Promise.all([
    prisma.labTest.findMany({ where: { isActive: true, testScope: { in: ['DISPATCH', 'BOTH'] } } }),
    resolveSourceQuantityPolicy(prisma, sourceId),
  ]);
  tests.sort((a, b) => a.displayOrder - b.displayOrder || a.testName.localeCompare(b.testName));
  return {
    assignedTests: tests.map((t) => ({
      id: t.id.toString(),
      testId: t.id.toString(),
      testCode: t.testCode,
      testName: t.testName,
      resultType: t.resultType,
      unit: t.unit,
      testScope: t.testScope || 'BOTH',
      isRequired: t.isRequired,
      displayOrder: t.displayOrder,
      resultOptions: (t.resultOptions as LabTestResultOption[] | null) ?? null,
    })),
    // Not frozen yet: the rules are frozen onto the visit at the moment it is submitted.
    quantityPolicy: { visitId: '', sourceId: sourceId.toString(), policyVersion: policy.version, policy },
  };
}

/**
 * The visit row for a form that is being submitted right now, with its tests and quantity rules.
 * It carries a private id, not a visit number: the real number is given by the submit itself.
 */
export async function createVisitForSubmit(userId: bigint, sourceId: bigint): Promise<bigint> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const visit = await tx.vehicleVisit.create({
      data: {
        visit_number: newDraftVisitNumber(),
        vehicle_number: 'DRAFT',
        operational_date: null,
        current_status: 'DRAFT_DISPATCH',
        creator: { connect: { id: userId } },
        procurement_source: { connect: { id: sourceId } },
      },
      select: { id: true },
    });
    await getOrAssignDispatchTests(tx, visit.id);
    await getOrFreezeDispatchQuantityPolicy(tx, visit.id, sourceId);
    return visit.id;
  });
}

/**
 * Removes the row made by createVisitForSubmit when the submit was refused. Only a row that is still unsent
 * is removed: a visit that was really submitted is never touched. Its tests and rules go with it.
 */
export async function discardUnsentVisit(visitId: bigint): Promise<void> {
  await prisma.vehicleVisit.deleteMany({ where: { id: visitId, current_status: 'DRAFT_DISPATCH' } });
}
