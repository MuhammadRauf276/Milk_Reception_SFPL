import { evaluate3ZoneTest } from '../src/lib/sop-evaluation';

console.log('Testing Temperature SOP Evaluation:');
const tempRule = {
  min: 0,
  max: 10,
  warningTrigger: '0 – 0 | 10 – 12',
  decisionConsequence: '< 0 or > 12',
  unit: '°C',
  testMode: 'COMPULSORY',
  resultType: 'NUMERIC',
};

// Case 1: Within Pass Range (e.g. 5)
const passRes = evaluate3ZoneTest(tempRule, '5');
console.log('Value 5:', passRes.verdict, passRes.message, 'Fail?', passRes.isRuleFailure, 'Warn?', passRes.isWarning);
if (passRes.verdict !== 'PASS' || passRes.isRuleFailure) throw new Error('Expected 5 to PASS');

// Case 2: In Tolerance Warning Margin (e.g. 11)
const warnRes11 = evaluate3ZoneTest(tempRule, '11');
console.log('Value 11:', warnRes11.verdict, warnRes11.message, 'Fail?', warnRes11.isRuleFailure, 'Warn?', warnRes11.isWarning);
if (warnRes11.verdict !== 'WARN' || warnRes11.isRuleFailure || !warnRes11.isWarning) {
  throw new Error('Expected 11 to be WARN without rule failure');
}

// Case 3: Boundary Warning (e.g. 12)
const warnRes12 = evaluate3ZoneTest(tempRule, '12');
console.log('Value 12:', warnRes12.verdict, warnRes12.message, 'Fail?', warnRes12.isRuleFailure, 'Warn?', warnRes12.isWarning);
if (warnRes12.verdict !== 'WARN' || warnRes12.isRuleFailure || !warnRes12.isWarning) {
  throw new Error('Expected 12 to be WARN without rule failure');
}

// Case 4: Exceeds Rejection Limit (e.g. 13)
const failRes13 = evaluate3ZoneTest(tempRule, '13');
console.log('Value 13:', failRes13.verdict, failRes13.message, 'Fail?', failRes13.isRuleFailure, 'Warn?', failRes13.isWarning);
if (failRes13.verdict !== 'FAIL' || !failRes13.isRuleFailure) {
  throw new Error('Expected 13 to FAIL');
}

console.log('\n🎉 ALL TEMPERATURE 3-ZONE EVALUATION TESTS PASSED PERFECTLY!');
