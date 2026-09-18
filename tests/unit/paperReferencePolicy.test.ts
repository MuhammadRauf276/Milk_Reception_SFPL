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
});
