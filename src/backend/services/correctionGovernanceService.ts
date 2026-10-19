import { prisma } from '@/backend/core/db';
import { User } from '@/backend/core/types';
import { Prisma } from '@prisma/client';
import { toJsonInput } from '@/lib/json';
import { correctCompletedSession } from '@/backend/services/zmccLabService';
import { correctShopCollection } from '@/backend/services/mot/motCore';

export interface CreateCorrectionRequestInput {
  userId: bigint;
  module: string;
  recordId: string;
  sourceId?: bigint | null;
  reason: string;
  requestedChanges: Record<string, unknown>;
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SerializedCorrectionRequest {
  id: string;
  correlationId: string;
  module: string;
  recordId: string;
  sourceId: string | null;
  impact: string;
  status: string;
  reason: string;
  requestedChanges: Record<string, unknown>;
  requestedAt: string;
  requestedBy: {
    id: string;
    username: string;
    name: string;
  };
  reviewedAt: string | null;
  reviewReason: string | null;
  reviewedBy: {
    id: string;
    username: string;
    name: string;
  } | null;
}

export async function createCorrectionRequest(input: CreateCorrectionRequestInput) {
  const correlationId = `CORR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const impact = input.impact || 'MEDIUM';

  const req = await prisma.correctionRequest.create({
    data: {
      correlation_id: correlationId,
      module: input.module,
      record_id: input.recordId,
      source_id: input.sourceId ?? null,
      impact,
      status: 'REQUESTED',
      reason: input.reason.trim(),
      requested_changes: input.requestedChanges as Prisma.InputJsonValue,
      requested_by_user_id: input.userId,
    },
    include: {
      requester: true,
    },
  });

  // Notify Data Executive & Super Admin
  try {
    await prisma.auditLog.create({
      data: {
        table_name: 'correction_request',
        record_id: req.id,
        action: 'CORRECTION_REQUESTED',
        old_values: Prisma.DbNull,
        new_values: toJsonInput({
          correlation_id: correlationId,
          module: input.module,
          record_id: input.recordId,
          reason: input.reason,
          changes: input.requestedChanges,
        }),
        user_id: input.userId,
      },
    });
  } catch (err) {
    console.error('AuditLog creation failed for correction request:', err);
  }

  return req;
}

export async function listCorrectionRequests(filter: {
  status?: string;
  module?: string;
  sourceId?: bigint | null;
  limit?: number;
}) {
  const where: Prisma.CorrectionRequestWhereInput = {};
  if (filter.status && filter.status !== 'ALL') {
    where.status = filter.status;
  }
  if (filter.module && filter.module !== 'ALL') {
    where.module = filter.module;
  }
  if (filter.sourceId) {
    where.source_id = filter.sourceId;
  }

  const items = await prisma.correctionRequest.findMany({
    where,
    include: {
      requester: true,
      reviewer: true,
    },
    orderBy: { requested_at: 'desc' },
    take: filter.limit ?? 100,
  });

  return items.map((item): SerializedCorrectionRequest => ({
    id: item.id.toString(),
    correlationId: item.correlation_id,
    module: item.module,
    recordId: item.record_id,
    sourceId: item.source_id ? item.source_id.toString() : null,
    impact: item.impact,
    status: item.status,
    reason: item.reason,
    requestedChanges: (item.requested_changes as Record<string, unknown>) || {},
    requestedAt: item.requested_at.toISOString(),
    requestedBy: {
      id: item.requester.id.toString(),
      username: item.requester.username,
      name: item.requester.full_name || item.requester.username,
    },
    reviewedAt: item.reviewed_at ? item.reviewed_at.toISOString() : null,
    reviewReason: item.review_reason,
    reviewedBy: item.reviewer
      ? {
          id: item.reviewer.id.toString(),
          username: item.reviewer.username,
          name: item.reviewer.full_name || item.reviewer.username,
        }
      : null,
  }));
}

export async function rejectCorrectionRequest(
  requestId: bigint,
  reviewerUser: User,
  reviewReason: string
) {
  const req = await prisma.correctionRequest.findUnique({
    where: { id: requestId },
  });
  if (!req) {
    throw new Error('Correction request not found.');
  }
  if (req.status !== 'REQUESTED') {
    throw new Error(`Cannot reject correction request in status: ${req.status}`);
  }

  const reviewerId = BigInt(reviewerUser.id);
  const updated = await prisma.correctionRequest.update({
    where: { id: requestId },
    data: {
      status: 'REJECTED',
      reviewed_by_user_id: reviewerId,
      reviewed_at: new Date(),
      review_reason: reviewReason.trim(),
    },
    include: {
      requester: true,
      reviewer: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      table_name: 'correction_request',
      record_id: req.id,
      action: 'CORRECTION_REQUEST_REJECTED',
      old_values: { status: req.status },
      new_values: { status: 'REJECTED', review_reason: reviewReason },
      user_id: reviewerId,
    },
  });

  return updated;
}

export async function applyCorrectionRequest(
  requestId: bigint,
  reviewerUser: User
) {
  const req = await prisma.correctionRequest.findUnique({
    where: { id: requestId },
  });
  if (!req) {
    throw new Error('Correction request not found.');
  }
  if (req.status !== 'REQUESTED' && req.status !== 'APPROVED') {
    throw new Error(`Cannot apply correction request in status: ${req.status}`);
  }

  const reviewerId = BigInt(reviewerUser.id);
  const changes = (req.requested_changes as Record<string, unknown>) || {};
  let applicationResult: unknown = null;

  // Execute module-specific application
  if (req.module === 'ZMCC_LAB_SESSION') {
    const res = await correctCompletedSession(reviewerUser, req.record_id, {
      reason: `Applied from Correction Request #${req.correlation_id}: ${req.reason}`,
      quantity_value: typeof changes.quantity_value === 'number' ? changes.quantity_value : undefined,
      quantity_unit: typeof changes.quantity_unit === 'string' ? (changes.quantity_unit as 'KG' | 'LITER') : undefined,
      decision: typeof changes.decision === 'string' ? (changes.decision as 'ACCEPTED' | 'REJECTED') : undefined,
      results: Array.isArray(changes.results) ? changes.results : undefined,
    });
    if (res.error) {
      throw new Error(`Lab correction failed: ${res.error}`);
    }
    applicationResult = res.data;
  } else if (req.module === 'MOT_SHOP_COLLECTION') {
    const res = await correctShopCollection(reviewerUser, req.record_id, {
      reason: `Applied from Correction Request #${req.correlation_id}: ${req.reason}`,
      quantity_value: typeof changes.quantity_value === 'number' ? changes.quantity_value : undefined,
      quantity_unit: typeof changes.quantity_unit === 'string' ? (changes.quantity_unit as 'KG' | 'LITER') : undefined,
      lr: typeof changes.lr === 'number' ? changes.lr : undefined,
      fat: typeof changes.fat === 'number' ? changes.fat : undefined,
      shop_rmr_number: typeof changes.shop_rmr_number === 'string' ? changes.shop_rmr_number : undefined,
    });
    if (res.error) {
      throw new Error(`MOT collection correction failed: ${res.error}`);
    }
    applicationResult = res.data;
  }

  // Update request status to APPLIED
  const updated = await prisma.correctionRequest.update({
    where: { id: requestId },
    data: {
      status: 'APPLIED',
      reviewed_by_user_id: reviewerId,
      reviewed_at: new Date(),
      review_reason: 'Approved and applied to production database.',
    },
    include: {
      requester: true,
      reviewer: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      table_name: 'correction_request',
      record_id: req.id,
      action: 'CORRECTION_REQUEST_APPLIED',
      old_values: { status: req.status },
      new_values: { status: 'APPLIED', application_result: applicationResult ? 'SUCCESS' : 'MANUAL_APPLY' },
      user_id: reviewerId,
    },
  });

  return { request: updated, result: applicationResult };
}
