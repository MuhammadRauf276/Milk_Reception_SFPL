import { prisma } from '@core/db';
import { Prisma, LabTestRule } from '@prisma/client';

export type QualityEvaluationStatus =
  | 'PASS'
  | 'OUT_OF_SPEC'
  | 'NO_ACTIVE_RULE'
  | 'NEUTRAL'
  | 'WARNING'
  | 'RULE_CONFIGURATION_ERROR';

export interface QualityResultEvaluation {
  appliedRuleId: bigint | null;
  appliedRuleVersion: number | null;
  evaluationStatus: QualityEvaluationStatus;
  isPassed: boolean | null;
  reason?: string;
}

export interface CreateRuleInput {
  labTestId: bigint | number | string;
  testingPoint: string;
  ruleCategory?: 'RELEASE' | 'MONITORING';
  minValue?: number | string | null;
  maxValue?: number | string | null;
  acceptableOption?: string | null;
  warningTrigger?: string | null;
  decisionConsequence?: string | null;
  effectiveFrom?: Date;
  createdByUserId: bigint | number | string;
}

export class QualityRuleService {
  /**
   * Resolves all active LabTestRules for a given testing point at an authoritative event timestamp.
   * If multiple versions match, selects the highest version.
   */
  static async resolveActiveRulesForTestingPoint(
    testingPoint: string,
    eventTimestamp: Date = new Date(),
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<Map<string, LabTestRule>> {
    const rules = await tx.labTestRule.findMany({
      where: {
        testing_point: testingPoint,
        is_active: true,
        effective_from: { lte: eventTimestamp },
        OR: [
          { effective_to: null },
          { effective_to: { gt: eventTimestamp } },
        ],
      },
      orderBy: { version: 'desc' },
    });

    const ruleMap = new Map<string, LabTestRule>();
    for (const rule of rules) {
      const key = String(rule.lab_test_id);
      if (!ruleMap.has(key)) {
        ruleMap.set(key, rule);
      }
    }
    return ruleMap;
  }

  /**
   * Resolves a single active LabTestRule for a specific test and testing point at an authoritative event timestamp.
   */
  static async resolveActiveRule(
    labTestId: bigint | number | string,
    testingPoint: string,
    eventTimestamp: Date = new Date(),
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<LabTestRule | null> {
    const testIdBigInt = BigInt(String(labTestId));
    const rule = await tx.labTestRule.findFirst({
      where: {
        lab_test_id: testIdBigInt,
        testing_point: testingPoint,
        is_active: true,
        effective_from: { lte: eventTimestamp },
        OR: [
          { effective_to: null },
          { effective_to: { gt: eventTimestamp } },
        ],
      },
      orderBy: { version: 'desc' },
    });
    return rule;
  }

  /**
   * Evaluates an observed test result against an active LabTestRule or result options.
   * Strictly separates observation from system evaluation.
   */
  static evaluateQualityResult(params: {
    testId?: bigint | number | string;
    testCode?: string;
    resultType: string;
    numericValue?: number | Prisma.Decimal | null;
    textValue?: string | null;
    rule?: LabTestRule | null;
    resultOptions?: any;
    testingPoint?: string;
  }): QualityResultEvaluation {
    const { resultType, numericValue, textValue, rule, resultOptions } = params;

    // 1. If NO rule is active
    if (!rule) {
      // Check if structured resultOptions provide pass/fail metadata (e.g. qualitative options)
      if (Array.isArray(resultOptions) && resultOptions.length > 0 && textValue) {
        const rawText = textValue.trim().toUpperCase();
        const matched = resultOptions.find(
          (opt: any) => opt.value && opt.value.trim().toUpperCase() === rawText
        );
        if (matched) {
          if (matched.isPassing === true) {
            return {
              appliedRuleId: null,
              appliedRuleVersion: null,
              evaluationStatus: 'PASS',
              isPassed: true,
            };
          } else if (matched.isPassing === false) {
            return {
              appliedRuleId: null,
              appliedRuleVersion: null,
              evaluationStatus: 'OUT_OF_SPEC',
              isPassed: false,
              reason: 'Configured failing option',
            };
          } else {
            return {
              appliedRuleId: null,
              appliedRuleVersion: null,
              evaluationStatus: 'NEUTRAL',
              isPassed: null,
            };
          }
        }
      }

      // No active rule configured
      return {
        appliedRuleId: null,
        appliedRuleVersion: null,
        evaluationStatus: 'NO_ACTIVE_RULE',
        isPassed: null,
        reason: 'No active laboratory rule configured for testing point',
      };
    }

    const appliedRuleId = rule.id;
    const appliedRuleVersion = rule.version;
    const isMonitoring = rule.rule_category === 'MONITORING';

    // 2. Validate Rule Configuration
    if (
      rule.min_value !== null &&
      rule.max_value !== null &&
      Number(rule.min_value) > Number(rule.max_value)
    ) {
      return {
        appliedRuleId,
        appliedRuleVersion,
        evaluationStatus: 'RULE_CONFIGURATION_ERROR',
        isPassed: false,
        reason: `Invalid rule configuration: min_value (${rule.min_value}) > max_value (${rule.max_value})`,
      };
    }

    // 3. Quantitative / Numeric Evaluation
    if (resultType === 'NUMERIC' || resultType === 'CALCULATED') {
      if (numericValue === null || numericValue === undefined) {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'OUT_OF_SPEC',
          isPassed: false,
          reason: 'Missing numeric value for quantitative test',
        };
      }

      const numVal = Number(numericValue);
      if (Number.isNaN(numVal)) {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'OUT_OF_SPEC',
          isPassed: false,
          reason: `Invalid numeric value: ${numericValue}`,
        };
      }

      const minPass = rule.min_value === null || numVal >= Number(rule.min_value);
      const maxPass = rule.max_value === null || numVal <= Number(rule.max_value);

      if (minPass && maxPass) {
        if (isMonitoring || rule.decision_consequence === 'NEUTRAL') {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'NEUTRAL',
            isPassed: null,
          };
        }
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'PASS',
          isPassed: true,
        };
      } else {
        if (isMonitoring) {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'WARNING',
            isPassed: null,
            reason: `Monitoring threshold exceeded: observed ${numVal}, bounds [${rule.min_value ?? '-∞'}, ${rule.max_value ?? '+∞'}]`,
          };
        } else {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'OUT_OF_SPEC',
            isPassed: false,
            reason: `Out of specification: observed ${numVal}, allowable range [${rule.min_value ?? '-∞'}, ${rule.max_value ?? '+∞'}]`,
          };
        }
      }
    }

    // 4. Qualitative / Categorical Evaluation
    const rawText = (textValue || '').trim().toUpperCase();

    if (rule.acceptable_option) {
      const acceptable = rule.acceptable_option.trim().toUpperCase();
      if (rawText === acceptable) {
        if (isMonitoring || rule.decision_consequence === 'NEUTRAL') {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'NEUTRAL',
            isPassed: null,
          };
        }
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'PASS',
          isPassed: true,
        };
      } else {
        if (isMonitoring) {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'WARNING',
            isPassed: null,
            reason: `Monitoring option mismatch: observed "${textValue}", expected "${rule.acceptable_option}"`,
          };
        } else {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'OUT_OF_SPEC',
            isPassed: false,
            reason: `Out of specification: observed "${textValue}", acceptable option is "${rule.acceptable_option}"`,
          };
        }
      }
    }

    // Structured resultOptions fallback
    if (Array.isArray(resultOptions) && resultOptions.length > 0) {
      const matched = resultOptions.find(
        (opt: any) => opt.value && opt.value.trim().toUpperCase() === rawText
      );
      if (matched) {
        if (matched.isPassing === true) {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'PASS',
            isPassed: true,
          };
        } else if (matched.isPassing === false) {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: isMonitoring ? 'WARNING' : 'OUT_OF_SPEC',
            isPassed: isMonitoring ? null : false,
            reason: 'Configured failing option',
          };
        } else {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'NEUTRAL',
            isPassed: null,
          };
        }
      }
    }

    // Default legacy qualitative heuristics
    if (['OK', 'PASS', 'NEGATIVE', 'TRUE', 'YES', 'NORMAL'].includes(rawText)) {
      return {
        appliedRuleId,
        appliedRuleVersion,
        evaluationStatus: 'PASS',
        isPassed: true,
      };
    }

    if (['NOT_OK', 'FAIL', 'POSITIVE', 'FALSE', 'NO', 'ABNORMAL'].includes(rawText)) {
      return {
        appliedRuleId,
        appliedRuleVersion,
        evaluationStatus: isMonitoring ? 'WARNING' : 'OUT_OF_SPEC',
        isPassed: isMonitoring ? null : false,
        reason: `Failing qualitative observation: "${textValue}"`,
      };
    }

    return {
      appliedRuleId,
      appliedRuleVersion,
      evaluationStatus: 'NEUTRAL',
      isPassed: null,
    };
  }

  /**
   * Aggregates individual lab test evaluation results into an authoritative system outcome.
   * Strictly preserves non-success truth precedence:
   * RULE_CONFIGURATION_ERROR > OUT_OF_SPEC > NO_ACTIVE_RULE > NEUTRAL > PASS
   * Never coerces NO_ACTIVE_RULE or NEUTRAL to PASS.
   */
  static aggregateSystemQualityOutcome(
    results: Array<{
      evaluationStatus: string | null | undefined;
      performanceStatus?: string | null;
      isRequired?: boolean;
    }>
  ): QualityEvaluationStatus {
    const performed = results.filter(
      (r) => r.performanceStatus !== 'NOT_PERFORMED' && r.performanceStatus !== 'SKIPPED'
    );

    if (performed.length === 0) {
      return 'NO_ACTIVE_RULE';
    }

    // 1. Configuration Error blocks completion
    if (performed.some((r) => r.evaluationStatus === 'RULE_CONFIGURATION_ERROR')) {
      return 'RULE_CONFIGURATION_ERROR';
    }

    // 2. Any OUT_OF_SPEC dominates
    if (performed.some((r) => r.evaluationStatus === 'OUT_OF_SPEC')) {
      return 'OUT_OF_SPEC';
    }

    // 3. Any missing active rule cannot be called PASS
    if (performed.some((r) => r.evaluationStatus === 'NO_ACTIVE_RULE' || !r.evaluationStatus)) {
      return 'NO_ACTIVE_RULE';
    }

    // 4. Monitoring warnings or neutral tests yield NEUTRAL
    if (
      performed.some(
        (r) => r.evaluationStatus === 'WARNING' || r.evaluationStatus === 'NEUTRAL'
      )
    ) {
      return 'NEUTRAL';
    }

    // 5. All tests evaluated against active release rules and passed
    if (performed.every((r) => r.evaluationStatus === 'PASS')) {
      return 'PASS';
    }

    return 'NO_ACTIVE_RULE';
  }

  /**
   * Concurrency-safe rule creation and supersession by QA Head.
   * Closes prior active rule for the same testing point and increments version.
   * Enforces that RELEASE rules are strictly forbidden on MOT_SHOP and DISPATCH.
   */
  static async createOrSupersedeRule(
    input: CreateRuleInput,
    txOrPrisma: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<LabTestRule> {
    const {
      labTestId,
      testingPoint,
      ruleCategory = 'RELEASE',
      minValue,
      maxValue,
      acceptableOption,
      warningTrigger,
      decisionConsequence,
      effectiveFrom = new Date(),
      createdByUserId,
    } = input;

    // Scope validation: RELEASE enforcement forbidden on MOT_SHOP & DISPATCH
    if (ruleCategory === 'RELEASE' && ['MOT_SHOP', 'DISPATCH'].includes(testingPoint)) {
      throw new Error(
        `RELEASE rules are not supported for ${testingPoint}; only MONITORING rules are allowed.`
      );
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      const testIdBigInt = BigInt(String(labTestId));
      const userIdBigInt = BigInt(String(createdByUserId));

      // 1. Check if lab test exists
      const test = await tx.labTest.findUnique({
        where: { id: testIdBigInt },
      });
      if (!test) {
        throw new Error(`LabTest with id ${labTestId} not found.`);
      }

      // 2. Find existing active rule
      const existingActive = await tx.labTestRule.findFirst({
        where: {
          lab_test_id: testIdBigInt,
          testing_point: testingPoint,
          rule_category: ruleCategory,
          is_active: true,
        },
        orderBy: { version: 'desc' },
      });

      let nextVersion = 1;
      if (existingActive) {
        nextVersion = existingActive.version + 1;
        // Close previous active rule
        await tx.labTestRule.update({
          where: { id: existingActive.id },
          data: {
            is_active: false,
            effective_to: effectiveFrom,
          },
        });
      }

      // 3. Create new rule
      const newRule = await tx.labTestRule.create({
        data: {
          lab_test_id: testIdBigInt,
          testing_point: testingPoint,
          version: nextVersion,
          rule_category: ruleCategory,
          effective_from: effectiveFrom,
          effective_to: null,
          min_value:
            minValue !== null && minValue !== undefined && minValue !== ''
              ? new Prisma.Decimal(String(minValue))
              : null,
          max_value:
            maxValue !== null && maxValue !== undefined && maxValue !== ''
              ? new Prisma.Decimal(String(maxValue))
              : null,
          acceptable_option: acceptableOption || null,
          warning_trigger: warningTrigger || null,
          decision_consequence: decisionConsequence || null,
          is_active: true,
          created_by: userIdBigInt,
        },
      });

      // 4. Record Audit Log
      await tx.auditLog.create({
        data: {
          table_name: 'lab_test_rule',
          record_id: newRule.id,
          action: existingActive ? 'SOP_LAB_RULE_SUPERSEDED' : 'SOP_LAB_RULE_CREATED',
          old_values: existingActive
            ? {
                old_rule_id: String(existingActive.id),
                old_version: existingActive.version,
              }
            : undefined,
          new_values: {
            test_id: String(testIdBigInt),
            test_code: test.testCode,
            testing_point: testingPoint,
            rule_category: ruleCategory,
            version: nextVersion,
            min_value: minValue !== undefined ? String(minValue) : null,
            max_value: maxValue !== undefined ? String(maxValue) : null,
            acceptable_option: acceptableOption || null,
          },
          user_id: userIdBigInt,
        },
      });

      return newRule;
    };

    if ('$transaction' in txOrPrisma) {
      return (txOrPrisma as typeof prisma).$transaction(execute);
    } else {
      return execute(txOrPrisma as Prisma.TransactionClient);
    }
  }
}
