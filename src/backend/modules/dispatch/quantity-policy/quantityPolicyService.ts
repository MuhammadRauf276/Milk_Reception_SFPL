import { PrismaClient, Prisma } from '@prisma/client';
import {
  DispatchQuantityPolicyConfig,
  DispatchQuantityPolicySnapshotDTO,
  DEFAULT_DISPATCH_QUANTITY_POLICY,
} from './types';
import { validateQuantityPolicy } from './validation';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class DispatchQuantityPolicyInvalidError extends Error {
  readonly code = 'DISPATCH_QUANTITY_POLICY_INVALID';
  constructor(message = 'Configured dispatch quantity policy for this procurement source is invalid.') {
    super(message);
    this.name = 'DispatchQuantityPolicyInvalidError';
  }
}

export class SnapshotSourceMismatchError extends Error {
  readonly code = 'SNAPSHOT_SOURCE_MISMATCH';
  constructor(message = 'Existing policy snapshot source does not match requested source.') {
    super(message);
    this.name = 'SnapshotSourceMismatchError';
  }
}

export class VisitSourceMismatchError extends Error {
  readonly code = 'VISIT_SOURCE_MISMATCH';
  constructor(message = 'Procurement source does not match visit source.') {
    super(message);
    this.name = 'VisitSourceMismatchError';
  }
}

export function serializeQuantityPolicySnapshot(
  snapshot: any
): DispatchQuantityPolicySnapshotDTO {
  return {
    id: snapshot.id?.toString(),
    visitId: snapshot.visit_id.toString(),
    sourceId: snapshot.source_id.toString(),
    policyVersion: snapshot.policy_version,
    policy: snapshot.policy_snapshot as DispatchQuantityPolicyConfig,
    createdAt: snapshot.created_at ? snapshot.created_at.toISOString() : undefined,
  };
}

/**
 * Resolves the active Dispatch Quantity Policy for a given procurement source.
 * Falls back to DEFAULT_DISPATCH_QUANTITY_POLICY ONLY if the source has not defined a custom policy.
 * If a custom policy exists but is malformed/invalid, throws DispatchQuantityPolicyInvalidError.
 * Operates purely on configuration without source-type branching.
 */
export async function resolveSourceQuantityPolicy(
  db: DbClient,
  sourceId: bigint | number | string
): Promise<DispatchQuantityPolicyConfig> {
  const parsedSourceId = typeof sourceId === 'bigint' ? sourceId : BigInt(sourceId);
  const source = await db.procurementSource.findUnique({
    where: { id: parsedSourceId },
  });

  if (!source) {
    throw new Error(`Procurement source with ID ${parsedSourceId} not found.`);
  }

  if (source.dispatch_quantity_policy !== null && source.dispatch_quantity_policy !== undefined) {
    try {
      return validateQuantityPolicy(source.dispatch_quantity_policy);
    } catch {
      throw new DispatchQuantityPolicyInvalidError();
    }
  }

  return DEFAULT_DISPATCH_QUANTITY_POLICY;
}

/**
 * Retrieves an existing frozen policy snapshot for a visit, or creates a new immutable
 * snapshot based on the source's current policy configuration.
 *
 * Enforces domain invariants:
 * 1. If an existing snapshot exists, its source_id must match the requested sourceId.
 * 2. If the visit exists in the database, its procurement_source_id must match the requested sourceId.
 */
export async function getOrFreezeDispatchQuantityPolicy(
  db: DbClient,
  visitId: bigint | number | string,
  sourceId: bigint | number | string
): Promise<DispatchQuantityPolicySnapshotDTO> {
  const parsedVisitId = typeof visitId === 'bigint' ? visitId : BigInt(visitId);
  const parsedSourceId = typeof sourceId === 'bigint' ? sourceId : BigInt(sourceId);

  // Invariant check: if visit already exists in DB, ensure its procurement_source_id matches supplied sourceId
  const visit = await db.vehicleVisit.findUnique({
    where: { id: parsedVisitId },
    select: { procurement_source_id: true },
  });

  if (visit && visit.procurement_source_id !== null && visit.procurement_source_id !== undefined) {
    if (visit.procurement_source_id !== parsedSourceId) {
      throw new VisitSourceMismatchError();
    }
  }

  // 1. Check for existing frozen snapshot
  const existing = await db.dispatchQuantityPolicySnapshot.findUnique({
    where: { visit_id: parsedVisitId },
  });

  if (existing) {
    if (existing.source_id !== parsedSourceId) {
      throw new SnapshotSourceMismatchError();
    }
    return serializeQuantityPolicySnapshot(existing);
  }

  // 2. Resolve current source policy and freeze snapshot
  const currentPolicy = await resolveSourceQuantityPolicy(db, parsedSourceId);

  const created = await db.dispatchQuantityPolicySnapshot.create({
    data: {
      visit_id: parsedVisitId,
      source_id: parsedSourceId,
      policy_version: currentPolicy.version,
      policy_snapshot: currentPolicy as any,
    },
  });

  return serializeQuantityPolicySnapshot(created);
}

/**
 * Returns existing frozen policy snapshot for a visit, or null if none exists.
 */
export async function getFrozenDispatchQuantityPolicy(
  db: DbClient,
  visitId: bigint | number | string
): Promise<DispatchQuantityPolicySnapshotDTO | null> {
  const parsedVisitId = typeof visitId === 'bigint' ? visitId : BigInt(visitId);
  const existing = await db.dispatchQuantityPolicySnapshot.findUnique({
    where: { visit_id: parsedVisitId },
  });

  if (!existing) return null;
  return serializeQuantityPolicySnapshot(existing);
}

/**
 * Updates a procurement source's configured quantity policy.
 */
export async function updateSourceQuantityPolicy(
  db: DbClient,
  sourceId: bigint | number | string,
  policy: unknown
): Promise<DispatchQuantityPolicyConfig> {
  const parsedSourceId = typeof sourceId === 'bigint' ? sourceId : BigInt(sourceId);
  const validated = validateQuantityPolicy(policy);

  await db.procurementSource.update({
    where: { id: parsedSourceId },
    data: {
      dispatch_quantity_policy: validated as any,
    },
  });

  return validated;
}

