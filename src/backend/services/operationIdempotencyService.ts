import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/backend/core/db';
import { Prisma } from '@prisma/client';

export type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

export interface OperationIdempotencyRecordData {
  id: bigint;
  key: string;
  operation_type: string;
  entity_type: string;
  entity_id: bigint;
  payload_hash: string | null;
  request_payload: any;
  response_payload: any;
  status_code: number;
  created_at: Date;
}

/**
 * Recursively canonicalizes a value for deterministic JSON representation.
 * - Sorts object keys alphabetically
 * - Converts BigInt to string
 * - Converts Date to ISOString
 * - Preserves original string contents (no generic global trimming)
 * - Recursively processes arrays and nested objects
 * - Distinguishes null vs omitted fields deterministically
 */
export function canonicalizeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  // Plain object: sort keys deterministically
  const sortedObj: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const k of keys) {
    const val = (value as Record<string, unknown>)[k];
    if (val !== undefined) {
      sortedObj[k] = canonicalizeValue(val);
    }
  }
  return sortedObj;
}

/**
 * Returns deterministic canonical JSON string.
 */
export function canonicalizeJson(value: unknown): string {
  const canon = canonicalizeValue(value);
  if (canon === undefined) return '';
  return JSON.stringify(canon);
}

/**
 * Computes a SHA-256 hex digest of the canonicalized value.
 */
export function computePayloadHash(value: unknown): string {
  const canonical = canonicalizeJson(value);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Look up an existing idempotency record by key.
 */
export async function findOperationRecord(
  key: string,
  client: PrismaClientOrTx = prisma
): Promise<OperationIdempotencyRecordData | null> {
  const record = await client.operationIdempotencyRecord.findUnique({
    where: { key },
  });
  return record as OperationIdempotencyRecordData | null;
}

/**
 * Wait for a concurrent operation to commit and write its idempotency record.
 * Polls every `pollIntervalMs` up to `maxWaitMs`.
 * Always uses the root prisma client to ensure polling executes outside
 * any failed, rolled-back, or lock-holding transaction clients.
 */
export async function waitForOperationRecord(
  key: string,
  maxWaitMs = 2500,
  pollIntervalMs = 50,
  _client?: PrismaClientOrTx
): Promise<OperationIdempotencyRecordData | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const record = await findOperationRecord(key, prisma);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return findOperationRecord(key, prisma);
}

/**
 * Persist an idempotency record for a successfully completed mutation.
 */
export async function recordOperation(
  params: {
    key: string;
    operationType: string;
    entityType: string;
    entityId: bigint | number | string;
    requestPayload?: unknown;
    responsePayload: unknown;
    statusCode?: number;
  },
  client: PrismaClientOrTx = prisma
): Promise<OperationIdempotencyRecordData> {
  const entityIdBigInt = typeof params.entityId === 'bigint' ? params.entityId : BigInt(params.entityId);

  const canonicalReq = canonicalizeValue(params.requestPayload);
  const payloadHash = computePayloadHash({
    operationType: params.operationType,
    entityType: params.entityType,
    entityId: entityIdBigInt.toString(),
    payload: canonicalReq,
  });

  const reqJson = canonicalReq !== null && canonicalReq !== undefined
    ? JSON.parse(JSON.stringify(canonicalReq))
    : Prisma.JsonNull;

  const resJson = JSON.parse(
    JSON.stringify(canonicalizeValue(params.responsePayload), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );

  return client.operationIdempotencyRecord.create({
    data: {
      key: params.key,
      operation_type: params.operationType,
      entity_type: params.entityType,
      entity_id: entityIdBigInt,
      payload_hash: payloadHash,
      request_payload: reqJson,
      response_payload: resJson,
      status_code: params.statusCode ?? 200,
    },
  }) as Promise<OperationIdempotencyRecordData>;
}

/**
 * Verify that a replay matches the stored operation:
 * - Checks operation type
 * - Checks entity type
 * - Checks entity ID
 * - Checks SHA-256 payload hash
 */
export function verifyReplay(
  record: OperationIdempotencyRecordData,
  params: {
    operationType: string;
    entityType: string;
    entityId: bigint | string | number;
    incomingPayload: unknown;
  }
): { isMatch: boolean; reason?: string } {
  if (record.operation_type !== params.operationType) {
    return {
      isMatch: false,
      reason: `Operation type mismatch: key was created for operation '${record.operation_type}', but reused for '${params.operationType}'.`,
    };
  }

  if (record.entity_type !== params.entityType) {
    return {
      isMatch: false,
      reason: `Entity type mismatch: expected '${params.entityType}', but key was registered for '${record.entity_type}'.`,
    };
  }

  if (record.entity_id.toString() !== params.entityId.toString()) {
    return {
      isMatch: false,
      reason: `Entity ID mismatch: expected '${params.entityId}', but key was registered for entity ID '${record.entity_id}'.`,
    };
  }

  // A missing stored payload must not automatically be treated as an exact replay
  if (!record.payload_hash && (record.request_payload === null || record.request_payload === undefined)) {
    if (params.incomingPayload !== null && params.incomingPayload !== undefined) {
      return {
        isMatch: false,
        reason: 'Idempotency conflict: Stored operation record has no payload data to verify replay.',
      };
    }
  }

  const incomingCanonical = canonicalizeValue(params.incomingPayload);
  const incomingHash = computePayloadHash({
    operationType: params.operationType,
    entityType: params.entityType,
    entityId: params.entityId.toString(),
    payload: incomingCanonical,
  });

  const storedHash = record.payload_hash || computePayloadHash({
    operationType: record.operation_type,
    entityType: record.entity_type,
    entityId: record.entity_id.toString(),
    payload: canonicalizeValue(record.request_payload),
  });

  if (incomingHash !== storedHash) {
    return {
      isMatch: false,
      reason: 'Idempotency conflict: Payload hash mismatch - key reused with modified or mismatched request payload parameters.',
    };
  }

  // Stored record must have a completed response payload
  if (record.response_payload === null || record.response_payload === undefined) {
    return {
      isMatch: false,
      reason: 'Idempotency conflict: Stored operation record has no completed response payload.',
    };
  }

  return { isMatch: true };
}

/**
 * Backward compatibility helper for existing callers.
 * A missing stored payload must not automatically be treated as an exact replay.
 */
export function validateReplayPayload(
  storedPayload: any,
  incomingPayload: any,
  criticalFields?: string[]
): boolean {
  if (storedPayload === undefined && incomingPayload === undefined) return true;
  if (storedPayload === null && incomingPayload === null) return true;
  if (storedPayload === null || storedPayload === undefined || incomingPayload === null || incomingPayload === undefined) {
    return false;
  }
  if (Array.isArray(criticalFields) && criticalFields.length > 0) {
    for (const field of criticalFields) {
      const v1 = storedPayload[field];
      const v2 = incomingPayload[field];
      if (canonicalizeJson(v1) !== canonicalizeJson(v2)) {
        return false;
      }
    }
  }
  const hash1 = computePayloadHash(storedPayload);
  const hash2 = computePayloadHash(incomingPayload);
  return hash1 === hash2;
}

/**
 * Standard replay check before starting a transaction.
 */
export async function checkOperationReplay(
  key: string,
  params: {
    operationType: string;
    entityType: string;
    entityId: bigint | string | number;
    incomingPayload: unknown;
  },
  client: PrismaClientOrTx = prisma
): Promise<NextResponse | null> {
  const existingOp = await findOperationRecord(key, client);
  if (!existingOp) return null;

  const verification = verifyReplay(existingOp, params);
  if (!verification.isMatch) {
    return NextResponse.json(
      { error: verification.reason || 'Idempotency conflict: Key reused with different payload.' },
      { status: 409 }
    );
  }

  const rawResponse = existingOp.response_payload;
  if (!rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
    return NextResponse.json(
      { error: 'Idempotency error: Stored operation record has an invalid response payload shape.' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ...(rawResponse as Record<string, unknown>),
      idempotent: true,
      is_replay: true,
    },
    { status: existingOp.status_code || 200 }
  );
}

/**
 * Handles concurrent replay recovery when a transaction fails or hits a lock.
 * Waits for the concurrent winner's operation record, verifies the payload, and returns 200 or 409.
 */
export async function handleConcurrentReplayOrConflict(
  key: string,
  params: {
    operationType: string;
    entityType: string;
    entityId: bigint | string | number;
    incomingPayload: unknown;
  }
): Promise<NextResponse | null> {
  const record = await waitForOperationRecord(key, 2500, 50);
  if (!record) return null;

  const verification = verifyReplay(record, params);
  if (!verification.isMatch) {
    return NextResponse.json(
      { error: verification.reason || 'Idempotency conflict: Key reused with different payload.' },
      { status: 409 }
    );
  }

  const rawResponse = record.response_payload;
  if (!rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
    return NextResponse.json(
      { error: 'Idempotency error: Stored operation record has an invalid response payload shape.' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ...(rawResponse as Record<string, unknown>),
      idempotent: true,
      is_replay: true,
    },
    { status: record.status_code || 200 }
  );
}
