import { describe, it, expect } from 'vitest';
import { QualityRuleService, QualityResultEvaluation } from '@/backend/services/qualityRuleService';
import { LabTestRule, Prisma } from '@prisma/client';

describe('QualityRuleService (Unit Tests)', () => {
  const dummyRule = (overrides: Partial<LabTestRule>): LabTestRule => ({
    id: BigInt(101),
    lab_test_id: BigInt(1),
    testing_point: 'PLANT_QA',
    version: 1,
    rule_category: 'RELEASE',
    effective_from: new Date('2026-01-01'),
    effective_to: null,
    min_value: new Prisma.Decimal('3.50'),
    max_value: new Prisma.Decimal('5.50'),
    acceptable_option: null,
    warning_trigger: null,
    decision_consequence: 'REJECT',
    is_active: true,
    created_by: BigInt(1),
    created_at: new Date('2026-01-01'),
    ...overrides,
  });

  describe('evaluateQualityResult: Numeric Quantitative Evaluation', () => {
    it('evaluates PASS when numeric value is strictly within [min, max]', () => {
      const rule = dummyRule({ min_value: new Prisma.Decimal('3.50'), max_value: new Prisma.Decimal('5.50') });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 4.20,
        rule,
      });

      expect(evalRes.evaluationStatus).toBe('PASS');
      expect(evalRes.isPassed).toBe(true);
      expect(evalRes.appliedRuleId).toBe(BigInt(101));
    });

    it('evaluates OUT_OF_SPEC when numeric value is below min_value', () => {
      const rule = dummyRule({ min_value: new Prisma.Decimal('3.50'), max_value: new Prisma.Decimal('5.50') });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 3.40,
        rule,
      });

      expect(evalRes.evaluationStatus).toBe('OUT_OF_SPEC');
      expect(evalRes.isPassed).toBe(false);
      expect(evalRes.appliedRuleId).toBe(BigInt(101));
    });

    it('evaluates OUT_OF_SPEC when numeric value is above max_value', () => {
      const rule = dummyRule({ min_value: new Prisma.Decimal('3.50'), max_value: new Prisma.Decimal('5.50') });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 6.00,
        rule,
      });

      expect(evalRes.evaluationStatus).toBe('OUT_OF_SPEC');
      expect(evalRes.isPassed).toBe(false);
    });

    it('evaluates RULE_CONFIGURATION_ERROR when min_value > max_value', () => {
      const invalidRule = dummyRule({
        min_value: new Prisma.Decimal('10.00'),
        max_value: new Prisma.Decimal('5.00'),
      });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 7.00,
        rule: invalidRule,
      });

      expect(evalRes.evaluationStatus).toBe('RULE_CONFIGURATION_ERROR');
      expect(evalRes.isPassed).toBe(false);
      expect(evalRes.reason).toContain('min_value (10) > max_value (5)');
    });

    it('evaluates NEUTRAL when rule_category is MONITORING and value is within bounds', () => {
      const monitoringRule = dummyRule({
        rule_category: 'MONITORING',
        min_value: new Prisma.Decimal('39.00'),
        max_value: new Prisma.Decimal('42.00'),
        decision_consequence: 'NEUTRAL',
      });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 40.50,
        rule: monitoringRule,
      });

      expect(evalRes.evaluationStatus).toBe('NEUTRAL');
      expect(evalRes.isPassed).toBeNull();
    });

    it('evaluates WARNING when rule_category is MONITORING and value exceeds bounds', () => {
      const monitoringRule = dummyRule({
        rule_category: 'MONITORING',
        min_value: new Prisma.Decimal('39.00'),
        max_value: new Prisma.Decimal('42.00'),
      });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 45.00,
        rule: monitoringRule,
      });

      expect(evalRes.evaluationStatus).toBe('WARNING');
      expect(evalRes.isPassed).toBeNull();
      expect(evalRes.reason).toContain('Monitoring threshold exceeded');
    });

    it('evaluates NO_ACTIVE_RULE when rule is null and no resultOptions present', () => {
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 12.0,
        rule: null,
      });

      expect(evalRes.evaluationStatus).toBe('NO_ACTIVE_RULE');
      expect(evalRes.isPassed).toBeNull();
      expect(evalRes.appliedRuleId).toBeNull();
    });
  });

  describe('evaluateQualityResult: Qualitative Text Evaluation', () => {
    it('evaluates PASS when text matches acceptable_option', () => {
      const rule = dummyRule({
        acceptable_option: 'NEGATIVE',
        min_value: null,
        max_value: null,
      });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'POSITIVE_NEGATIVE',
        textValue: 'NEGATIVE',
        rule,
      });

      expect(evalRes.evaluationStatus).toBe('PASS');
      expect(evalRes.isPassed).toBe(true);
    });

    it('evaluates OUT_OF_SPEC when text violates acceptable_option', () => {
      const rule = dummyRule({
        acceptable_option: 'NEGATIVE',
        min_value: null,
        max_value: null,
      });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'POSITIVE_NEGATIVE',
        textValue: 'POSITIVE',
        rule,
      });

      expect(evalRes.evaluationStatus).toBe('OUT_OF_SPEC');
      expect(evalRes.isPassed).toBe(false);
    });

    it('evaluates WARNING when text violates acceptable_option under MONITORING rule', () => {
      const rule = dummyRule({
        rule_category: 'MONITORING',
        acceptable_option: 'OK',
        min_value: null,
        max_value: null,
      });
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'OK_NOT_OK',
        textValue: 'NOT_OK',
        rule,
      });

      expect(evalRes.evaluationStatus).toBe('WARNING');
      expect(evalRes.isPassed).toBeNull();
    });
  });

  describe('aggregateSystemQualityOutcome: Non-Coercing Precedence Truth', () => {
    it('ranks RULE_CONFIGURATION_ERROR as highest precedence over all other outcomes', () => {
      const evaluations: QualityResultEvaluation[] = [
        { appliedRuleId: BigInt(1), appliedRuleVersion: 1, evaluationStatus: 'RULE_CONFIGURATION_ERROR', isPassed: false },
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'OUT_OF_SPEC', isPassed: false },
        { appliedRuleId: null, appliedRuleVersion: null, evaluationStatus: 'NO_ACTIVE_RULE', isPassed: null },
        { appliedRuleId: BigInt(3), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('RULE_CONFIGURATION_ERROR');
    });

    it('ranks OUT_OF_SPEC above NO_ACTIVE_RULE, NEUTRAL, and PASS', () => {
      const evaluations: QualityResultEvaluation[] = [
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'OUT_OF_SPEC', isPassed: false },
        { appliedRuleId: null, appliedRuleVersion: null, evaluationStatus: 'NO_ACTIVE_RULE', isPassed: null },
        { appliedRuleId: BigInt(3), appliedRuleVersion: 1, evaluationStatus: 'NEUTRAL', isPassed: null },
        { appliedRuleId: BigInt(4), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('OUT_OF_SPEC');
    });

    it('NEVER coerces NO_ACTIVE_RULE to PASS (preserves NO_ACTIVE_RULE truth over PASS)', () => {
      const evaluations: QualityResultEvaluation[] = [
        { appliedRuleId: BigInt(1), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
        { appliedRuleId: null, appliedRuleVersion: null, evaluationStatus: 'NO_ACTIVE_RULE', isPassed: null },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('NO_ACTIVE_RULE');
      expect(outcome).not.toBe('PASS');
    });

    it('NEVER coerces NEUTRAL or WARNING to PASS (preserves NEUTRAL truth over PASS)', () => {
      const evaluations: QualityResultEvaluation[] = [
        { appliedRuleId: BigInt(1), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'NEUTRAL', isPassed: null },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('NEUTRAL');
      expect(outcome).not.toBe('PASS');
    });

    it('evaluates PASS only when 100% of performed evaluations are strictly PASS', () => {
      const evaluations: QualityResultEvaluation[] = [
        { appliedRuleId: BigInt(1), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
        { appliedRuleId: BigInt(3), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('PASS');
    });

    it('does NOT block completion when an optional test has OUT_OF_SPEC or error', () => {
      const evaluations: Array<QualityResultEvaluation & { isRequired?: boolean }> = [
        { appliedRuleId: BigInt(1), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true, isRequired: true },
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'OUT_OF_SPEC', isPassed: false, isRequired: false },
        { appliedRuleId: BigInt(3), appliedRuleVersion: 1, evaluationStatus: 'RULE_CONFIGURATION_ERROR', isPassed: false, isRequired: false },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('PASS');
    });

    it('blocks completion when a required test has OUT_OF_SPEC even if optional tests pass', () => {
      const evaluations: Array<QualityResultEvaluation & { isRequired?: boolean }> = [
        { appliedRuleId: BigInt(1), appliedRuleVersion: 1, evaluationStatus: 'OUT_OF_SPEC', isPassed: false, isRequired: true },
        { appliedRuleId: BigInt(2), appliedRuleVersion: 1, evaluationStatus: 'PASS', isPassed: true, isRequired: false },
      ];

      const outcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);
      expect(outcome).toBe('OUT_OF_SPEC');
    });
  });

  describe('RELEASE and MONITORING Coexistence & Governance (Directive 1, 3, 15)', () => {
    it('evaluates RULE_CONFIGURATION_ERROR when rule has overlapping configuration error', () => {
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 4.20,
        isConfigurationError: true,
        configurationErrorReason: 'Multiple overlapping active RELEASE rules',
      });

      expect(evalRes.evaluationStatus).toBe('RULE_CONFIGURATION_ERROR');
      expect(evalRes.isPassed).toBe(false);
      expect(evalRes.reason).toContain('overlapping');
    });

    it('evaluates PASS when value satisfies both coexisting RELEASE and MONITORING rules', () => {
      const releaseRule = dummyRule({
        rule_category: 'RELEASE',
        min_value: new Prisma.Decimal('3.50'),
        max_value: new Prisma.Decimal('5.50'),
      });
      const monitoringRule = dummyRule({
        id: BigInt(102),
        rule_category: 'MONITORING',
        min_value: new Prisma.Decimal('4.00'),
        max_value: new Prisma.Decimal('5.00'),
      });

      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 4.50,
        rule: releaseRule,
        monitoringRule,
      });

      expect(evalRes.evaluationStatus).toBe('PASS');
      expect(evalRes.isPassed).toBe(true);
      expect(evalRes.appliedRuleId).toBe(BigInt(101));
    });

    it('evaluates WARNING when value passes RELEASE but breaches coexisting MONITORING threshold', () => {
      const releaseRule = dummyRule({
        rule_category: 'RELEASE',
        min_value: new Prisma.Decimal('3.50'),
        max_value: new Prisma.Decimal('5.50'),
      });
      const monitoringRule = dummyRule({
        id: BigInt(102),
        rule_category: 'MONITORING',
        min_value: new Prisma.Decimal('4.00'),
        max_value: new Prisma.Decimal('5.00'),
      });

      // 3.80 is within [3.50, 5.50] (passes release), but below [4.00, 5.00] (breaches monitoring)
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 3.80,
        rule: releaseRule,
        monitoringRule,
      });

      expect(evalRes.evaluationStatus).toBe('WARNING');
      expect(evalRes.isPassed).toBeNull(); // MONITORING warnings never reject
      expect(evalRes.reason).toContain('Monitoring threshold exceeded');
    });

    it('evaluates OUT_OF_SPEC when value breaches RELEASE rule regardless of MONITORING rule', () => {
      const releaseRule = dummyRule({
        rule_category: 'RELEASE',
        min_value: new Prisma.Decimal('3.50'),
        max_value: new Prisma.Decimal('5.50'),
      });
      const monitoringRule = dummyRule({
        id: BigInt(102),
        rule_category: 'MONITORING',
        min_value: new Prisma.Decimal('3.00'),
        max_value: new Prisma.Decimal('6.00'),
      });

      // 3.20 breaches release (< 3.50)
      const evalRes = QualityRuleService.evaluateQualityResult({
        resultType: 'NUMERIC',
        numericValue: 3.20,
        rule: releaseRule,
        monitoringRule,
      });

      expect(evalRes.evaluationStatus).toBe('OUT_OF_SPEC');
      expect(evalRes.isPassed).toBe(false);
    });

    it('enforces that QA Head rule creation requires a substantive reason (>= 3 chars)', async () => {
      await expect(
        QualityRuleService.createOrSupersedeRule({
          labTestId: BigInt(1),
          testingPoint: 'PLANT_QA',
          ruleCategory: 'RELEASE',
          minValue: 3.5,
          maxValue: 5.5,
          createdByUserId: BigInt(1),
          reason: '',
        })
      ).rejects.toThrow('A substantive reason');

      await expect(
        QualityRuleService.createOrSupersedeRule({
          labTestId: BigInt(1),
          testingPoint: 'PLANT_QA',
          ruleCategory: 'RELEASE',
          minValue: 3.5,
          maxValue: 5.5,
          createdByUserId: BigInt(1),
          reason: '  ',
        })
      ).rejects.toThrow('A substantive reason');
    });

    it('strictly blocks new active rules for deprecated ZMCC_LAB_CONTRACTOR', async () => {
      await expect(
        QualityRuleService.createOrSupersedeRule({
          labTestId: BigInt(1),
          testingPoint: 'ZMCC_LAB_CONTRACTOR',
          ruleCategory: 'RELEASE',
          minValue: 3.5,
          maxValue: 5.5,
          createdByUserId: BigInt(1),
          reason: 'Attempting to configure deprecated contractor rule',
        })
      ).rejects.toThrow("Testing point 'ZMCC_LAB_CONTRACTOR' is deprecated");
    });
  });
});
