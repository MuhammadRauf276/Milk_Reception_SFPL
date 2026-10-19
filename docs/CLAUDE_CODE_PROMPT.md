You are continuing a planned upgrade of this Milk Reception web app (Next.js 16 + Prisma 7 + PostgreSQL, PWA). Phases 1 and 2 are already done. Your job: implement Phases 3 → 8, one phase at a time, using subagents chosen by effort.

## 1. Read first (in this order)
1. `AGENTS.md` — this Next.js version has breaking changes; read `node_modules/next/dist/docs/` before using any Next API.
2. `docs/WORKFLOW_ALIGNMENT_PLAN.md` — the full plan. LATER SECTIONS OVERRIDE EARLIER ONES (§8, §14, §16, §17, §18 win over §2, §11, §15).
3. `docs/PHASE2_SCHEMA_CHANGES.md` — what the database now contains.
4. `docs/IMPLEMENTATION_PROGRESS.md` — what is done and known follow-ups.

## 2. Before writing any code
1. `git status` — must be clean; create branch `feature/phase-3`.
2. Back up the DB, then: `npx prisma migrate status`. If only `20261020120000_phase2_workflow_alignment` is pending → `npx prisma migrate deploy`. If the DB has no migration history (built with `db push`) → STOP and ask me.
3. `npx prisma generate`, then `npm run typecheck` (must be 0 errors) and `node --import tsx --test "src/**/__tests__/*.test.ts"` (all pass). Run `npm run lint` once and save the output as the lint baseline (there are ~52 old problems; never add new ones).

## 3. Owner decisions you must respect (summary — details in the plan)
- Hierarchy: Super Admin → {Senior Exec Mgmt, Data Executive, Finance, MPD Head, Admin Head, AVP-QA, Production Head}; MPD Head → {Contractor Manager → Contractor Operator, Zonal Manager → {PHE Operator, MDO, Zonal Lab Attendant, Mobile Tester}}; Admin Head → Admin Operator; AVP-QA → QAE; Production Head → {Weighbridge, Production Reception}. Module: `src/backend/core/roles/`.
- A superior can do ALL work of every role below them (own scope only, e.g. Zonal Manager only own ZMCC). No reason prompt. Records store real user + `*_as_role` + `*_is_delegated` automatically.
- "If you can approve it, you can decide it": when a superior does subordinate work and an exception appears, he decides it on the same screen. Super Admin & Data Executive are outside these rules.
- Exceptions: Stage 1–3 → Zonal Manager; contractor dispatch → Contractor Manager (MPD Head can answer); Stage 4 → AVP-QA; new source / rejected-milk remarks → MPD Head. QA_MANAGER is retired (Phase 6). CONTRACTOR_MANAGER is kept.
- Only Data Executive + Super Admin can correct/edit records, and only they control devices (register/release/block, diary, alerts).
- Test & picture policy is a Super Admin matrix (test × point: compulsory/optional/off, rule apply/warn, photo required/optional/none, versioned). LR & Fat photos required everywhere except contractor dispatch; hand-written lab report photo at dispatch.
- Photos: live camera only (getUserMedia, NO file input/gallery); stamp band added BELOW the photo (employee ID, role, point, date/time, GPS, vehicle/token, photo ID) — never cover the image.
- Field users are low-literacy: the system does everything automatically (save, send, GPS, retries). No PIN/OTP/password changes for field users; logout hidden; shared station PCs use name card + 4-digit PIN. Nothing is deleted from a phone until the server confirms it. Activity diary ("black box") per device.
- ZMCC weighing is done by MDO / PHE Operator. ZMCC gate exit is removed. Business date of a fully rejected plant vehicle = time of last QA rejection.
- Simple English UI text, big touch targets (≥44px, field primaries 56px), status = colour + icon + word.

## 4. Phases (do in order; one PR/commit series per phase)
- P3 Guards & platform: `requireRoles` with ancestor expansion + `actingAs`; `actingContext` scope rules; non-delegable CORRECT/ADMINISTER; `writeAuditLog()` helper replacing direct auditLog.create; device registration + device sync key + `/api/sync/batch` (idempotent by client UUID, per-item ACK); sync engine for MOT/PHE/MDO/ZMCC lab/dispatch; new LiveCamera component + photo upload API (CapturedPhoto); test_point_policy read service + Super Admin matrix screen. Watch the known trap: `POST /api/dispatches` validates source only inside `if (role === 'ZMCC_LAB_ATTENDANT')` — expanding guards without `actingAs` would skip the scope check.
- P4a Stage 1 (MOT/MDO): decision-rule panel, policy-driven tests + photos, Zonal Manager review queue, shop REJECTED status, geofence check.
- P4b Stage 2 (ZMCC): composite/portion-wise portions, per-portion decisions, MDO/PHE first/second weight, per-portion tank receipts, HC approval, auto-close journey, area loss/gain, MPD remarks.
- P4c Stage 3 (dispatch): seals, photos, Submit vs Send Request (Zonal Manager / Contractor Manager), contractor dispatch page, server-side weighted 13 TS.
- P4d Stage 4 (plant): seal verification, AVP-QA routing, per-portion weighbridge + unloading, tanker-wash check, business-date fix (remove overwrite in gate-exit). Includes the deferred unique-constraint migrations (weight_ticket, zmcc_lab_result, zmcc_tank_receipt) with backfill.
- P5 Approval matrix + auto-escalation + notifications + one ApprovalInbox UI.
- P6 Retire QA_MANAGER (migration script, seed, routing, nav).
- P7 UI/design system (status tokens, StationShell everywhere, split 100KB files, MapLibre map, Control Center).
- P8 Android shell (Capacitor) for MOT background GPS + mock-location detection.

## 5. Subagent strategy (use the Task tool; pick the model by effort)
For EACH phase:
1. **Plan** — 1 `Plan` subagent (opus): read the plan section + code, list exact files/functions, split the phase into tasks whose file sets DO NOT overlap. Show me the task list before coding.
2. **Implement in parallel** — one subagent per task:
   - `haiku`: mechanical work (rename labels, add a role to lists, config/header edits, running checks, grep inventories).
   - `sonnet`: normal feature work in 1–4 files (a screen, an API route, a service function, tests).
   - `opus`: cross-cutting/risky work (auth guards & scope, schema/migrations, sync engine, anything touching money/quantities or many files).
   Each subagent gets: its exact file list (may edit ONLY those), the rules in §3 and §6, and must finish with typecheck + lint on its files + its tests.
3. **Verify** — 1 `haiku` subagent runs: `npm run typecheck`, lint vs baseline, all tests, `git diff --stat`, and checks no CRLF/LF churn.
4. **Review** — 1 `general-purpose` subagent (opus) reviews the whole phase diff for real defects (auth holes, scope bypass, data loss, React effect bugs, offline edge cases). Fix confirmed defects by resuming the agent that wrote the code.
5. Commit with a clear message, update `docs/IMPLEMENTATION_PROGRESS.md`, then tell me in simple words what changed and what I must test by hand. Wait for my OK before the next phase.

## 6. Engineering rules
- Never delete or rename DB columns without a backfill plan; migrations additive and idempotent where possible; never edit an already-applied migration.
- Keep each file's existing line endings (most files are CRLF). Keep code style (TS strict, 2 spaces, single quotes).
- Tests: `src/**/__tests__/*.test.ts` with `node:test`, run via `node --import tsx --test`. Add tests for every rule (decision rule table, canActAs/scope, weighted 13 TS, business date 07:59:59 vs 08:00:00, sync idempotency, logout never deletes unsent work).
- Server is the source of truth for every permission; never trust role from the client.
- Do not run `prisma db seed` or destructive commands on my real database without asking.
- If something in the plan is unclear or two rules conflict, ask me one short question instead of guessing.

Start now with section 2, then Phase 3 step 1 (Plan subagent). Reply in simple English.
