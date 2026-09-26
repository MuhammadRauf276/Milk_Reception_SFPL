import { prisma } from '@core/db';
import { Prisma, LabTestRule } from '@prisma/client';

export type QualityEvaluationStatus =
  | 'PASS'
  | 'OUT_OF_SPEC'
  | 'NO_ACTIVE_RULE'
  | 'NEUTRAL'
  | 'WARNING'
  | 'RULE_CONFIGURATION_ERROR';

export interface QualityEvaluationSnapshot {
  observedValue: {
    numericValue: number | null;
    textValue: string | null;
  };
  evaluationStatus: QualityEvaluationStatus;
  isPassed: boolean | null;
  reason?: string;
  testingPoint?: string | null;
  evaluatedAt: string;
  releaseRule?: {
    id: string;
    version: number;
    category: string;
    minValue: number | null;
    maxValue: number | null;
    acceptableOption: string | null;
    evaluationStatus: QualityEvaluationStatus;
  } | null;
  monitoringRule?: {
    id: string;
    version: number;
    category: string;
    minValue: number | null;
    maxValue: number | null;
    acceptableOption: string | null;
    evaluationStatus: QualityEvaluationStatus;
  } | null;
}

export interface QualityResultEvaluation {
  appliedRuleId: bigint | null;
  appliedRuleVersion: number | null;
  evaluationStatus: QualityEvaluationStatus;
  isPassed: boolean | null;
  reason?: string;
  evaluationSnapshot?: QualityEvaluationSnapshot | null;
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
  reason: string;
}

export type ResolvedRuleWithGovernance = LabTestRule & {
  isConfigurationError?: boolean;
  configurationErrorReason?: string;
  monitoringRule?: LabTestRule | null;
};

export class QualityRuleService {
  /**
   * Resolves active LabTestRules for a given testing point at an authoritative event timestamp.
   * Resolves RELEASE & MONITORING rules independently.
   * Enforces overlap and category truth:
   * - 0 RELEASE -> NO_ACTIVE_RULE (if only monitoring or no rules configured)
   * - 1 RELEASE -> use it
   * - >1 overlapping effective RELEASE -> flag RULE_CONFIGURATION_ERROR
   * - MONITORING rules never hide or replace RELEASE rules
   */
  static async resolveActiveRulesForTestingPoint(
    testingPoint: string,
    eventTimestamp: Date = new Date(),
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<Map<string, ResolvedRuleWithGovernance>> {
    const rules = await tx.labTestRule.findMany({
      where: {
        testing_point: testingPoint,
        effective_from: { lte: eventTimestamp },
        OR: [
          { effective_to: null, is_active: true },
          { effective_to: { gt: eventTimestamp } },
        ],
      },
      orderBy: { version: 'desc' },
    });

    const grouped = new Map<string, LabTestRule[]>();
    for (const rule of rules) {
      const key = String(rule.lab_test_id);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(rule);
    }

    const ruleMap = new Map<string, ResolvedRuleWithGovernance>();
    grouped.forEach((testRules, key) => {
      const releaseRules = testRules.filter((r) => r.rule_category === 'RELEASE');
      const monitoringRules = testRules.filter((r) => r.rule_category === 'MONITORING');
      const activeMonitoring = monitoringRules.length > 0 ? monitoringRules[0] : null;

      if (releaseRules.length > 1) {
        ruleMap.set(key, {
          ...releaseRules[0],
          isConfigurationError: true,
          configurationErrorReason: `Multiple overlapping active RELEASE rules (${releaseRules.length}) found for testing point ${testingPoint}`,
          monitoringRule: activeMonitoring,
        });
      } else if (releaseRules.length === 1) {
        ruleMap.set(key, {
          ...releaseRules[0],
          isConfigurationError: false,
          monitoringRule: activeMonitoring,
        });
      } else {
        // 0 RELEASE rules: MONITORING rules never hide/replace RELEASE rules
        if (activeMonitoring) {
          ruleMap.set(key, {
            ...activeMonitoring,
            isConfigurationError: false,
            monitoringRule: activeMonitoring,
          });
        }
      }
    });

    if (testingPoint === 'ZMCC_LAB_LOCAL_SUPPLIER') {
      const contractorRules = await this.resolveActiveRulesForTestingPoint('ZMCC_LAB_CONTRACTOR', eventTimestamp, tx);
      contractorRules.forEach((rule, k) => {
        if (!ruleMap.has(k)) {
          ruleMap.set(k, rule);
        }
      });
    }

    if (testingPoint === 'MOT_SHOP') {
      const motLabRules = await this.resolveActiveRulesForTestingPoint('ZMCC_LAB_MOT', eventTimestamp, tx);
      motLabRules.forEach((rule, k) => {
        if (!ruleMap.has(k)) {
          ruleMap.set(k, rule);
        }
      });
    }

    return ruleMap;
  }

  /**
   * Resolves active LabTestRule(s) for a specific test and testing point at an authoritative event timestamp.
   * Resolves RELEASE & MONITORING independently.
   */
  static async resolveActiveRule(
    labTestId: bigint | number | string,
    testingPoint: string,
    eventTimestamp: Date = new Date(),
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<ResolvedRuleWithGovernance | null> {
    const testIdBigInt = BigInt(String(labTestId));
    const rules = await tx.labTestRule.findMany({
      where: {
        lab_test_id: testIdBigInt,
        testing_point: testingPoint,
        effective_from: { lte: eventTimestamp },
        OR: [
          { effective_to: null, is_active: true },
          { effective_to: { gt: eventTimestamp } },
        ],
      },
      orderBy: { version: 'desc' },
    });

    const releaseRules = rules.filter((r) => r.rule_category === 'RELEASE');
    const monitoringRules = rules.filter((r) => r.rule_category === 'MONITORING');
    const activeMonitoring = monitoringRules.length > 0 ? monitoringRules[0] : null;

    if (releaseRules.length > 1) {
      return {
        ...releaseRules[0],
        isConfigurationError: true,
        configurationErrorReason: `Multiple overlapping active RELEASE rules (${releaseRules.length}) found for testing point ${testingPoint}`,
        monitoringRule: activeMonitoring,
      };
    }

    if (releaseRules.length === 1) {
      return {
        ...releaseRules[0],
        isConfigurationError: false,
        monitoringRule: activeMonitoring,
      };
    }

    // 0 RELEASE rules
    if (activeMonitoring) {
      return {
        ...activeMonitoring,
        isConfigurationError: false,
        monitoringRule: activeMonitoring,
      };
    }

    if (testingPoint === 'ZMCC_LAB_LOCAL_SUPPLIER') {
      return this.resolveActiveRule(labTestId, 'ZMCC_LAB_CONTRACTOR', eventTimestamp, tx);
    }

    return null;
  }

  private static buildEvaluationSnapshot(
  params: {
    resultType: string;
    numericValue?: number | Prisma.Decimal | null;
    textValue?: string | null;
    testingPoint?: string;
  },
  status: QualityEvaluationStatus,
  isPassed: boolean | null,
  reason?: string,
  releaseRule?: LabTestRule | null,
  releaseStatus?: QualityEvaluationStatus | null,
  monitoringRule?: LabTestRule | null,
  monitoringStatus?: QualityEvaluationStatus | null
): QualityEvaluationSnapshot {
  return {
    observedValue: {
      numericValue:
        params.numericValue !== null && params.numericValue !== undefined
          ? Number(params.numericValue)
          : null,
      textValue: params.textValue !== undefined && params.textValue !== null ? params.textValue : null,
    },
    evaluationStatus: status,
    isPassed,
    reason,
    testingPoint: params.testingPoint || null,
    evaluatedAt: new Date().toISOString(),
    releaseRule: releaseRule
      ? {
          id: releaseRule.id.toString(),
          version: releaseRule.version,
          category: releaseRule.rule_category,
          minValue: releaseRule.min_value !== null ? Number(releaseRule.min_value) : null,
          maxValue: releaseRule.max_value !== null ? Number(releaseRule.max_value) : null,
          acceptableOption: releaseRule.acceptable_option,
          evaluationStatus: releaseStatus || status,
        }
      : null,
    monitoringRule: monitoringRule
      ? {
          id: monitoringRule.id.toString(),
          version: monitoringRule.version,
          category: monitoringRule.rule_category,
          minValue: monitoringRule.min_value !== null ? Number(monitoringRule.min_value) : null,
          maxValue: monitoringRule.max_value !== null ? Number(monitoringRule.max_value) : null,
          acceptableOption: monitoringRule.acceptable_option,
          evaluationStatus: monitoringStatus || (status === 'WARNING' ? 'WARNING' : 'PASS'),
        }
      : null,
  };
}

  /**
   * Evaluates an observed test result against active LabTestRule(s) or result options.
   * Strictly separates observation from system evaluation.
   * Enforces that RELEASE and MONITORING rules coexist:
   * - RELEASE rule determines PASS vs OUT_OF_SPEC
   * - MONITORING rules never hide or replace RELEASE rules
   * - MONITORING breaches yield WARNING, never rejecting
   */
  static evaluateQualityResult(params: {
    testId?: bigint | number | string;
    testCode?: string;
    resultType: string;
    numericValue?: number | Prisma.Decimal | null;
    textValue?: string | null;
    rule?: (LabTestRule & { isConfigurationError?: boolean; configurationErrorReason?: string; monitoringRule?: LabTestRule | null }) | null;
    releaseRule?: LabTestRule | null;
    monitoringRule?: LabTestRule | null;
    isConfigurationError?: boolean;
    configurationErrorReason?: string;
    resultOptions?: any;
    testingPoint?: string;
  }): QualityResultEvaluation {
    const raw = this._evaluateRawQualityResult(params);
    const effectiveReleaseRule: LabTestRule | null =
      params.releaseRule || (params.rule && params.rule.rule_category === 'RELEASE' ? params.rule : null);
    const effectiveMonitoringRule: LabTestRule | null =
      params.monitoringRule ||
      (params.rule && params.rule.rule_category === 'MONITORING' ? params.rule : ((params.rule as any)?.monitoringRule || null));

    raw.evaluationSnapshot = this.buildEvaluationSnapshot(
      params,
      raw.evaluationStatus,
      raw.isPassed,
      raw.reason,
      effectiveReleaseRule,
      (raw as any).releaseStatus || (effectiveReleaseRule ? raw.evaluationStatus : null),
      effectiveMonitoringRule,
      (raw as any).monitoringStatus || (raw.evaluationStatus === 'WARNING' ? 'WARNING' : null)
    );
    return raw;
  }

  private static _evaluateRawQualityResult(params: {
    testId?: bigint | number | string;
    testCode?: string;
    resultType: string;
    numericValue?: number | Prisma.Decimal | null;
    textValue?: string | null;
    rule?: (LabTestRule & { isConfigurationError?: boolean; configurationErrorReason?: string; monitoringRule?: LabTestRule | null }) | null;
    releaseRule?: LabTestRule | null;
    monitoringRule?: LabTestRule | null;
    isConfigurationError?: boolean;
    configurationErrorReason?: string;
    resultOptions?: any;
    testingPoint?: string;
  }): QualityResultEvaluation & { releaseStatus?: QualityEvaluationStatus; monitoringStatus?: QualityEvaluationStatus } {
    const { resultType, numericValue, textValue, rule, resultOptions } = params;

    // 1. Configuration Error Check
    if (params.isConfigurationError || (rule as any)?.isConfigurationError) {
      return {
        appliedRuleId: rule?.id || null,
        appliedRuleVersion: rule?.version || null,
        evaluationStatus: 'RULE_CONFIGURATION_ERROR',
        isPassed: false,
        reason: (rule as any)?.configurationErrorReason || params.configurationErrorReason || 'Rule configuration error: overlapping active release rules',
      };
    }

    const effectiveReleaseRule: LabTestRule | null =
      params.releaseRule || (rule && rule.rule_category === 'RELEASE' ? rule : null);

    const effectiveMonitoringRule: LabTestRule | null =
      params.monitoringRule ||
      (rule && rule.rule_category === 'MONITORING' ? rule : ((rule as any)?.monitoringRule || null));

    // Validate Rule Configuration bounds min_value <= max_value
    if (
      effectiveReleaseRule &&
      effectiveReleaseRule.min_value !== null &&
      effectiveReleaseRule.max_value !== null &&
      Number(effectiveReleaseRule.min_value) > Number(effectiveReleaseRule.max_value)
    ) {
      return {
        appliedRuleId: effectiveReleaseRule.id,
        appliedRuleVersion: effectiveReleaseRule.version,
        evaluationStatus: 'RULE_CONFIGURATION_ERROR',
        isPassed: false,
        reason: `Invalid rule configuration: min_value (${effectiveReleaseRule.min_value}) > max_value (${effectiveReleaseRule.max_value})`,
      };
    }

    if (
      effectiveMonitoringRule &&
      effectiveMonitoringRule.min_value !== null &&
      effectiveMonitoringRule.max_value !== null &&
      Number(effectiveMonitoringRule.min_value) > Number(effectiveMonitoringRule.max_value)
    ) {
      return {
        appliedRuleId: effectiveMonitoringRule.id,
        appliedRuleVersion: effectiveMonitoringRule.version,
        evaluationStatus: 'RULE_CONFIGURATION_ERROR',
        isPassed: false,
        reason: `Invalid monitoring rule configuration: min_value (${effectiveMonitoringRule.min_value}) > max_value (${effectiveMonitoringRule.max_value})`,
      };
    }

    // 2. If NO rules are active
    if (!effectiveReleaseRule && !effectiveMonitoringRule) {
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

      return {
        appliedRuleId: null,
        appliedRuleVersion: null,
        evaluationStatus: 'NO_ACTIVE_RULE',
        isPassed: null,
        reason: 'No active laboratory rule configured for testing point',
      };
    }

    // 3. Evaluation when RELEASE rule is present (with optional coexisting MONITORING rule)
    if (effectiveReleaseRule) {
      const appliedRuleId = effectiveReleaseRule.id;
      const appliedRuleVersion = effectiveReleaseRule.version;

      // Quantitative
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

        const minPass = effectiveReleaseRule.min_value === null || numVal >= Number(effectiveReleaseRule.min_value);
        const maxPass = effectiveReleaseRule.max_value === null || numVal <= Number(effectiveReleaseRule.max_value);

        if (!minPass || !maxPass) {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'OUT_OF_SPEC',
            isPassed: false,
            reason: `Out of specification: observed ${numVal}, allowable range [${effectiveReleaseRule.min_value ?? '-∞'}, ${effectiveReleaseRule.max_value ?? '+∞'}]`,
          };
        }

        // Passes release rule. Now check coexisting monitoring rule if present
        if (effectiveMonitoringRule) {
          const monMinPass = effectiveMonitoringRule.min_value === null || numVal >= Number(effectiveMonitoringRule.min_value);
          const monMaxPass = effectiveMonitoringRule.max_value === null || numVal <= Number(effectiveMonitoringRule.max_value);
          if (!monMinPass || !monMaxPass) {
            return {
              appliedRuleId,
              appliedRuleVersion,
              evaluationStatus: 'WARNING',
              isPassed: null,
              reason: `Monitoring threshold exceeded: observed ${numVal}, bounds [${effectiveMonitoringRule.min_value ?? '-∞'}, ${effectiveMonitoringRule.max_value ?? '+∞'}]`,
            };
          }
        }

        if (effectiveReleaseRule.decision_consequence === 'NEUTRAL') {
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
      }

      // Qualitative
      const rawText = (textValue || '').trim().toUpperCase();

      if (effectiveReleaseRule.acceptable_option) {
        const acceptable = effectiveReleaseRule.acceptable_option.trim().toUpperCase();
        if (rawText !== acceptable) {
          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'OUT_OF_SPEC',
            isPassed: false,
            reason: `Out of specification: observed "${textValue}", acceptable option is "${effectiveReleaseRule.acceptable_option}"`,
          };
        }

        // Matches release acceptable option. Check monitoring option if present
        if (effectiveMonitoringRule && effectiveMonitoringRule.acceptable_option) {
          const monAcceptable = effectiveMonitoringRule.acceptable_option.trim().toUpperCase();
          if (rawText !== monAcceptable) {
            return {
              appliedRuleId,
              appliedRuleVersion,
              evaluationStatus: 'WARNING',
              isPassed: null,
              reason: `Monitoring option mismatch: observed "${textValue}", expected "${effectiveMonitoringRule.acceptable_option}"`,
            };
          }
        }

        if (effectiveReleaseRule.decision_consequence === 'NEUTRAL') {
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
              evaluationStatus: 'OUT_OF_SPEC',
              isPassed: false,
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
          evaluationStatus: 'OUT_OF_SPEC',
          isPassed: false,
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

    // 4. Evaluation when ONLY MONITORING rule is present (0 RELEASE rules)
    const appliedRuleId = effectiveMonitoringRule!.id;
    const appliedRuleVersion = effectiveMonitoringRule!.version;

    if (resultType === 'NUMERIC' || resultType === 'CALCULATED') {
      if (numericValue === null || numericValue === undefined) {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'WARNING',
          isPassed: null,
          reason: 'Missing numeric value for quantitative monitoring test',
        };
      }

      const numVal = Number(numericValue);
      if (Number.isNaN(numVal)) {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'WARNING',
          isPassed: null,
          reason: `Invalid numeric value: ${numericValue}`,
        };
      }

      const minPass = effectiveMonitoringRule!.min_value === null || numVal >= Number(effectiveMonitoringRule!.min_value);
      const maxPass = effectiveMonitoringRule!.max_value === null || numVal <= Number(effectiveMonitoringRule!.max_value);

      if (minPass && maxPass) {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'NEUTRAL',
          isPassed: null,
        };
      } else {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'WARNING',
          isPassed: null,
          reason: `Monitoring threshold exceeded: observed ${numVal}, bounds [${effectiveMonitoringRule!.min_value ?? '-∞'}, ${effectiveMonitoringRule!.max_value ?? '+∞'}]`,
        };
      }
    }

    const rawText = (textValue || '').trim().toUpperCase();

    if (effectiveMonitoringRule!.acceptable_option) {
      const acceptable = effectiveMonitoringRule!.acceptable_option.trim().toUpperCase();
      if (rawText === acceptable) {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'NEUTRAL',
          isPassed: null,
        };
      } else {
        return {
          appliedRuleId,
          appliedRuleVersion,
          evaluationStatus: 'WARNING',
          isPassed: null,
          reason: `Monitoring option mismatch: observed "${textValue}", expected "${effectiveMonitoringRule!.acceptable_option}"`,
        };
      }
    }

    if (['NOT_OK', 'FAIL', 'POSITIVE', 'FALSE', 'NO', 'ABNORMAL'].includes(rawText)) {
      return {
        appliedRuleId,
        appliedRuleVersion,
        evaluationStatus: 'WARNING',
        isPassed: null,
        reason: `Failing qualitative monitoring observation: "${textValue}"`,
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
   *
   * Only required tests (isRequired !== false) can block completion or cause OUT_OF_SPEC / RULE_CONFIGURATION_ERROR.
   * Optional failures and monitoring warnings never block completion.
   * MONITORING warnings never reject.
   * NO_ACTIVE_RULE remains explicit.
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

    // Required tests filter (treats true and undefined as required)
    const required = performed.filter((r) => r.isRequired !== false);

    if (required.length > 0) {
      // 1. Configuration Error on required test blocks completion
      if (required.some((r) => r.evaluationStatus === 'RULE_CONFIGURATION_ERROR')) {
        return 'RULE_CONFIGURATION_ERROR';
      }

      // 2. Any required OUT_OF_SPEC dominates
      if (required.some((r) => r.evaluationStatus === 'OUT_OF_SPEC')) {
        return 'OUT_OF_SPEC';
      }

      // 3. Any missing active rule on a required test cannot be called PASS
      if (required.some((r) => r.evaluationStatus === 'NO_ACTIVE_RULE' || !r.evaluationStatus)) {
        return 'NO_ACTIVE_RULE';
      }

      // 4. Monitoring warnings or neutral tests on required tests yield NEUTRAL (never reject, never coerce to PASS)
      if (
        required.some(
          (r) => r.evaluationStatus === 'WARNING' || r.evaluationStatus === 'NEUTRAL'
        )
      ) {
        return 'NEUTRAL';
      }

      // 5. All required tests evaluated against active release rules and passed
      if (required.every((r) => r.evaluationStatus === 'PASS')) {
        return 'PASS';
      }

      return 'NO_ACTIVE_RULE';
    }

    // If all performed tests are optional (required.length === 0):
    // Optional tests never block completion.
    if (performed.every((r) => r.evaluationStatus === 'PASS')) {
      return 'PASS';
    }

    return 'NEUTRAL';
  }

  /**
   * Concurrency-safe rule creation and supersession by QA Head.
   * Closes prior active rule for the same testing point and increments version.
   * Requires substantive governance reason.
   * Blocks new rules for deprecated ZMCC_LAB_CONTRACTOR.
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
      reason,
    } = input;

    // Reason validation
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      throw new Error(
        'A substantive reason (at least 3 characters) is required to create or modify a quality rule.'
      );
    }

    // Block new active ZMCC_LAB_CONTRACTOR rules (historical compatibility only)
    if (testingPoint === 'ZMCC_LAB_CONTRACTOR') {
      throw new Error(
        "Testing point 'ZMCC_LAB_CONTRACTOR' is deprecated and blocked for new rules. Use 'ZMCC_LAB_MOT' or 'ZMCC_LAB_LOCAL_SUPPLIER' instead."
      );
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      const testIdBigInt = BigInt(String(labTestId));
      const userIdBigInt = BigInt(String(createdByUserId));

      // Advisory transaction lock to serialize mutations for this specific rule family
      const lockKey = `lab_test_rule:${testIdBigInt}:${testingPoint}:${ruleCategory}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // 1. Check if lab test exists
      const test = await tx.labTest.findUnique({
        where: { id: testIdBigInt },
      });
      if (!test) {
        throw new Error(`LabTest with id ${labTestId} not found.`);
      }

      // 2. Find existing active rule under lock
      const existingActive = await tx.labTestRule.findFirst({
        where: {
          lab_test_id: testIdBigInt,
          testing_point: testingPoint,
          rule_category: ruleCategory,
          is_active: true,
        },
        orderBy: { version: 'desc' },
      });

      // Find highest version ever created for this rule family
      const highestVersionRule = await tx.labTestRule.findFirst({
        where: {
          lab_test_id: testIdBigInt,
          testing_point: testingPoint,
          rule_category: ruleCategory,
        },
        orderBy: { version: 'desc' },
      });

      const nextVersion = highestVersionRule ? highestVersionRule.version + 1 : 1;

      if (existingActive) {
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

      // 4. Record Audit Log preserving old/new version, testing point, category, threshold/option, effective date, actor, and reason
      await tx.auditLog.create({
        data: {
          table_name: 'lab_test_rule',
          record_id: newRule.id,
          action: existingActive ? 'SOP_LAB_RULE_SUPERSEDED' : 'SOP_LAB_RULE_CREATED',
          old_values: existingActive
            ? {
                old_rule_id: String(existingActive.id),
                old_version: existingActive.version,
                testing_point: existingActive.testing_point,
                rule_category: existingActive.rule_category,
                min_value: existingActive.min_value !== null ? String(existingActive.min_value) : null,
                max_value: existingActive.max_value !== null ? String(existingActive.max_value) : null,
                acceptable_option: existingActive.acceptable_option,
                warning_trigger: existingActive.warning_trigger,
                decision_consequence: existingActive.decision_consequence,
                effective_from: existingActive.effective_from?.toISOString(),
                effective_to: existingActive.effective_to?.toISOString(),
              }
            : undefined,
          new_values: {
            test_id: String(testIdBigInt),
            test_code: test.testCode,
            testing_point: testingPoint,
            rule_category: ruleCategory,
            version: nextVersion,
            min_value: minValue !== undefined && minValue !== null && minValue !== '' ? String(minValue) : null,
            max_value: maxValue !== undefined && maxValue !== null && maxValue !== '' ? String(maxValue) : null,
            acceptable_option: acceptableOption || null,
            warning_trigger: warningTrigger || null,
            decision_consequence: decisionConsequence || null,
            effective_from: effectiveFrom.toISOString(),
            effective_to: null,
            reason: reason.trim(),
            actor_user_id: String(userIdBigInt),
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
