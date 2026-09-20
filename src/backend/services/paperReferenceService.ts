import { prisma } from '@core/db';
import { Prisma, PaperReferenceType, PaperPolicyMode, PaperReferencePolicy } from '@prisma/client';

export class PaperValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PaperValidationError';
  }
}

export interface PaperValidationResult {
  valid: boolean;
  normalized: string | null;
  error?: string;
}

export interface UpdatePolicyInput {
  referenceType: PaperReferenceType;
  policyMode: PaperPolicyMode;
  allowDuplicates: boolean;
  duplicateScope?: string;
  updatedByUserId: bigint | number | string;
  reason: string;
}

export class PaperReferenceService {
  /**
   * Pure validation of paper reference value against policy mode and digits-only regex.
   * Preserves leading zeros as a string.
   */
  static validatePaperReference(
    referenceType: PaperReferenceType,
    value: string | null | undefined,
    policy: { policy_mode: PaperPolicyMode; allow_duplicates?: boolean }
  ): PaperValidationResult {
    const raw = typeof value === 'string' ? value.trim() : '';

    // 1. DISABLED Mode
    if (policy.policy_mode === 'DISABLED') {
      if (raw.length > 0) {
        return {
          valid: false,
          normalized: null,
          error: `Paper reference ${referenceType} is DISABLED by operational policy.`,
        };
      }
      return { valid: true, normalized: null };
    }

    // 2. REQUIRED Mode
    if (policy.policy_mode === 'REQUIRED') {
      if (!raw) {
        return {
          valid: false,
          normalized: null,
          error: `Paper reference ${referenceType} is REQUIRED by operational policy.`,
        };
      }
    }

    // 3. If value provided (whether REQUIRED or OPTIONAL)
    if (raw.length > 0) {
      if (!/^[0-9]+$/.test(raw)) {
        return {
          valid: false,
          normalized: null,
          error: `Paper reference ${referenceType} must contain digits only (received: "${raw}").`,
        };
      }
      return { valid: true, normalized: raw };
    }

    return { valid: true, normalized: null };
  }

  /**
   * Resolves effective policy for a given reference type.
   * Default business rules:
   * - SHOP_RMR: REQUIRED, allow_duplicates = true (historical reuse allowed, not a system unique ID)
   * - RAW_MILK_TOKEN: REQUIRED, allow_duplicates = false, duplicate_scope = 'PER_SOURCE' (per ZMCC)
   * - RAW_MILK_DISPATCH_NOTE: REQUIRED, allow_duplicates = false, duplicate_scope = 'PER_SOURCE' (per issuing source)
   */
  static async getPolicy(
    referenceType: PaperReferenceType,
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<PaperReferencePolicy> {
    const policy = await tx.paperReferencePolicy.findUnique({
      where: { reference_type: referenceType },
    });

    if (policy) return policy;

    if (referenceType === PaperReferenceType.SHOP_RMR) {
      return {
        id: BigInt(0),
        reference_type: referenceType,
        policy_mode: PaperPolicyMode.REQUIRED,
        allow_duplicates: true,
        duplicate_scope: 'GLOBAL',
        updated_by_user_id: null,
        updated_at: new Date(),
        created_at: new Date(),
      };
    }

    return {
      id: BigInt(0),
      reference_type: referenceType,
      policy_mode: PaperPolicyMode.REQUIRED,
      allow_duplicates: false,
      duplicate_scope: 'PER_SOURCE',
      updated_by_user_id: null,
      updated_at: new Date(),
      created_at: new Date(),
    };
  }

  /**
   * Retrieves all paper reference policies. Ensures defaults for unconfigured types.
   */
  static async getAllPolicies(
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<PaperReferencePolicy[]> {
    const allTypes: PaperReferenceType[] = [
      PaperReferenceType.SHOP_RMR,
      PaperReferenceType.RAW_MILK_TOKEN,
      PaperReferenceType.RAW_MILK_DISPATCH_NOTE,
    ];

    const existing = await tx.paperReferencePolicy.findMany();
    const map = new Map<PaperReferenceType, PaperReferencePolicy>();
    for (const p of existing) {
      map.set(p.reference_type, p);
    }

    const result: PaperReferencePolicy[] = [];
    for (const type of allTypes) {
      if (map.has(type)) {
        result.push(map.get(type)!);
      } else {
        result.push(await this.getPolicy(type, tx));
      }
    }
    return result;
  }

  /**
   * Deterministic transaction-level PostgreSQL advisory lock for Raw Milk Token serials per ZMCC.
   */
  static async acquireRawMilkTokenAdvisoryLock(
    tx: Prisma.TransactionClient,
    zmccId: bigint | number | string,
    tokenValue: string
  ): Promise<void> {
    const lockKey = `RAW_MILK_TOKEN:${zmccId.toString()}:${tokenValue}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  /**
   * Checks for duplicate reference values within their authoritative domain according to configured duplicate_scope.
   * RAW_MILK_TOKEN checks ACROSS ALL active ZMCC arrival tables (ZmccMotArrival, ZmccLocalSupplierArrival) per ZMCC.
   * RAW_MILK_DISPATCH_NOTE checks per procurement source (issuer).
   * Fails closed if duplicate_scope is unconfigured or unsupported.
   */
  static async checkDuplicate(params: {
    referenceType: PaperReferenceType;
    value: string;
    scopeEntityId?: bigint | number | string;
    excludeEntityId?: bigint | number | string;
    excludeTable?: 'zmcc_mot_arrival' | 'zmcc_local_supplier_arrival' | 'vehicle_visit' | 'mot_shop_collection';
    duplicateScope?: string;
    tx?: Prisma.TransactionClient | typeof prisma;
  }): Promise<{ isDuplicate: boolean; existingRecordId?: bigint; existingTable?: string }> {
    const { referenceType, value, scopeEntityId, excludeEntityId, excludeTable, tx = prisma } = params;
    const excludeIdBigInt = excludeEntityId ? BigInt(String(excludeEntityId)) : undefined;

    let duplicateScope = params.duplicateScope;
    if (!duplicateScope) {
      const policy = await this.getPolicy(referenceType, tx);
      duplicateScope = policy.duplicate_scope;
    }

    // Fail closed if unconfigured or unsupported duplicate scope
    if (!duplicateScope || !['GLOBAL', 'PER_SOURCE'].includes(duplicateScope)) {
      throw new PaperValidationError(
        `Policy configuration error: duplicate scope "${duplicateScope}" is unconfigured or unsupported.`
      );
    }

    const scopeIdBigInt = scopeEntityId ? BigInt(String(scopeEntityId)) : undefined;
    if (duplicateScope === 'PER_SOURCE' && !scopeIdBigInt) {
      throw new PaperValidationError(
        `Policy configuration error: duplicate scope is PER_SOURCE but source ID was not provided.`
      );
    }

    if (referenceType === PaperReferenceType.SHOP_RMR) {
      const match = await tx.motShopCollection.findFirst({
        where: {
          shop_rmr_number: value,
          ...(excludeIdBigInt ? { id: { not: excludeIdBigInt } } : {}),
          ...(duplicateScope === 'PER_SOURCE' && scopeIdBigInt ? { zmcc_id: scopeIdBigInt } : {}),
        },
        select: { id: true },
      });
      return { isDuplicate: !!match, existingRecordId: match?.id, existingTable: 'mot_shop_collection' };
    }

    if (referenceType === PaperReferenceType.RAW_MILK_TOKEN) {
      // Must be checked per-ZMCC across all active ZMCC arrival types
      if (!scopeIdBigInt) {
        throw new PaperValidationError(
          `Policy configuration error: RAW_MILK_TOKEN requires ZMCC source ID.`
        );
      }

      // 1. Check ZmccMotArrival
      const matchMot = await tx.zmccMotArrival.findFirst({
        where: {
          raw_milk_token_number: value,
          zmcc_id: scopeIdBigInt,
          ...(excludeTable === 'zmcc_mot_arrival' && excludeIdBigInt ? { id: { not: excludeIdBigInt } } : {}),
        },
        select: { id: true },
      });
      if (matchMot) {
        return { isDuplicate: true, existingRecordId: matchMot.id, existingTable: 'zmcc_mot_arrival' };
      }

      // 2. Check ZmccLocalSupplierArrival
      const matchLs = await tx.zmccLocalSupplierArrival.findFirst({
        where: {
          raw_milk_token_number: value,
          zmcc_id: scopeIdBigInt,
          ...(excludeTable === 'zmcc_local_supplier_arrival' && excludeIdBigInt ? { id: { not: excludeIdBigInt } } : {}),
        },
        select: { id: true },
      });
      if (matchLs) {
        return { isDuplicate: true, existingRecordId: matchLs.id, existingTable: 'zmcc_local_supplier_arrival' };
      }

      return { isDuplicate: false };
    }

    if (referenceType === PaperReferenceType.RAW_MILK_DISPATCH_NOTE) {
      const match = await tx.vehicleVisit.findFirst({
        where: {
          raw_milk_dispatch_note_number: value,
          ...(excludeIdBigInt ? { id: { not: excludeIdBigInt } } : {}),
          ...(duplicateScope === 'PER_SOURCE' && scopeIdBigInt ? { procurement_source_id: scopeIdBigInt } : {}),
        },
        select: { id: true },
      });
      return { isDuplicate: !!match, existingRecordId: match?.id, existingTable: 'vehicle_visit' };
    }

    return { isDuplicate: false };
  }

  /**
   * Combined validation and duplicate verification for incoming paper reference input.
   * Throws PaperValidationError if invalid or duplicated.
   */
  static async validateAndVerify(
    referenceType: PaperReferenceType,
    value: string | null | undefined,
    options: {
      scopeEntityId?: bigint | number | string;
      excludeEntityId?: bigint | number | string;
      excludeTable?: 'zmcc_mot_arrival' | 'zmcc_local_supplier_arrival' | 'vehicle_visit' | 'mot_shop_collection';
      acquireAdvisoryLock?: boolean;
      tx?: Prisma.TransactionClient | typeof prisma;
    } = {}
  ): Promise<string | null> {
    const tx = options.tx || prisma;
    const policy = await this.getPolicy(referenceType, tx);

    const validation = this.validatePaperReference(referenceType, value, policy);
    if (!validation.valid) {
      throw new PaperValidationError(validation.error!);
    }

    if (validation.normalized && !policy.allow_duplicates) {
      // Optional transaction-level advisory lock for RAW_MILK_TOKEN under ZMCC concurrency
      if (
        options.acquireAdvisoryLock &&
        referenceType === PaperReferenceType.RAW_MILK_TOKEN &&
        options.scopeEntityId &&
        '$executeRaw' in tx
      ) {
        await this.acquireRawMilkTokenAdvisoryLock(
          tx as Prisma.TransactionClient,
          options.scopeEntityId,
          validation.normalized
        );
      }

      const dupCheck = await this.checkDuplicate({
        referenceType,
        value: validation.normalized,
        scopeEntityId: options.scopeEntityId,
        excludeEntityId: options.excludeEntityId,
        excludeTable: options.excludeTable,
        duplicateScope: policy.duplicate_scope,
        tx,
      });

      if (dupCheck.isDuplicate) {
        throw new PaperValidationError(
          `Duplicate paper reference ${referenceType} "${validation.normalized}" already exists in the system.`
        );
      }
    }

    return validation.normalized;
  }

  /**
   * Super Admin configuration of paper reference policies.
   */
  static async updatePolicy(
    input: UpdatePolicyInput,
    txOrPrisma: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<PaperReferencePolicy> {
    const { referenceType, policyMode, allowDuplicates, duplicateScope, updatedByUserId, reason } = input;
    const userIdBigInt = BigInt(String(updatedByUserId));

    const scopeToSet = duplicateScope || (referenceType === PaperReferenceType.SHOP_RMR ? 'GLOBAL' : 'PER_SOURCE');
    if (!['GLOBAL', 'PER_SOURCE'].includes(scopeToSet)) {
      throw new PaperValidationError(
        `Invalid duplicate_scope: "${scopeToSet}". Must be GLOBAL or PER_SOURCE.`
      );
    }

    // Guard: SHOP_RMR duplicate ownership is frozen: allow_duplicates must remain true
    if (referenceType === PaperReferenceType.SHOP_RMR) {
      if (allowDuplicates === false) {
        throw new PaperValidationError(
          `SHOP_RMR duplicate ownership is frozen: allow_duplicates must remain true. collection_number is the permanent system identity.`
        );
      }
      if (scopeToSet !== 'GLOBAL') {
        throw new PaperValidationError(
          `SHOP_RMR duplicate scope must remain GLOBAL.`
        );
      }
    }

    // Guard: RAW_MILK_TOKEN duplicate ownership is frozen: allow_duplicates must remain false, duplicate_scope must remain PER_SOURCE
    if (referenceType === PaperReferenceType.RAW_MILK_TOKEN) {
      if (allowDuplicates === true) {
        throw new PaperValidationError(
          `RAW_MILK_TOKEN duplicate ownership is frozen: allow_duplicates must remain false.`
        );
      }
      if (scopeToSet !== 'PER_SOURCE') {
        throw new PaperValidationError(
          `RAW_MILK_TOKEN duplicate scope must remain PER_SOURCE (per ZMCC).`
        );
      }
    }

    // Guard: RAW_MILK_DISPATCH_NOTE duplicate ownership is frozen: allow_duplicates must remain false, duplicate_scope must remain PER_SOURCE
    if (referenceType === PaperReferenceType.RAW_MILK_DISPATCH_NOTE) {
      if (allowDuplicates === true) {
        throw new PaperValidationError(
          `RAW_MILK_DISPATCH_NOTE duplicate ownership is frozen: allow_duplicates must remain false.`
        );
      }
      if (scopeToSet !== 'PER_SOURCE') {
        throw new PaperValidationError(
          `RAW_MILK_DISPATCH_NOTE duplicate scope must remain PER_SOURCE (per ProcurementSource).`
        );
      }
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.paperReferencePolicy.findUnique({
        where: { reference_type: referenceType },
      });

      const policy = await tx.paperReferencePolicy.upsert({
        where: { reference_type: referenceType },
        update: {
          policy_mode: policyMode,
          allow_duplicates: allowDuplicates,
          duplicate_scope: scopeToSet,
          updated_by_user_id: userIdBigInt,
        },
        create: {
          reference_type: referenceType,
          policy_mode: policyMode,
          allow_duplicates: allowDuplicates,
          duplicate_scope: scopeToSet,
          updated_by_user_id: userIdBigInt,
        },
      });

      // Audit Log entry
      await tx.auditLog.create({
        data: {
          table_name: 'paper_reference_policy',
          record_id: policy.id,
          action: 'PAPER_REFERENCE_POLICY_UPDATED',
          old_values: existing
            ? {
                reference_type: existing.reference_type,
                policy_mode: existing.policy_mode,
                allow_duplicates: existing.allow_duplicates,
                duplicate_scope: existing.duplicate_scope,
              }
            : Prisma.DbNull,
          new_values: {
            reference_type: referenceType,
            policy_mode: policyMode,
            allow_duplicates: allowDuplicates,
            duplicate_scope: scopeToSet,
            reason: reason || 'Super Admin policy update',
          },
          user_id: userIdBigInt,
        },
      });

      return policy;
    };

    if ('$transaction' in txOrPrisma) {
      return (txOrPrisma as typeof prisma).$transaction(execute);
    } else {
      return execute(txOrPrisma as Prisma.TransactionClient);
    }
  }
}
