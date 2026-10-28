import fs from 'fs';

// 1. Patch src/backend/services/zmcc/labPortionDecision.ts
{
  let code = fs.readFileSync('src/backend/services/zmcc/labPortionDecision.ts', 'utf8');

  const oldOutcomeRegex = /function outcomeOf[\s\S]*?return 'PASS';\r?\n}/;
  const newOutcome = `function outcomeOf(t: LabPolicyTest, value: number | null, textValue: string | null): 'PASS' | 'WARN' | 'FAIL' {
  const rule = t.rule;
  if (!rule) return 'PASS';

  const evalRes = evaluate3ZoneTest(
    {
      min: rule.min,
      max: rule.max,
      warningTrigger: rule.warningTrigger,
      decisionConsequence: rule.decisionConsequence,
      acceptableOption: rule.acceptableOption,
      category: rule.ruleCategory,
      ruleCategory: rule.ruleCategory,
      testMode: t.testMode,
      resultType: t.resultType,
      resultOptions: t.resultOptions,
      unit: t.unit,
    },
    value !== null ? value : textValue
  );

  if (evalRes.verdict === 'MONITORING' || evalRes.verdict === 'NOT_APPLIED') return 'PASS';
  return evalRes.verdict === 'WARN' ? 'WARN' : evalRes.verdict === 'FAIL' ? 'FAIL' : 'PASS';
}`;

  code = code.replace(oldOutcomeRegex, newOutcome);

  const oldResRegex = /const res = outcomeOf\(t, value, textValue\);[\s\S]*?outcome = 'PASS';\r?\n\s*}/;
  const newRes = `const res = outcomeOf(t, value, textValue);
      if (res === 'FAIL') {
        if (t.ruleMode === 'APPLY') {
          outcome = 'FAIL';
          ruleFailures.push(t.testCode);
        } else {
          outcome = 'WARN';
          warnings.push(\`\${t.testName} violates specification threshold.\`);
        }
      } else if (res === 'WARN') {
        outcome = 'WARN';
        warnings.push(\`\${t.testName} is in tolerance margin. Requires QA review.\`);
      } else {
        outcome = 'PASS';
      }`;

  code = code.replace(oldResRegex, newRes);
  fs.writeFileSync('src/backend/services/zmcc/labPortionDecision.ts', code, 'utf8');
  console.log('✅ Patched src/backend/services/zmcc/labPortionDecision.ts');
}

// 2. Patch src/backend/services/zmcc/labPortionReviewService.ts to pass warningTrigger & decisionConsequence
{
  let code = fs.readFileSync('src/backend/services/zmcc/labPortionReviewService.ts', 'utf8');

  const oldRuleRegex = /const rule =\r?\n\s*r && r\.rule_category === 'RELEASE' && !r\.isConfigurationError[\s\S]*?: null;/;
  const newRule = `const rule =
      r && !r.isConfigurationError
        ? {
            min: r.min_value !== null ? Number(r.min_value) : null,
            max: r.max_value !== null ? Number(r.max_value) : null,
            allowed,
            warningTrigger: r.warning_trigger ?? null,
            decisionConsequence: r.decision_consequence ?? null,
            ruleCategory: r.rule_category ?? 'RELEASE',
            acceptableOption: r.acceptable_option ?? null,
          }
        : allowed
        ? { min: null, max: null, allowed, warningTrigger: null, decisionConsequence: null, ruleCategory: 'RELEASE', acceptableOption: null }
        : null;`;

  code = code.replace(oldRuleRegex, newRule);

  // Also include resultOptions on the test object
  if (!code.includes('resultOptions: lt?.resultOptions')) {
    code = code.replace(
      'options: optionValues(lt?.resultOptions),',
      'options: optionValues(lt?.resultOptions),\n      resultOptions: lt?.resultOptions as any,'
    );
  }

  fs.writeFileSync('src/backend/services/zmcc/labPortionReviewService.ts', code, 'utf8');
  console.log('✅ Patched src/backend/services/zmcc/labPortionReviewService.ts');
}

// 3. Patch src/app/api/qa/vehicle-visits/[visitId]/route.ts to pass 3-zone parameters to active_plant_tests
{
  let code = fs.readFileSync('src/app/api/qa/vehicle-visits/[visitId]/route.ts', 'utf8');

  const oldRuleForRegex = /const ruleFor = \(testId: string\) => {[\s\S]*?return min === null && max === null && !allowed \? null : { min, max, allowed };\r?\n\s*};/;
  const newRuleFor = `const ruleFor = (testId: string) => {
      const r = plantRules.get(testId);
      if (!r || r.isConfigurationError) return null;
      const min = r.min_value !== null ? Number(r.min_value) : null;
      const max = r.max_value !== null ? Number(r.max_value) : null;
      const allowed = r.acceptable_option ? [r.acceptable_option] : null;
      return {
        min,
        max,
        allowed,
        warningTrigger: r.warning_trigger ?? null,
        decisionConsequence: r.decision_consequence ?? null,
        ruleCategory: r.rule_category ?? 'RELEASE',
        acceptableOption: r.acceptable_option ?? null,
      };
    };`;

  code = code.replace(oldRuleForRegex, newRuleFor);
  fs.writeFileSync('src/app/api/qa/vehicle-visits/[visitId]/route.ts', code, 'utf8');
  console.log('✅ Patched src/app/api/qa/vehicle-visits/[visitId]/route.ts');
}
