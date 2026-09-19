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
   * If none configured in database, defaults to OPTIONAL with allow_duplicates = false.
   */
  static async getPolicy(
    referenceType: PaperReferenceType,
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<PaperReferencePolicy> {
    const policy = await tx.paperReferencePolicy.findUnique({
      where: { reference_type: referenceType },
    });

    if (policy) return policy;

    return {
      id: BigInt(0),
      reference_type: referenceType,
      policy_mode: PaperPolicyMode.REQUIRED,
      allow_duplicates: false,
      duplicate_scope: 'GLOBAL',
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
        result.push({
          id: BigInt(0),
          reference_type: type,
          policy_mode: PaperPolicyMode.REQUIRED,
          allow_duplicates: false,
          duplicate_scope: 'GLOBAL',
          updated_by_user_id: null,
          updated_at: new Date(),
          created_at: new Date(),
        });
      }
    }
    return result;
  }

  /**
   * Checks for duplicate reference values within their authoritative table according to configured duplicate_scope.
   * Fails closed if duplicate_scope is unconfigured or unsupported.
   * No global cross-series unique constraints.
   */
  static async checkDuplicate(params: {
    referenceType: PaperReferenceType;
    value: string;
    scopeEntityId?: bigint | number | string;
    excludeEntityId?: bigint | number | string;
    duplicateScope?: string;
    tx?: Prisma.TransactionClient | typeof prisma;
  }): Promise<{ isDuplicate: boolean; existingRecordId?: bigint }> {
    const { referenceType, value, scopeEntityId, excludeEntityId, tx = prisma } = params;
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
      return { isDuplicate: !!match, existingRecordId: match?.id };
    }

    if (referenceType === PaperReferenceType.RAW_MILK_TOKEN) {
      const match = await tx.zmccMotArrival.findFirst({
        where: {
          raw_milk_token_number: value,
          ...(excludeIdBigInt ? { id: { not: excludeIdBigInt } } : {}),
          ...(duplicateScope === 'PER_SOURCE' && scopeIdBigInt ? { zmcc_id: scopeIdBigInt } : {}),
        },
        select: { id: true },
      });
      return { isDuplicate: !!match, existingRecordId: match?.id };
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
      return { isDuplicate: !!match, existingRecordId: match?.id };
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
      const dupCheck = await this.checkDuplicate({
        referenceType,
        value: validation.normalized,
        scopeEntityId: options.scopeEntityId,
        excludeEntityId: options.excludeEntityId,
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

    const scopeToSet = duplicateScope || 'GLOBAL';
    if (!['GLOBAL', 'PER_SOURCE'].includes(scopeToSet)) {
      throw new PaperValidationError(
        `Invalid duplicate_scope: "${scopeToSet}". Must be GLOBAL or PER_SOURCE.`
      );
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
