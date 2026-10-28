import fs from 'fs';

// 1. Patch QATestDrawer.tsx
{
  let code = fs.readFileSync('src/frontend/modules/dashboard/qa/QATestDrawer.tsx', 'utf8');

  if (!code.includes("import { evaluate3ZoneTest } from '@/lib/sop-evaluation';")) {
    code = code.replace(
      "import { cn } from '@/lib/utils';",
      "import { cn } from '@/lib/utils';\nimport { evaluate3ZoneTest } from '@/lib/sop-evaluation';"
    );
  }

  // Update evaluation logic in QATestDrawer
  const oldDrawerOutRegex = /const isOut =\r?\n\s*!isAppliedOnly &&\r?\n\s*!isCalculated &&\r?\n\s*\(isNumeric\r?\n\s*\? outsideLabRange\(t\.rule, effectiveVal\)\r?\n\s*: isDisallowedLabOption\(t\.rule, state\.textValue\)\);/;

  const newDrawerOut = `const evalRes = evaluate3ZoneTest(
                          {
                            min: t.rule?.min,
                            max: t.rule?.max,
                            warningTrigger: (t.rule as any)?.warningTrigger,
                            decisionConsequence: (t.rule as any)?.decisionConsequence,
                            acceptableOption: (t.rule as any)?.acceptableOption,
                            category: (t.rule as any)?.ruleCategory,
                            ruleCategory: (t.rule as any)?.ruleCategory,
                            testMode: t.isRequired ? 'COMPULSORY' : 'OPTIONAL',
                            resultType: t.resultType,
                            resultOptions: t.resultOptions,
                            unit: t.unit,
                          },
                          isNumeric ? effectiveVal : state.textValue
                        );

                        const isWarning = !isAppliedOnly && !isCalculated && Boolean(isNumeric ? effectiveVal : state.textValue) && evalRes.isWarning;
                        const isFail = !isAppliedOnly && !isCalculated && Boolean(isNumeric ? effectiveVal : state.textValue) && evalRes.isRuleFailure;
                        const isOut = isWarning || isFail;`;

  code = code.replace(oldDrawerOutRegex, newDrawerOut);

  // Update input class in QATestDrawer
  const oldInputClass = /isOut\s*\?\s*'border-rose-400 bg-rose-50\/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'\s*:\s*'border-border focus:ring-primary'/g;
  const newInputClass = `isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'`;
  code = code.replace(oldInputClass, newInputClass);

  // Add 3-zone message under inputs in QATestDrawer
  const oldCalcMsg = /\{isCalculated && \(\s*<p className="text-\[10px\] text-purple-700 font-medium flex items-center gap-1">[\s\S]*?<\/p>\s*\)\}/;
  const newCalcMsg = `{isCalculated && (
                            <p className="text-[10px] text-purple-700 font-medium flex items-center gap-1">
                              <Calculator className="h-3 w-3" /> Auto-calculated by Richmond canonical formula
                            </p>
                          )}
                          {!isCalculated && !isAppliedOnly && Boolean(isNumeric ? effectiveVal : state.textValue) && (
                            <p
                              className={cn(
                                'flex items-center gap-1 text-[11px] font-semibold mt-1',
                                isFail ? 'text-rose-700' : isWarning ? 'text-amber-800' : 'text-emerald-700'
                              )}
                            >
                              {isFail ? (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
                              ) : isWarning ? (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                              )}
                              <span>{evalRes.message}</span>
                            </p>
                          )}`;
  code = code.replace(oldCalcMsg, newCalcMsg);

  fs.writeFileSync('src/frontend/modules/dashboard/qa/QATestDrawer.tsx', code, 'utf8');
  console.log('✅ Patched src/frontend/modules/dashboard/qa/QATestDrawer.tsx');
}

// 2. Patch useQADecisionPreview.ts
{
  let code = fs.readFileSync('src/frontend/modules/dashboard/qa/useQADecisionPreview.ts', 'utf8');

  if (!code.includes("import { evaluate3ZoneTest } from '@/lib/sop-evaluation';")) {
    code = code.replace(
      "import { evaluateAllCalculatedTests } from '@/lib/calculated-tests';",
      "import { evaluateAllCalculatedTests } from '@/lib/calculated-tests';\nimport { evaluate3ZoneTest } from '@/lib/sop-evaluation';"
    );
  }

  // Replace numeric check in useQADecisionPreview
  const oldNumericCheckRegex = /if \(test\.resultType === 'NUMERIC'\) {[\s\S]*?else if \(test\.resultOptions && test\.resultOptions\.length > 0\) {[\s\S]*?} else {\s*valueText = state\.textValue \|\| '—';\s*}/;

  const newNumericCheck = `const evalRes = evaluate3ZoneTest(
        {
          min: test.rule?.min,
          max: test.rule?.max,
          warningTrigger: (test.rule as any)?.warningTrigger,
          decisionConsequence: (test.rule as any)?.decisionConsequence,
          acceptableOption: (test.rule as any)?.acceptableOption,
          category: (test.rule as any)?.ruleCategory,
          ruleCategory: (test.rule as any)?.ruleCategory,
          testMode: test.isRequired ? 'COMPULSORY' : 'OPTIONAL',
          resultType: test.resultType,
          resultOptions: test.resultOptions,
          unit: test.unit,
        },
        test.resultType === 'NUMERIC' ? state.numericValue : state.textValue
      );

      valueText = test.resultType === 'NUMERIC' ? \`\${state.numericValue} \${test.unit || ''}\`.trim() : (state.textValue || '—');

      if (evalRes.verdict === 'FAIL') {
        outcome = 'FAIL';
        note = evalRes.message;
      } else if (evalRes.verdict === 'WARN') {
        outcome = 'WARN';
        note = evalRes.message;
      } else if (photoRequired && !hasPhoto) {
        outcome = 'WARN';
        note = 'Verification photo missing';
      } else {
        outcome = 'PASS';
        note = evalRes.message;
      }`;

  code = code.replace(oldNumericCheckRegex, newNumericCheck);

  // Replace liveDecision rule failure check in useQADecisionPreview
  const oldLiveFailRegex = /} else if \(test\.resultType === 'NUMERIC' && test\.rule\) {[\s\S]*?ruleFailures\.push\(test\.testCode\);\s*}\s*}/;

  const newLiveFail = `} else if (test.resultType === 'NUMERIC' && test.rule) {
          const evalRes = evaluate3ZoneTest(
            {
              min: test.rule.min,
              max: test.rule.max,
              warningTrigger: (test.rule as any)?.warningTrigger,
              decisionConsequence: (test.rule as any)?.decisionConsequence,
              acceptableOption: (test.rule as any)?.acceptableOption,
              category: (test.rule as any)?.ruleCategory,
              ruleCategory: (test.rule as any)?.ruleCategory,
              testMode: test.isRequired ? 'COMPULSORY' : 'OPTIONAL',
              resultType: test.resultType,
              resultOptions: test.resultOptions,
              unit: test.unit,
            },
            state.numericValue
          );
          if (evalRes.isRuleFailure) {
            ruleFailures.push(test.testCode);
          }
        }}`;

  code = code.replace(oldLiveFailRegex, newLiveFail);
  fs.writeFileSync('src/frontend/modules/dashboard/qa/useQADecisionPreview.ts', code, 'utf8');
  console.log('✅ Patched src/frontend/modules/dashboard/qa/useQADecisionPreview.ts');
}

// 3. Patch QualityRuleService in src/backend/services/qualityRuleService.ts
{
  let code = fs.readFileSync('src/backend/services/qualityRuleService.ts', 'utf8');

  if (!code.includes("import { parseToleranceBoundaries } from '@/lib/sop-evaluation';")) {
    code = code.replace(
      "import { normalizeOptionText } from '@/lib/validations/labTest';",
      "import { normalizeOptionText } from '@/lib/validations/labTest';\nimport { parseToleranceBoundaries } from '@/lib/sop-evaluation';"
    );
  }

  // Update evaluateLabResult tolerance logic
  const oldToleranceBlock = /\/\/ 3-Zone Quantitative Tolerance Engine:[\s\S]*?return {\s*appliedRuleId,\s*appliedRuleVersion,\s*evaluationStatus: 'OUT_OF_SPEC',\s*isPassed: false,\s*reason: `Fail: observed \${numVal}, allowable range \[[\s\S]*?\]`,\s*};/;

  const newToleranceBlock = `// 3-Zone Quantitative Tolerance Engine (parsed from warning_trigger & decision_consequence):
          const { warnLow, warnHigh } = parseToleranceBoundaries(
            minVal,
            maxVal,
            effectiveReleaseRule.warning_trigger,
            effectiveReleaseRule.decision_consequence
          );

          const inLowWarn = warnLow !== null && minVal !== null && numVal >= warnLow && numVal < minVal;
          const inHighWarn = warnHigh !== null && maxVal !== null && numVal > maxVal && numVal <= warnHigh;

          if (inLowWarn && minVal !== null && warnLow !== null) {
            return {
              appliedRuleId,
              appliedRuleVersion,
              evaluationStatus: 'WARNING',
              isPassed: null,
              reason: \`Tolerance Warning: observed \${numVal} is within warning margin [\${warnLow}, \${minVal}] below minimum limit \${minVal}\`,
            };
          }

          if (inHighWarn && maxVal !== null && warnHigh !== null) {
            return {
              appliedRuleId,
              appliedRuleVersion,
              evaluationStatus: 'WARNING',
              isPassed: null,
              reason: \`Tolerance Warning: observed \${numVal} is within warning margin [\${maxVal}, \${warnHigh}] above maximum limit \${maxVal}\`,
            };
          }

          return {
            appliedRuleId,
            appliedRuleVersion,
            evaluationStatus: 'OUT_OF_SPEC',
            isPassed: false,
            reason: \`Fail: observed \${numVal}, allowable range [\${effectiveReleaseRule.min_value ?? '-∞'}, \${effectiveReleaseRule.max_value ?? '+∞'}]\`,
          };`;

  code = code.replace(oldToleranceBlock, newToleranceBlock);
  fs.writeFileSync('src/backend/services/qualityRuleService.ts', code, 'utf8');
  console.log('✅ Patched src/backend/services/qualityRuleService.ts');
}
