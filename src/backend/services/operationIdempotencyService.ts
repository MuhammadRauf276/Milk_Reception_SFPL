import { prisma } from '@/backend/core/db';
import { Prisma } from '@prisma/client';

export type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

export interface OperationIdempotencyRecordData {
  id: bigint;
  key: string;
  operation_type: string;
  entity_type: string;
  entity_id: bigint;
  request_payload: any;
  response_payload: any;
  status_code: number;
  created_at: Date;
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
 * Persist an idempotency record for a successfully completed mutation.
 */
export async function recordOperation(
  params: {
    key: string;
    operationType: string;
    entityType: string;
    entityId: bigint | number;
    requestPayload?: any;
    responsePayload: any;
    statusCode?: number;
  },
  client: PrismaClientOrTx = prisma
): Promise<OperationIdempotencyRecordData> {
  const entityIdBigInt = typeof params.entityId === 'bigint' ? params.entityId : BigInt(params.entityId);

  const reqJson = params.requestPayload !== undefined
    ? JSON.parse(JSON.stringify(params.requestPayload, (_k, v) => typeof v === 'bigint' ? v.toString() : v))
    : Prisma.JsonNull;

  const resJson = JSON.parse(JSON.stringify(params.responsePayload, (_k, v) => typeof v === 'bigint' ? v.toString() : v));

  return client.operationIdempotencyRecord.create({
    data: {
      key: params.key,
      operation_type: params.operationType,
      entity_type: params.entityType,
      entity_id: entityIdBigInt,
      request_payload: reqJson,
      response_payload: resJson,
      status_code: params.statusCode ?? 200,
    },
  }) as Promise<OperationIdempotencyRecordData>;
}

/**
 * Validate that incoming replay payload matches the original stored payload.
 * If critical fields differ, this returns false indicating a 409 Conflict.
 */
export function validateReplayPayload(
  storedPayload: any,
  incomingPayload: any,
  criticalFields?: string[]
): boolean {
  if (!storedPayload || !incomingPayload) return true;

  if (criticalFields && criticalFields.length > 0) {
    for (const field of criticalFields) {
      const storedVal = storedPayload[field];
      const incomingVal = incomingPayload[field];
      if (storedVal !== undefined && incomingVal !== undefined) {
        if (String(storedVal).trim().toLowerCase() !== String(incomingVal).trim().toLowerCase()) {
          return false;
        }
      }
    }
    return true;
  }

  // Check all fields in incomingPayload that exist in storedPayload
  for (const [k, incomingVal] of Object.entries(incomingPayload)) {
    if (incomingVal !== undefined && incomingVal !== null && typeof incomingVal !== 'object') {
      const storedVal = storedPayload[k];
      if (storedVal !== undefined && storedVal !== null && typeof storedVal !== 'object') {
        if (String(storedVal).trim().toLowerCase() !== String(incomingVal).trim().toLowerCase()) {
          return false;
        }
      }
    }
  }
  return true;
}
