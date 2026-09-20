import { describe, it, expect } from 'vitest';
import { PaperReferenceService } from '@/backend/services/paperReferenceService';
import { PaperReferenceType, PaperPolicyMode } from '@prisma/client';

describe('PaperReferenceService (Unit Tests)', () => {
  describe('Pure Validation & Leading Zero Preservation', () => {
    it('accepts digits-only strings and preserves leading zeros', () => {
      const policy = { policy_mode: 'REQUIRED' as PaperPolicyMode, allow_duplicates: false };
      
      const res1 = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, '004821', policy);
      expect(res1.valid).toBe(true);
      expect(res1.normalized).toBe('004821');
      expect(typeof res1.normalized).toBe('string');

      const res2 = PaperReferenceService.validatePaperReference('RAW_MILK_TOKEN' as PaperReferenceType, '001924', policy);
      expect(res2.valid).toBe(true);
      expect(res2.normalized).toBe('001924');

      const res3 = PaperReferenceService.validatePaperReference('RAW_MILK_DISPATCH_NOTE' as PaperReferenceType, '008124', policy);
      expect(res3.valid).toBe(true);
      expect(res3.normalized).toBe('008124');

      const res4 = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, '000001', policy);
      expect(res4.valid).toBe(true);
      expect(res4.normalized).toBe('000001');
    });

    it('rejects values containing non-digit characters', () => {
      const policy = { policy_mode: 'REQUIRED' as PaperPolicyMode, allow_duplicates: false };

      const invalidSamples = ['RMR-001', '123-456', '12.34', 'ABC', ' 1234 ', '004821A', '00 4821'];
      for (const sample of invalidSamples) {
        const trimmed = sample.trim();
        // If sample trimmed is still non-digit
        if (!/^[0-9]+$/.test(trimmed)) {
          const res = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, sample, policy);
          expect(res.valid).toBe(false);
          expect(res.error).toContain('must contain digits only');
        }
      }
    });

    it('enforces REQUIRED policy mode', () => {
      const policy = { policy_mode: 'REQUIRED' as PaperPolicyMode, allow_duplicates: false };

      const emptyRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, '', policy);
      expect(emptyRes.valid).toBe(false);
      expect(emptyRes.error).toContain('REQUIRED');

      const nullRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, null, policy);
      expect(nullRes.valid).toBe(false);
      expect(nullRes.error).toContain('REQUIRED');

      const undefinedRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, undefined, policy);
      expect(undefinedRes.valid).toBe(false);
      expect(undefinedRes.error).toContain('REQUIRED');

      const whitespaceRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, '   ', policy);
      expect(whitespaceRes.valid).toBe(false);
      expect(whitespaceRes.error).toContain('REQUIRED');
    });

    it('enforces OPTIONAL policy mode', () => {
      const policy = { policy_mode: 'OPTIONAL' as PaperPolicyMode, allow_duplicates: false };

      const emptyRes = PaperReferenceService.validatePaperReference('RAW_MILK_TOKEN' as PaperReferenceType, '', policy);
      expect(emptyRes.valid).toBe(true);
      expect(emptyRes.normalized).toBeNull();

      const nullRes = PaperReferenceService.validatePaperReference('RAW_MILK_TOKEN' as PaperReferenceType, null, policy);
      expect(nullRes.valid).toBe(true);
      expect(nullRes.normalized).toBeNull();

      const validRes = PaperReferenceService.validatePaperReference('RAW_MILK_TOKEN' as PaperReferenceType, '001924', policy);
      expect(validRes.valid).toBe(true);
      expect(validRes.normalized).toBe('001924');

      const invalidRes = PaperReferenceService.validatePaperReference('RAW_MILK_TOKEN' as PaperReferenceType, 'TOKEN-1924', policy);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.error).toContain('must contain digits only');
    });

    it('enforces DISABLED policy mode', () => {
      const policy = { policy_mode: 'DISABLED' as PaperPolicyMode, allow_duplicates: false };

      const emptyRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, '', policy);
      expect(emptyRes.valid).toBe(true);
      expect(emptyRes.normalized).toBeNull();

      const nullRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, null, policy);
      expect(nullRes.valid).toBe(true);
      expect(nullRes.normalized).toBeNull();

      const providedRes = PaperReferenceService.validatePaperReference('SHOP_RMR' as PaperReferenceType, '004821', policy);
      expect(providedRes.valid).toBe(false);
      expect(providedRes.error).toContain('is DISABLED');
    });
  });

  describe('Policy Mode Defaults & Fail-Closed Duplicate Scopes (Directives 11, 13)', () => {
    it('defaults unconfigured policies according to frozen architecture rules', async () => {
      const mockTx: any = {
        paperReferencePolicy: {
          findUnique: async () => null,
          findMany: async () => [],
        },
      };

      const shopPolicy = await PaperReferenceService.getPolicy('SHOP_RMR' as PaperReferenceType, mockTx);
      expect(shopPolicy.policy_mode).toBe('REQUIRED');
      expect(shopPolicy.duplicate_scope).toBe('GLOBAL');
      expect(shopPolicy.allow_duplicates).toBe(true);

      const tokenPolicy = await PaperReferenceService.getPolicy('RAW_MILK_TOKEN' as PaperReferenceType, mockTx);
      expect(tokenPolicy.policy_mode).toBe('REQUIRED');
      expect(tokenPolicy.duplicate_scope).toBe('PER_SOURCE');
      expect(tokenPolicy.allow_duplicates).toBe(false);

      const dispatchPolicy = await PaperReferenceService.getPolicy('RAW_MILK_DISPATCH_NOTE' as PaperReferenceType, mockTx);
      expect(dispatchPolicy.policy_mode).toBe('REQUIRED');
      expect(dispatchPolicy.duplicate_scope).toBe('PER_SOURCE');
      expect(dispatchPolicy.allow_duplicates).toBe(false);

      const all = await PaperReferenceService.getAllPolicies(mockTx);
      expect(all).toHaveLength(3);
      for (const p of all) {
        expect(p.policy_mode).toBe('REQUIRED');
      }
    });

    it('fails closed with PaperValidationError when duplicate_scope is unsupported', async () => {
      await expect(
        PaperReferenceService.checkDuplicate({
          referenceType: 'RAW_MILK_DISPATCH_NOTE' as PaperReferenceType,
          value: '001234',
          duplicateScope: 'UNSUPPORTED_CUSTOM_SCOPE',
        })
      ).rejects.toThrow('Policy configuration error');
    });

    it('fails closed when duplicate_scope is PER_SOURCE but source ID is missing', async () => {
      await expect(
        PaperReferenceService.checkDuplicate({
          referenceType: 'RAW_MILK_DISPATCH_NOTE' as PaperReferenceType,
          value: '001234',
          duplicateScope: 'PER_SOURCE',
          // scopeEntityId omitted
        })
      ).rejects.toThrow('Policy configuration error: duplicate scope is PER_SOURCE');
    });

    it('queries with source filter when duplicate_scope is PER_SOURCE and source ID is provided', async () => {
      let queriedWhere: any = null;
      const mockTx: any = {
        vehicleVisit: {
          findFirst: async ({ where }: any) => {
            queriedWhere = where;
            return null;
          },
        },
      };

      const res = await PaperReferenceService.checkDuplicate({
        referenceType: 'RAW_MILK_DISPATCH_NOTE' as PaperReferenceType,
        value: '001234',
        duplicateScope: 'PER_SOURCE',
        scopeEntityId: BigInt(42),
        tx: mockTx,
      });

      expect(res.isDuplicate).toBe(false);
      expect(queriedWhere).toBeDefined();
      expect(queriedWhere.raw_milk_dispatch_note_number).toBe('001234');
      expect(queriedWhere.procurement_source_id).toEqual(BigInt(42));
    });

    it('detects cross-table duplicate for RAW_MILK_TOKEN across MOT and Local Supplier in same ZMCC', async () => {
      // 1. Duplicate exists in ZmccMotArrival
      const mockTxMotMatch: any = {
        zmccMotArrival: {
          findFirst: async () => ({ id: BigInt(101) }),
        },
        zmccLocalSupplierArrival: {
          findFirst: async () => null,
        },
      };

      const motRes = await PaperReferenceService.checkDuplicate({
        referenceType: 'RAW_MILK_TOKEN' as PaperReferenceType,
        value: '001924',
        duplicateScope: 'PER_SOURCE',
        scopeEntityId: BigInt(5),
        tx: mockTxMotMatch,
      });
      expect(motRes.isDuplicate).toBe(true);
      expect(motRes.existingRecordId).toEqual(BigInt(101));
      expect(motRes.existingTable).toBe('zmcc_mot_arrival');

      // 2. Duplicate exists in ZmccLocalSupplierArrival
      const mockTxLsMatch: any = {
        zmccMotArrival: {
          findFirst: async () => null,
        },
        zmccLocalSupplierArrival: {
          findFirst: async () => ({ id: BigInt(202) }),
        },
      };

      const lsRes = await PaperReferenceService.checkDuplicate({
        referenceType: 'RAW_MILK_TOKEN' as PaperReferenceType,
        value: '001924',
        duplicateScope: 'PER_SOURCE',
        scopeEntityId: BigInt(5),
        tx: mockTxLsMatch,
      });
      expect(lsRes.isDuplicate).toBe(true);
      expect(lsRes.existingRecordId).toEqual(BigInt(202));
      expect(lsRes.existingTable).toBe('zmcc_local_supplier_arrival');
    });

    it('guards updatePolicy against setting GLOBAL scope or allow_duplicates=true on RAW_MILK_TOKEN or RAW_MILK_DISPATCH_NOTE', async () => {
      await expect(
        PaperReferenceService.updatePolicy({
          referenceType: 'RAW_MILK_TOKEN' as PaperReferenceType,
          policyMode: 'REQUIRED' as PaperPolicyMode,
          allowDuplicates: false,
          duplicateScope: 'GLOBAL',
          updatedByUserId: BigInt(1),
          reason: 'Test invalid scope',
        })
      ).rejects.toThrow('RAW_MILK_TOKEN duplicate scope must remain PER_SOURCE');

      await expect(
        PaperReferenceService.updatePolicy({
          referenceType: 'RAW_MILK_TOKEN' as PaperReferenceType,
          policyMode: 'REQUIRED' as PaperPolicyMode,
          allowDuplicates: true,
          duplicateScope: 'PER_SOURCE',
          updatedByUserId: BigInt(1),
          reason: 'Test invalid duplicates',
        })
      ).rejects.toThrow('RAW_MILK_TOKEN duplicate ownership is frozen: allow_duplicates must remain false');

      await expect(
        PaperReferenceService.updatePolicy({
          referenceType: 'RAW_MILK_DISPATCH_NOTE' as PaperReferenceType,
          policyMode: 'REQUIRED' as PaperPolicyMode,
          allowDuplicates: false,
          duplicateScope: 'GLOBAL',
          updatedByUserId: BigInt(1),
          reason: 'Test invalid scope',
        })
      ).rejects.toThrow('RAW_MILK_DISPATCH_NOTE duplicate scope must remain PER_SOURCE');

      await expect(
        PaperReferenceService.updatePolicy({
          referenceType: 'RAW_MILK_DISPATCH_NOTE' as PaperReferenceType,
          policyMode: 'REQUIRED' as PaperPolicyMode,
          allowDuplicates: true,
          duplicateScope: 'PER_SOURCE',
          updatedByUserId: BigInt(1),
          reason: 'Test invalid duplicates',
        })
      ).rejects.toThrow('RAW_MILK_DISPATCH_NOTE duplicate ownership is frozen: allow_duplicates must remain false');
    });

    it('guards updatePolicy against setting allow_duplicates=false or non-GLOBAL scope on SHOP_RMR', async () => {
      await expect(
        PaperReferenceService.updatePolicy({
          referenceType: 'SHOP_RMR' as PaperReferenceType,
          policyMode: 'REQUIRED' as PaperPolicyMode,
          allowDuplicates: false,
          duplicateScope: 'GLOBAL',
          updatedByUserId: BigInt(1),
          reason: 'Test invalid unique rmr',
        })
      ).rejects.toThrow('SHOP_RMR duplicate ownership is frozen: allow_duplicates must remain true');

      await expect(
        PaperReferenceService.updatePolicy({
          referenceType: 'SHOP_RMR' as PaperReferenceType,
          policyMode: 'REQUIRED' as PaperPolicyMode,
          allowDuplicates: true,
          duplicateScope: 'PER_SOURCE',
          updatedByUserId: BigInt(1),
          reason: 'Test invalid rmr scope',
        })
      ).rejects.toThrow('SHOP_RMR duplicate scope must remain GLOBAL');
    });
  });
});
