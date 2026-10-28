import fs from 'fs';

let code = fs.readFileSync('src/frontend/modules/zmcc/lab/LabPortionsPanel.tsx', 'utf8');

// Add import for evaluate3ZoneTest
if (!code.includes("import { evaluate3ZoneTest } from '@/lib/sop-evaluation';")) {
  code = code.replace(
    "import { cn } from '@/lib/utils';",
    "import { cn } from '@/lib/utils';\nimport { evaluate3ZoneTest } from '@/lib/sop-evaluation';"
  );
}

// Replace test evaluation inside sortedTests.map
const oldMapTarget = /const v = modalDraft\.values\[t\.labTestId\] \?\? '';[\s\S]*?const isRequired = t\.testMode === 'COMPULSORY';/;

const newMapTarget = `const v = modalDraft.values[t.labTestId] ?? '';
                        const photoBusy = busy === \`photo:\${modalPortion.id}:\${t.labTestId}\`;
                        const range = labSopRangeText(t);
                        const isNumeric = t.resultType === 'NUMERIC';
                        const isRequired = t.testMode === 'COMPULSORY';

                        const evalRes = evaluate3ZoneTest(
                          {
                            min: t.rule?.min,
                            max: t.rule?.max,
                            warningTrigger: t.rule?.warningTrigger,
                            decisionConsequence: t.rule?.decisionConsequence,
                            acceptableOption: t.rule?.acceptableOption,
                            category: t.rule?.ruleCategory,
                            ruleCategory: t.rule?.ruleCategory,
                            testMode: t.testMode,
                            resultType: t.resultType,
                            resultOptions: t.resultOptions,
                            unit: t.unit,
                          },
                          v
                        );

                        const isWarning = Boolean(v) && evalRes.isWarning;
                        const isFail = Boolean(v) && evalRes.isRuleFailure;
                        const isOut = isWarning || isFail;`;

code = code.replace(oldMapTarget, newMapTarget);

// Replace input styling and border
const oldInputClass = /isOut\s*\?\s*'border-rose-400 bg-rose-50\/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'\s*:\s*'border-border focus:ring-primary'/g;
const newInputClass = `isFail
                                        ? 'border-rose-400 bg-rose-50/40 text-rose-950 focus:border-rose-500 focus:ring-rose-500'
                                        : isWarning
                                          ? 'border-amber-400 bg-amber-50/50 text-amber-950 focus:border-amber-500 focus:ring-amber-500'
                                          : 'border-border focus:ring-primary'`;

code = code.replace(oldInputClass, newInputClass);

// Replace SOP badge styling
const oldSopBadge = /isOut \? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-300 bg-slate-50 text-slate-700'/;
const newSopBadge = `isFail
                                          ? 'border-rose-300 bg-rose-50 text-rose-800'
                                          : isWarning
                                            ? 'border-amber-300 bg-amber-50 text-amber-900 font-bold'
                                            : 'border-slate-300 bg-slate-50 text-slate-700'`;
code = code.replace(oldSopBadge, newSopBadge);

// Replace the message under input: {isOut && ( ... Outside SOP range ... )}
const oldMsgRegex = /\{isOut && \(\s*<p className="flex items-center gap-1 text-\[11px\] font-semibold text-rose-700">[\s\S]*?<\/p>\s*\)\}/;

const newMsg = `{Boolean(v) && (
                              <p
                                className={cn(
                                  'flex items-center gap-1 text-[11px] font-semibold',
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

code = code.replace(oldMsgRegex, newMsg);

// Update system result preview: if route is not REJECT and no ruleFailures, show Warning if any warning exists
const oldSysResult = /System result: \{modalPreview\.systemOutcome === 'PASS' \? 'Passed' : 'Failed'\}/;
const newSysResult = `System result: {modalPreview.systemOutcome === 'PASS' ? 'Passed' : modalPreview.route === 'SEND_TO_APPROVER' ? 'Warning (QA Review)' : 'Failed'}`;
code = code.replace(oldSysResult, newSysResult);

fs.writeFileSync('src/frontend/modules/zmcc/lab/LabPortionsPanel.tsx', code, 'utf8');
console.log('✅ Patched src/frontend/modules/zmcc/lab/LabPortionsPanel.tsx');
