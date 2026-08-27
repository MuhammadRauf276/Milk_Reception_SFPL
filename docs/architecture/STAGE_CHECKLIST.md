# STAGE CHECKLIST: Definition of Done

This checklist serves as the binding quality and governance gate for all development stages in the Milk Reception Application.

---

## 1. PRE-CHANGE
- [ ] Explicit scope declared and bounded (no scope creep).
- [ ] All relevant ADRs in docs/architecture/ read and understood.
- [ ] Git worktree baseline recorded (git status, git branch).
- [ ] Frozen business modules identified and protected.
- [ ] Environment safety verified (.env protected; no secrets exposed).

## 2. IMPLEMENTATION
- [ ] Smallest required change applied to achieve the declared objective.
- [ ] Zero unrelated refactoring or stylistic reformatting.
- [ ] Strict server-side validation on all API endpoints (Zod / TypeScript).
- [ ] Role-based server authorization enforced on all mutative routes.
- [ ] Zero hardcoded fake defaults (e.g. no fake 26.5 LR or 3.8 Fat).
- [ ] Zero silent fallbacks (missing data returns explicit error or null).
- [ ] Zero duplicate formulas (use canonical helpers in `src/backend/utils/milkFormulas.ts`).
- [ ] Numeric precision policy honored (ADR-005: intermediate values unrounded; display formatting separated from calculation/storage).
- [ ] Superseded runtime code removed promptly once replacement is verified (0 runtime, frontend, API, or report consumers).

## 3. DATABASE
- [ ] Schema changes evaluated: Is a migration required?
- [ ] Persistent schema changes use tracked migrations only (`npx prisma migrate dev` / `npx prisma migrate deploy`).
- [ ] **NO** `prisma db push` in normal workflows.
- [ ] Controlled development database resets (`npx prisma migrate reset`) executed ONLY when explicitly authorized by stage (ADR-004).
- [ ] Schema validated: `npx prisma validate` passes cleanly.
- [ ] Migration status verified: `npx prisma migrate status` reports up to date.

## 4. TESTING
- [ ] Focused behavioral tests created/updated for new requirements.
- [ ] Negative test paths and edge cases verified (rejections, bounds, invalid inputs).
- [ ] Integration and concurrency tests verified where relevant.
- [ ] Automated integration tests executed against isolated test database (`TEST_DATABASE_URL`).
- [ ] Zero test pollution in normal operational development database.
- [ ] Full regression suite executed (`npm run test:legacy` / `npm run test:all`).

## 5. STATIC QUALITY
- [ ] Standalone typecheck executed (`npm run typecheck`) with **0 errors**.
- [ ] Standalone lint executed (`npm run lint`) with **0 errors and 0 warnings**.
- [ ] Production build executed (`npm run build`) with **0 errors**.
- [ ] Static search verifies zero machine-specific hardcoded absolute paths.
- [ ] Static search verifies zero unauthorized `db push` references.

## 6. UI / BROWSER SIGN-OFF
- [ ] Actual visual browser verification reported accurately.
- [ ] API or headless CLI test scripts are **never** labeled as visual browser evidence.
- [ ] When browser automation is unavailable in the environment, report clearly: `ACTUAL VISUAL BROWSER SIGN-OFF: PENDING MANUAL VERIFICATION`.
- [ ] Provide clear human manual verification checklist for the user.

## 7. REPORT
- [ ] Exact list of files changed provided with clickable links.
- [ ] Database schema and migration status documented.
- [ ] Test suite execution results documented with exact numbers.
- [ ] Any blockers or discrepancies highlighted transparently.
- [ ] Clear final verdict stated.

## 8. STOP RULE
- [ ] **STOP** immediately after completing the stage report.
- [ ] Do **NOT** proceed to the next stage without explicit user review and approval.
