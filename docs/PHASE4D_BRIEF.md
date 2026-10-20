# Phase 4d brief: Stage 4 (plant reception)

Binding for all Phase 4d agents. Same owner rules as docs/PHASE4B_BRIEF.md "Owner rules" (CODE ONLY, no tests, own files only, no DB commands except Agent A's `npx prisma validate` + `npx prisma generate`, only Agent A edits the schema/migration, keep line endings, simple English UI, report ≤150 words). Also read docs/PHASE3_BRIEF.md "Hard rules" + "Notes from finished tasks". Plan: docs/WORKFLOW_ALIGNMENT_PLAN.md "Stage 4 — Plant Reception" table, §8 (business date of fully rejected vehicle), §14.

Reuse: evaluateDecision (src/backend/services/decision/decisionRule.ts), DecisionRulePanel, DecisionStatusBadge, LiveCamera, getEffectivePolicy('PLANT_QA'), resolveActingContext / requireRoles, writeAuditLog, recordRejectedMilkForDisposition pattern (src/backend/services/rejectedMilkDispositionService.ts).

## Owner decisions for Stage 4
- Admin Operator gate token: relabel only ("Admin Operator").
- QAE reads testMode from the dispatch (composite or portion-wise). Tests + photos per policy PLANT_QA; LR & Fat photos required.
- Seal verification: QAE enters the seal per portion; server compares with the dispatch seal; mismatch → exception path.
- Exceptions → AVP-QA (role QA_HEAD). QA_MANAGER review path is replaced: PLANT_QA_EXCEPTION_PENDING → ['QA_HEAD'], QA_MANAGER_REVIEW → AVP_QA_REVIEW; HOLD path removed. (QA_MANAGER role itself is retired in Phase 6 — do not delete the role now; just stop routing to it.) A superior doing QAE work decides on the same screen.
- Composite fail → whole vehicle rejected → gate exit.
- Per accepted portion: weigh (gross) → unload → weigh (tare). WeightTicket per portion; unloading loops over all accepted portions; remove the MULTI_SILO_ALLOCATION_REQUIRED block.
- Business date set once at first weight; REMOVE the overwrite in api/security/gate-exit (operational_date: exitBusinessDate). Fully rejected vehicle: business date = time of last QA rejection (08:00 rule: 07:59:59 → previous day, 08:00:00 → same day — src/lib/business-day.ts or equivalent).
- Weighted 13 TS by each portion's net weight (vehicleQuantityService, siloInventoryService).
- Loss naming: ZMCC loss/gain = Tier 3, Transit loss/gain = Tier 4 (labels only).
- Tanker washed before gate exit: tanker_washed, washed_checked_by, washed_checked_at on GateLog; exit blocked until washed; "Wash tanker" step in the gateway UI.
- MPD Head remarks on rejected plant portions (VisitPortion mpd_disposition_remarks/_by/_at) + queue (extend the existing MPD rejected-milk queue).
- Deferred unique constraints (from Phase 2): weight_ticket, zmcc_lab_result, zmcc_tank_receipt become per portion — migration must BACKFILL portion ids for existing rows before adding uniques; never drop data; idempotent where possible.

## Agents and files
- A (opus) — schema + quantities: prisma/schema.prisma + migration 20261021160000_phase4d_stage4 (backfill + per-portion uniques; any missing columns for B/C: GateLog tanker wash fields, VisitPortion mpd_disposition_*, PlantLabResult photo/seal fields — check what exists), src/app/api/scale/** routes, src/backend/services/vehicleQuantityService.ts, src/backend/services/siloInventoryService.ts, ProductionUnloadingWorkspace.tsx (find), weighbridge UI component(s) that call api/scale (find), src/backend/services/zmccTankService.ts (switch to one receipt per portion once the unique changes).
- B (sonnet) — plant QA: QATestingSection.tsx, QADecisionModals.tsx, src/app/api/qa/** routes (except anything A owns), src/app/api/qa/manager/queue → AVP-QA queue, eventCatalog.ts (notification keys), the QA Head (AVP-QA) screen src/app/department/qa-head/page.tsx (mount the exception queue there). Seal verification, testMode from dispatch, policy tests + photos (entityType 'plant_portion_test' / 'visit_portion'), DecisionRulePanel, AVP-QA routing, remove HOLD.
- C (sonnet) — gate + business date + MPD remarks + labels: src/app/api/security/gate-exit/route.ts, src/app/api/security/gate-entry/route.ts, SecurityGatewayWorkspace.tsx, src/lib/business-day.ts (only if needed), src/backend/services/lossCalculationService.ts (labels only), SupplyChainLossCard.tsx, MpdLossScreen.tsx, src/backend/services/rejectedMilkDispositionService.ts + src/app/api/mpd/rejected-milk/** + src/frontend/modules/mpd/RejectedMilkRemarksQueue.tsx (extend to plant portions).
