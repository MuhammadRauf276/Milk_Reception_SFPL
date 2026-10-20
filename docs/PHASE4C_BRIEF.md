# Phase 4c brief: Stage 3 (ZMCC / Contractor dispatch)

Binding for all Phase 4c agents. Also read: docs/PHASE4B_BRIEF.md "Owner rules" (same rules apply: CODE ONLY, no tests, own files only, no DB commands, only Agent A edits schema + migration + runs `npx prisma generate`, keep line endings, simple English UI, report ≤150 words), docs/PHASE3_BRIEF.md "Hard rules" + "Notes from finished tasks". Plan: docs/WORKFLOW_ALIGNMENT_PLAN.md "Stage 3 — ZMCC/Contractor Dispatch" table, §8 row 2 and row 5, §9, §14.

Reuse: src/backend/services/decision/decisionRule.ts (evaluateDecision), src/types/stage1-decision.ts types, src/frontend/modules/shared/decision/DecisionRulePanel.tsx + DecisionStatusBadge.tsx, src/components/camera/LiveCamera.tsx, getEffectivePolicy from src/backend/services/testPointPolicyService.ts, src/backend/services/dispatchScope.ts (scope checks — keep them), resolveActingContext.

## Owner decisions for Stage 3
- Test mode is explicit: COMPOSITE = exactly one portion; PORTION_WISE = N portions.
- Seal number per portion: required, unique within the visit/dispatch.
- Photos per policy point ZMCC_DISPATCH (Zonal Lab Attendant: LR/Fat photos REQUIRED) or CONTRACTOR_DISPATCH (photos OPTIONAL). Hand-written lab report photo (test code LAB_REPORT_HANDWRITTEN, photoKind 'LAB_REPORT') required at both dispatch points. Camera only.
- Submit vs Send Request: if any compulsory test is missing, a rule-checked value fails (rule APPLY), a required photo is missing, or the person decision differs → normal Submit is refused (409) and the operator must "Send Request". ZMCC dispatch → Zonal Manager decides. Contractor dispatch → Contractor Manager decides (MPD Head can also answer). Rule mode WARN → amber warning only. "NO" reopens the form for editing. A superior doing the dispatch decides on the same screen (DECIDE_NOW).
- Contractor dispatch uses the same form at a new page /contractor/dispatch; tests optional per policy.
- Gross litres, weighted 13 TS (weighted LR and Fat by portion quantity) computed on the SERVER; never trust payload totals. Show the remaining tank balance after submit.
- Texts: "Send request to Zonal Manager" / "Send request to Contractor Manager" (remove "Routes to MPD Head").

## API contract (Agent A builds; B and C code against it)
```ts
// POST /api/dispatches  (existing route, extended)
body += {
  testMode: 'COMPOSITE' | 'PORTION_WISE';
  action: 'SUBMIT' | 'SEND_REQUEST';
  personDecision: 'ACCEPT' | 'REJECT'; decisionRemarks?: string | null;
  portions: Array<{ /* existing fields */ seal_number: string;
    test_results?: Array<{ lab_test_id: string; value?: number | null; text_value?: string | null }>;
    photos?: Array<{ lab_test_id: string; capture_id: string }> }>;
  labReportCaptureId?: string | null;
}
// 200/201 -> { dispatch: {...existing, id, status}, decision: DecisionResult, totals: { grossLiters, weightedLr, weightedFat, weightedTs13 }, tankRemainingLiters: number | null }
// 409 { code: 'EXCEPTION_NEEDS_REQUEST', decision: DecisionResult } when action SUBMIT has an exception
// 409 { code: 'SEAL_DUPLICATE', sealNumber }
// status after SEND_REQUEST: 'PENDING_APPROVAL' (approverRole 'ZMCC_MANAGER' | 'CONTRACTOR_MANAGER'); after OKAY: 'DISPATCHED'; after NO: 'REOPENED' (editable again, resubmit with same id)

// GET  /api/dispatches/policy?point=ZMCC_DISPATCH|CONTRACTOR_DISPATCH -> { point, version, tests: MotShopPolicyTest-like[] } (same shape as MotShopPolicySnapshot but point varies)
// GET  /api/dispatches/approvals?status=PENDING|DECIDED -> { items: DispatchApprovalItem[] }  (scope: ZM own ZMCC; Contractor Manager own contractor; MPD Head/SA all)
// POST /api/dispatches/[id]/approver-decision { verdict: 'OKAY' | 'NO'; remarks?: string; version: number } -> { item: DispatchApprovalItem }  (decider != submitter, DE cannot decide, 409 on version mismatch)
interface DispatchApprovalItem { id: string; dispatchNumber: string; sourceId: string; sourceName: string; sourceType: 'ZMCC' | 'CONTRACTOR';
  vehicleNumber: string; submittedBy: string; submittedAt: string; performedAsRole: string | null; isDelegated: boolean;
  testMode: 'COMPOSITE' | 'PORTION_WISE'; totals: { grossLiters: number; weightedLr: number; weightedFat: number; weightedTs13: number };
  portions: Array<{ portionNumber: number; sealNumber: string; quantityLiters: number; lr: number | null; fat: number | null;
    tests: Array<{ testCode: string; testName: string; value: number | null; outcome: 'PASS' | 'FAIL' | 'WARN' | 'NOT_TESTED' }>;
    photos: Array<{ captureId: string; received: boolean }> }>;
  labReportPhoto: { captureId: string; received: boolean } | null;
  personDecision: 'ACCEPT' | 'REJECT'; decisionRemarks: string | null; exceptionReasons: string[];
  status: string; version: number }
// Photos: upload via POST /api/photos after the dispatch is saved: portion photos entityType 'dispatch_portion' (entityId = portion id from response), lab report entityType 'dispatch_info' photoKind 'LAB_REPORT'. testingPoint ZMCC_DISPATCH or CONTRACTOR_DISPATCH.
```

## Agents and files
- A (opus) — server: prisma/schema.prisma + migration 20261021140000_phase4c_dispatch (only missing columns: seal_number, test_mode, approval/decision fields, version — check what Phase 2 already added), src/app/api/dispatches/route.ts, src/app/api/dispatches/start/route.ts, new src/app/api/dispatches/policy/route.ts, new src/app/api/dispatches/approvals/route.ts, new src/app/api/dispatches/[id]/approver-decision/route.ts, src/lib/validations/dispatch.ts, src/backend/services/dispatchScope.ts, new src/backend/services/dispatch/dispatchDecisionService.ts. Notify the approver (existing notification service) on SEND_REQUEST.
- B (sonnet) — dispatch form UI: DynamicDispatchForm.tsx, DispatchPortionEditor.tsx, DispatchVehicleSection.tsx (find paths), src/app/zmcc/dispatch/page.tsx, new src/app/contractor/dispatch/page.tsx, role-routing.ts (contractor operator → /contractor/dispatch). Test mode switch, seal per portion, policy tests, LiveCamera photos + lab report photo, DecisionRulePanel, Submit / Send request buttons, 409 handling, REOPENED editing, tank balance after submit.
- C (sonnet) — approver screens: new src/frontend/modules/dispatch/DispatchApprovalQueue.tsx (cards with photos via /api/photos/[captureId], OKAY / NO 56px, remarks for NO), mount in src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx (APPROVALS tab, after the MOT exception queue) and in the Contractor Manager page (src/app/contractor/manager/page.tsx or its workspace component) and an MPD Head view (find MPD Head screen; read-only list + can answer contractor requests).
