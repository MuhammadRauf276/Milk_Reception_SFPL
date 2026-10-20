# Phase 4b brief: Stage 2 (HC/MC reception at ZMCC)

Binding for all Phase 4b agents. Also read: docs/PHASE4A_BRIEF.md "Owner rules" + shared decision types (src/types/stage1-decision.ts, src/backend/services/decision/decisionRule.ts — reuse evaluateDecision for portions), docs/PHASE3_BRIEF.md "Hard rules", "Owner decisions", "Notes from finished tasks". Plan: docs/WORKFLOW_ALIGNMENT_PLAN.md "Stage 2 — HC/MC Reception at ZMCC" table (§3), §8 decisions, §14 exception rule.

## Owner rules
- CODE ONLY: no tests, no test files. No review work. Report ≤150 words.
- Edit only your files. Others work in parallel.
- No DB commands (no migrate/db push/seed). Only Agent A may edit prisma/schema.prisma and create the 4b migration (additive, idempotent, CRLF) and run `npx prisma generate`. Agents B and C use existing columns; if a column is truly missing, list it in your report (do not edit the schema).
- Keep line endings (mostly CRLF), TS strict, 2 spaces, single quotes. Simple English, ≥44px, field primaries 56px, status = colour + icon + word.
- Delegation: use resolveActingContext / requireRoles (ancestors) — superiors do subordinate work in own ZMCC; write *_as_role / *_is_delegated where columns exist (primaryActorFields / asRoleFields). Super Admin & Data Executive outside approval rules.
- "If you can approve it, you can decide it": exception on a superior's own work is decided on the same screen (DECIDE_NOW). Otherwise Stage 2 exceptions go to the Zonal Manager (NOT MPD Head).
- Finish: `npm run typecheck` (0 errors in non-test files), `npx eslint <your files>`.

## Owner decisions for Stage 2
- MC = MOT collection milk; HC = local supplier (old "ZMCC contractor"/local supplier). Test points ZMCC_LAB_MC / ZMCC_LAB_HC (getEffectivePolicy).
- ZMCC weighing (first/second weight) is done by MDO or PHE Operator (and superiors).
- ZMCC gate exit is REMOVED (Stage 2 ends with "journey closed"). Contractor arrival at ZMCC is REMOVED (hide UI + block new submissions; keep old data readable).
- New HC needs Zonal Manager approval; arrivals from unapproved HC are blocked.
- RMR token issued after acceptance (current behaviour).
- All portions rejected → vehicle rejected and MOT journey closed automatically.
- MPD Head adds remarks on rejected milk (rejected_milk_disposition table) — queue + notification.
- Area (MOT) loss/gain stored at journey close using accepted portions only.

## Agents and files
- A (opus) — ZMCC lab portions & decisions: prisma/schema.prisma + migration 20261021120000_phase4b_stage2 (only if needed), src/backend/services/zmccLabService.ts, src/app/api/zmcc/lab/** routes, src/frontend/modules/zmcc/**/ZmccLabWorkspace.tsx (find exact path), new src/backend/services/zmcc/labPortionReviewService.ts + its routes + a ZM queue component (src/frontend/modules/zmcc/approvals/LabPortionExceptionQueue.tsx) mounted later by the orchestrator. Composite = 1 portion; portion-wise = N portions (ZmccLabPortion). Per-portion tests from policy ZMCC_LAB_MC/HC, LiveCamera photos (photo entityType 'zmcc_lab_portion'), per-portion DecisionRulePanel (src/frontend/modules/shared/decision/DecisionRulePanel.tsx), ZM review (reviewPortionException), auto-close journey when all portions rejected, texts "Send to Zonal Manager", lab attendant "request new source" button.
- B (sonnet) — weights, tank receipts, area loss: src/backend/services/zmccTankService.ts, tank/weight API routes under src/app/api/zmcc/** (tank, weigh), the ZMCC tank/weighing UI component(s), src/backend/services/lossCalculationService.ts. First weight → tank → second weight per accepted portion (MDO/PHE + superiors); tank receipt per portion where a portion column exists (unique-constraint change is deferred to P4d — do not depend on it); area loss/gain at journey close from accepted portions.
- C (sonnet) — arrivals, HC approval, MPD remarks: src/backend/services/zmccLocalSupplierService.ts, src/backend/services/zmccArrival/zmccArrivalCore.ts, arrival + local-supplier API routes, ZmccArrivalsWorkspace.tsx, PendingApprovalsPanel.tsx (HC tab), src/app/phe/page.tsx (remove the MDO bridge for arrivals), new src/backend/services/rejectedMilkDispositionService.ts + route + MPD queue component (src/frontend/modules/mpd/RejectedMilkRemarksQueue.tsx) and mount it in the MPD Head screen (find it under src/app/mpd or src/frontend/modules/mpd). Widen resolveZmccArrivalAuth with acting context; ZmccArrivalsWorkspace acquireRobustGps maxCacheAgeMs 30_000; remove contractor arrival + ZMCC gate exit from the UI and block new ones server-side.
