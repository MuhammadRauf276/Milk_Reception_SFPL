# Workflow Alignment Plan — Revised Raw Milk Collection Workflow

**Source:** `Revised _Raw_Milk_Collection_Website_Workflow.docx`, sections 1–9 and Figures 1–6.
**Codebase:** `C:\MilkReceptionApp` (Next.js + Prisma). Paths below are relative to the repo root.
**Prepared:** 19 Oct 2026.

**How it was prepared:** five analysis agents read the code, and the important findings were then checked by hand. Each agent used a model matched to the effort the job needed:

| Agent | Model | Job |
|---|---|---|
| Role inventory | Haiku | Mechanical search for every role reference |
| Stage 1–2 gap analysis | Sonnet | Compare stages 1–2 with the code |
| Stage 3–4 gap analysis | Sonnet | Compare stages 3–4 with the code |
| Hierarchy / delegation architecture | Opus (Plan) | Design the role hierarchy and delegation |
| Senior UI/UX audit | Opus | Review the screens as a senior designer |

---

## 0. Executive summary

| Area | Today | Target |
|---|---|---|
| Roles | 19 flat roles, each with a hand-written permission list | 19 roles in one hierarchy tree: **add MDO**, **retire QA Manager**, keep Contractor Manager (under MPD Head), and relabel 6 roles |
| Pictures | Photos are watermarked in the browser but never uploaded; the gallery can be used; only LR/Fat have a photo flag | Super Admin photo/test **policy matrix** per test × point; live camera only (no gallery); stamp band added **below** the photo; photos uploaded and kept offline until synced (§9) |
| Delegation (new owner rule) | Not implemented. Most checks are exact `role === 'X'` comparisons (about 100 sites in 45 files) | **A superior can do the work of every role below them** (transitively), within their own scope. Every action records the real user and the role they acted as |
| Decision rules (§3) | Each stage does it differently (checkbox / buttons / remarks box / modals). Picture rule is enforced only in the browser | One shared server evaluator and one shared `DecisionRulePanel` UI for all 4 stages |
| Exception approvers | Stage 2 and Stage 3 exceptions are routed to **MPD Head** (wrong). Stage 4 is routed to **QA Manager** (role removed) | Stages 1–3 go to the **Zonal Manager**. Stage 4 goes to **AVP-QA**. New sources and rejected-milk remarks go to the **MPD Head** |
| Portion-wise flow | Plant only. Weighbridge is per vehicle. ZMCC has no portions or weights | Composite or portion-wise at ZMCC lab, dispatch and plant. Weighing is **per accepted portion** |
| Missing features | No seal numbers, no tanker-wash check, no MDO, no HC approval, no Send Request to Zonal Manager on dispatch, no MPD remarks on rejected milk | All of these are added |
| Edit rights (§8) | Zonal Manager and MPD Head can correct records today | **Only Data Executive and Super Admin** can correct records. This right cannot be delegated |

---

## 1. Users / roles — what we ADD, CHANGE, REMOVE

Decision: **keep the role codes stored in the database exactly as they are; change only the labels shown to users.** `User.role` is a VARCHAR column, and the codes appear in about 150 code literals, in audit history, in JWTs and in notification recipient lists. Renaming the codes would add risk and give no benefit.

| Code (unchanged) | New label | Parent in hierarchy | Action |
|---|---|---|---|
| SUPER_ADMIN | Super Admin | — (root) | KEEP |
| EXECUTIVE_MANAGEMENT | Senior Executive Management | Super Admin | RELABEL |
| DATA_EXECUTIVE | Data Executive | Super Admin | KEEP. Only role besides Super Admin with correction rights |
| FINANCE_ACCOUNTS | Finance and Accounts | Super Admin | KEEP. Loses the right to review new sources (that moves to MPD Head) |
| HEAD_OF_MPD | MPD Head | Super Admin | KEEP. Gains new-source approval, source allocation, and remarks on rejected milk. **Loses** Stage 2 exception review and record correction |
| CONTRACTOR_MANAGER | Contractor Manager | MPD Head | **KEEP (owner decision, round 2)**. Approves contractor dispatch exceptions and can do Contractor Operator work |
| CONTRACTOR_OPERATOR | Contractor Operator | Contractor Manager | KEEP. Gets a real dispatch page (today it lands on a read-only dashboard) |
| ZMCC_MANAGER | **Zonal Manager** | MPD Head | RELABEL. Approves all Stage 1–3 exceptions, MDO routes, new shops and new HCs. Loses record correction |
| **MDO** | **MDO (Milk Development Officer)** | Zonal Manager | **ADD (new user)** |
| PHE_OPERATOR | PHE Operator | Zonal Manager | KEEP. Loses route creation, shop approval and MOT dispatch (these move to MDO / Zonal Manager) |
| ZMCC_LAB_ATTENDANT | **Zonal Lab Attendant** | Zonal Manager | RELABEL |
| MOT | Mobile Tester (MOT) | Zonal Manager | RELABEL |
| ADMIN_HEAD | Admin Head | Super Admin | KEEP |
| SECURITY_OPERATOR | **Admin Operator** | Admin Head | RELABEL. Gains the tanker-wash check |
| QA_HEAD | **AVP – Quality Assurance** | Super Admin | RELABEL. Becomes the Stage 4 exception approver |
| QA_LAB_ATTENDANT | **QAE – Reception Lab** | AVP-QA | RELABEL. Gains seal verification |
| PRODUCTION_HEAD | Production Head | Super Admin | KEEP |
| WEIGHBRIDGE_OPERATOR | Weighbridge Operator | Production Head | KEEP. Weighing becomes per portion |
| PRODUCTION_RECEPTION_OPERATOR | Production Reception Operator | Production Head | KEEP. Unloading becomes per portion |
| QA_MANAGER | — | — | **REMOVE (retire)**. Stage 4 now goes straight to AVP-QA |

**MDO permissions:**
- Current Route List.
- Add New Route. The route stays pending until the Zonal Manager approves it.
- Assign a route to a MOT.
- Approve new-shop requests from MOTs.
- Add new HC information at PHE. The HC stays pending until the Zonal Manager approves it.
- Scope: own ZMCC only.

> **Round 2 update:** only **QA_MANAGER** is retired. CONTRACTOR_MANAGER is kept (see the table above). Wherever this section says "both roles", read it as QA_MANAGER only; the CONTRACTOR_MANAGER file list below is now a list of places to **re-wire** (approver for contractor exceptions), not to delete.

**How the retired role is handled:**
- Move the code to a `RetiredRole` type and out of `CanonicalRole`.
- Every guard denies them. They are redirected to `/workspace-unavailable`.
- Their labels stay in the system (marked "retired") so old audit rows still display.

**Reassigning existing users:** run `scripts/migrate-retired-roles.ts`. It is dry-run by default, writes an audit row for each change, and **never gives anyone a higher role**.
- QA_MANAGER becomes QA_LAB_ATTENDANT, unless the owner chooses to promote someone to AVP-QA.
- CONTRACTOR_MANAGER becomes CONTRACTOR_OPERATOR.

**Files that break or need edits when the two roles are removed** (complete list from the inventory):
- `src/backend/core/types.ts`
- `src/backend/modules/access-control/rolePolicies.ts`
- `src/lib/user-assignment-policy.ts`
- `src/backend/modules/notifications/eventCatalog.ts`
- `src/backend/core/auth.ts`
- `src/lib/role-routing.ts`
- `src/backend/services/milkTestPolicyService.ts`
- `src/backend/services/escalation/escalationMatrix.ts`
- `src/backend/services/managementVehicleStageProjectionService.ts`
- `src/app/super-admin/{sop-rules,test-policies}/page.tsx`
- `src/app/api/super-admin/stage-policies-rules/route.ts`
- `src/app/api/qa-head/sop-rules/route.ts`
- `src/app/api/qa/manager/queue/route.ts`
- `src/app/api/management/reports/loss-reconciliation/route.ts`
- `src/app/api/dispatches/route.ts` (GET scope)
- `src/backend/services/operationalReadModelService.ts` (lines 724–1000)
- `src/frontend/modules/shared/navigation/roleNavConfig.ts`
- `prisma/seed.ts`
- `src/app/api/auth/dev-profiles/route.ts`
- `src/frontend/modules/auth/LoginPage.tsx`

---

## 2. Hierarchical delegation (owner rule; not in the workflow doc)

> A user above in the hierarchy can do the work of **any** user below them, at every level, because subordinates are sometimes unavailable.

```
Super Admin ─┬─ Senior Exec Mgmt
             ├─ Data Executive
             ├─ Finance & Accounts
             ├─ MPD Head ─┬─ Contractor Manager ── Contractor Operator
             │            └─ Zonal Manager ─┬─ PHE Operator
             │                              ├─ MDO
             │                              ├─ Zonal Lab Attendant
             │                              └─ Mobile Tester
             ├─ Admin Head ── Admin Operator
             ├─ AVP-QA ── QAE Reception Lab
             └─ Production Head ─┬─ Weighbridge Operator
                                 └─ Production Reception Operator
```

### 2.1 Who can act as whom

| Role | Can also do the work of |
|---|---|
| Super Admin | Everyone |
| MPD Head | Contractor Manager, Contractor Operator, Zonal Manager, PHE, MDO, Zonal Lab Attendant, MOT |
| Contractor Manager | Contractor Operator (own contractor only) |
| Zonal Manager | PHE, MDO, Zonal Lab Attendant, MOT (own ZMCC only) |
| Admin Head | Admin Operator |
| AVP-QA | QAE |
| Production Head | Weighbridge Operator, Production Reception Operator |
| Data Executive, Senior Executive Management, Finance, and all operators | Only their own work. They are leaves in the tree |

### 2.2 Implementation

**1. One source of truth: a new file `src/backend/core/roles/hierarchy.ts`.**
- It stores `ROLE_PARENT` as a map from each child role to its parent. Storing it this way makes cycles impossible.
- It exports `getDescendantRoles`, `getAncestorRoles`, `canActAs(actor, target)`, `expandToAncestors(roles)` and `pickActingRole`.
- Labels go in `roles/labels.ts`.

**2. Guards get delegation automatically.**
- `requireRoles(req, roles, { delegation: 'ancestors' | 'none' })` widens the allowed list to include all ancestors of the listed roles. It returns `{ user, actingAs }`.
- Inline `allowedRoles.includes(role)` checks change to `allowsRole(role, allowedRoles)`. This is a mechanical change in about 30 files.
- About 100 `role === 'X'` checks are converted one by one, each to one of three forms:
  - a permission check becomes `canActAs(role, 'X')`;
  - branching on role changes to switch on `actingAs` together with the record's source;
  - a correction check uses `isCorrectionAuthority()`, which is never delegated.
- ⚠ **Known trap.** `POST /api/dispatches` validates the source only inside `if (role === 'ZMCC_LAB_ATTENDANT')`. If the guard is widened without also passing `actingAs`, a Zonal Manager would skip source validation entirely. Every stage PR must be checked for this pattern.

**3. Scope never widens beyond what the user already has.**
- **Zonal Manager** acting as Lab Attendant can work only in their own ZMCC. Any other ZMCC returns `OUTSIDE_SCOPE`.
- **MPD Head and Super Admin** are system-wide, but every write must belong to a specific source taken from the record. The record's source type must also match the target role (ZMCC for ZMCC roles, CONTRACTOR for Contractor Operator).
- **Department heads** get their own department plus the departments of their descendants. This replaces the hard-coded rule `ADMIN_HEAD → 'Security'`, and fixes the department mismatch between Production Head and the Weighbridge Operator.
- **MOT work by a superior** is online-only in version 1, because the offline preparation token is bound to one user.

**4. Audit attribution.** One Prisma migration, `role_hierarchy_delegation_attribution`, adds these columns.
- `audit_log` gets four new columns:
  - `actor_role`
  - `performed_as_role`
  - `is_delegated`
  - `self_approved`
- Domain tables that record who did a step get a matching `*_as_role` column:
  - `MotShopCollection`
  - `ZmccMotArrival`
  - `ZmccLabSession`
  - `DispatchInfo`
  - `VisitPortion`
  - `GateLog`
  - `WeightTicket`
  - `UnloadingLog`
  - route, shop and area tables
  - `LocalSupplierRmrIssuance`
- A new `src/backend/core/audit.ts` `writeAuditLog()` replaces the 86 direct `auditLog.create` calls.

**5. No self-approval (segregation of duties).**
- If a superior did the subordinate's step, an exception from that step goes to **the parent of the superior's real role**.
  - Example: a Zonal Manager doing lab work. The exception goes to the MPD Head.
  - Example: AVP-QA doing QAE work. The exception goes to Super Admin.
- Decide endpoints also reject a decision when the decider is the same person as the performer.
- Super Admin has nobody above, so Super Admin can self-approve only with remarks of at least 20 characters. The record is flagged `self_approved` and a `SELF_APPROVAL_REVIEW` notification is sent.
- Corrections (`CORRECT`, `ADMINISTER`) can never be inherited by delegation.

**6. Approval routing.** A new `src/backend/services/escalation/approvalMatrix.ts` replaces `escalationMatrix.ts`. The old file is **currently unused**: nothing calls `getEscalationAuthority`.

| Approval kind | Approver | Notes |
|---|---|---|
| S1 shop exception, S2 portion exception, S3 ZMCC dispatch exception | Zonal Manager (same ZMCC) | |
| S3 contractor dispatch exception | Contractor Manager (same contractor) | MPD Head can answer as the level above |
| S1 new shop | MDO (or above) | |
| S1 MDO route, S2 new HC | Zonal Manager | Auto-approved when created by a Zonal Manager or anyone above |
| S4 portion exception | AVP-QA | |
| New source, source allocation, rejected-milk remarks (S2/S4) | MPD Head | |

- A user can decide an approval if `canActAs(user, approverRole)` is true and the record is within their scope. So the MPD Head covers an absent Zonal Manager automatically.

---

## 3. Stage-by-stage changes (what / where)

### Shared across all stages: decision rules (§3)

- **ADD** `src/backend/services/decision/decisionRule.ts`. It is a pure function:
  `evaluate({systemPass, personAccept, picturesRequired, picturesPresent, sealMatch?, remarks}) → PROCEED | REJECT | SEND_TO_APPROVER`, plus a `remarksRequired` flag.
- It is enforced on the **server**. Today the picture rule exists only in the browser, and photos are never uploaded.
- **ADD** persisted photo URLs. They go on the per-test or per-portion result rows of MOT, ZMCC lab, dispatch and plant.
- **ADD** UI component `frontend/modules/shared/decision/DecisionRulePanel` (see §4).

### Stage 1 — Area Milk Collection

| Step | Status | Change | Where |
|---|---|---|---|
| Route list / current routes | ✅ | Keep | `zmccMasterDataService.listRoutes`, `ZmccMasterDataWorkspace.tsx` |
| MDO adds route, Zonal Manager approves | Partial | **CHANGE** the role that triggers the pending state from PHE to MDO in `createRoute`. Remove PHE from route create/approve | `zmccMasterDataService.ts`, `PendingApprovalsPanel.tsx` |
| Assign route to MOT | ✅ but wrong roles | **CHANGE** the allow-list from Super Admin/ZM/PHE to MDO and above | `motCore.assignAndDispatchJourney`, `resolveMotAuth` |
| New shop request, then approval | Partial | **CHANGE** approvers to MDO/ZM and remove PHE. **ADD** a step that appends the approved shop to the MOT's active journey | `requestNewShop`, `approveShop`, `motJourneyStop` |
| RMR token, gross liters, source | Mostly ✅ | **CHANGE** source to be required (no silent fallback to the shop's source) | `motCore.submitShopCollection`, `app/mot/page.tsx` |
| Assigned test with picture | ❌ | **ADD** MOT tests from `MilkTestPolicyService` (`MOT_SHOP`). Today LR and Fat are hard-coded. Photo must be stored and enforced on the server | `motCore.ts`, `schema.prisma`, `app/mot/page.tsx` |
| New source → MPD Head | Conflicts (Finance reviews today) | **CHANGE** reviewer to MPD Head and update notification routing | `milkSourceService`, `api/finance/erp-requests`, `eventCatalog.ts` |
| Decision rules | Conflicts | **ADD** an explicit MOT Accept/Reject choice with remarks. **ADD** decision/review columns, a stop status `REJECTED` ("Shop Rejected"), and a Zonal Manager review endpoint and queue. **CHANGE** the summary to count only accepted shops. **REMOVE** the "Request Quality Exception" checkbox and the 422 hard-block | `motCore.ts`, `MotJourneyStop`, `MotShopCollection` |
| 13 TS auto | ✅ | Keep | `milkFormulas.computeCanonicalMilkMetrics` |
| Submit, then Next Shop or Return to PHE | Partial | A rejected shop also closes the stop | `submitShopCollection` |

### Stage 2 — HC/MC Reception at ZMCC

| Step | Status | Change | Where |
|---|---|---|---|
| PHE issues Raw Milk Token (MC or HC) | ✅ | Allow superiors via delegation | `zmccArrivalCore.submitMotArrival` / `submitLocalSupplierArrival` |
| New HC needs Zonal Manager approval | ❌ (an HC is active immediately) | **ADD** `approval_status`, `approved_by` and `approved_at` on `ZmccLocalSupplier`, plus approve/reject endpoints. Block arrivals from unapproved HCs. **ADD** an HC tab to the approvals panel | `zmccLocalSupplierService.ts`, `PendingApprovalsPanel.tsx` |
| Composite vs portion-wise test with picture | ❌ | **ADD** a `ZmccLabPortion` model. Results become per portion: `@@unique([portion_id,test_id])`. Composite = 1 portion. Server-side photo enforcement | `zmccLabService.ts`, `schema.prisma`, `ZmccLabWorkspace.tsx` |
| RMR token to HC and source name | Partial | Move source selection into the lab flow. Add a "request new source" button for the lab attendant | `zmccLabService.issueLocalSupplierRmr` |
| Per-portion rules, Zonal Manager exceptions | Partial / conflicts | **ADD** `reviewPortionException` for the Zonal Manager, separate from corrections. **CHANGE** UI text "Send to MPD Head" to "Send to Zonal Manager" (`ZmccLabWorkspace.tsx` L1647, L1648, L1718). **REMOVE** MPD Head from the review path | `zmccLabService.ts` |
| All portions rejected → vehicle rejected and journey closed | ❌ | **ADD** auto-close | `zmccLabService.completeSession` |
| Per accepted portion: First Weight → tank → Second Weight | ❌ | **ADD** first and second weight per portion, and a tank receipt per portion (`ZmccTankReceipt.lab_session_id @unique` changes to per portion) | `zmccTankService.ts`, `schema.prisma` |
| Net wt, gross L, 13 TS, Area (MOT) loss/gain | Partial | **CHANGE** loss to be stored at journey close, using accepted portions only. **ADD** `area_loss/gain` columns | `lossCalculationService.calculateTier1RouteLoss` |
| MPD Head remarks on MC rejection | ❌ | **ADD** a disposition remarks field, an endpoint, an MPD queue and a notification | new |

### Stage 3 — ZMCC/Contractor Dispatch

| Step | Status | Change | Where |
|---|---|---|---|
| Vehicle number + Raw Milk Dispatch Token | ✅ | Keep | `api/dispatches/start`, `DispatchVehicleSection.tsx` |
| Composite vs portion-wise | Partial | **ADD** an explicit `testMode`. COMPOSITE means exactly one portion | `lib/validations/dispatch.ts`, `DynamicDispatchForm.tsx` |
| Seal number per portion | ❌ | **ADD** `seal_number`, required and unique per visit | schema, `DispatchPortionEditor.tsx`, `api/dispatches` POST |
| Test picture and lab report picture | ❌ | **ADD** persisted URLs. Required for the Zonal Lab Attendant; optional for the Contractor | `DispatchLabResult`, portion |
| Submit vs **Send Request to Zonal Manager** | ❌ (always goes straight to `DISPATCHED`) | **ADD** status `PENDING_ZM_APPROVAL`, ZM decision fields and the endpoints `/api/dispatches/[id]/request-approval` and `/zm-decision`. "NO" reopens the form. **CHANGE** Submit to return 409 if any rule is violated or any field is missing. **CHANGE** the remarks label "Routes to MPD Head" (L1166) | `api/dispatches/**`, ZM dashboard |
| Contractor: same form, tests optional | Partial (API allows it; no page) | **ADD** a `/contractor/dispatch` page. **CHANGE** `/zmcc/dispatch` gate and routing | `app/zmcc/dispatch/page.tsx`, `role-routing.ts` |
| Auto gross L, 13 TS (weighted), tank remaining | Partial | **CHANGE** to compute weighted LR and Fat on the server; it currently trusts the payload. Show the remaining tank balance after submit | `api/dispatches/route.ts` |

### Stage 4 — Plant Reception

| Step | Status | Change | Where |
|---|---|---|---|
| Admin Operator gate token | ✅ | Relabel only | `api/security/gate-entry`, `SecurityGatewayWorkspace.tsx` |
| QAE composite or portion-wise | Partial | Read `testMode` from the dispatch | `QATestingSection.tsx` |
| QAE picture stored | ❌ | **ADD** `photo_url` on `PlantLabResult` | schema, `api/qa/**` |
| **Seal verification** | ❌ | **ADD** a per-portion seal input on the QA screen and a comparison on the server. A mismatch goes to the exception path | `QATestingSection.tsx`, QA complete route |
| Exception → **AVP-QA** | Conflicts (goes to QA Manager today) | **CHANGE** the queue and decision to `QA_HEAD`, `PLANT_QA_EXCEPTION_PENDING → ['QA_HEAD']`, and `QA_MANAGER_REVIEW → AVP_QA_REVIEW`. **REMOVE** `app/department/qa-manager` and the HOLD path | `api/qa/manager/queue`, `eventCatalog.ts`, `QADecisionModals.tsx` |
| Composite fail → whole vehicle rejected → Gate Exit | Partial | Make it an explicit rule, and add a test | `api/security/gate-exit` |
| **Per accepted portion** weigh → unload → weigh | Conflicts (per vehicle) | **CHANGE** `WeightTicket` from `visit_id @unique` to per portion. `api/scale/*` take a portion. Unloading loops over portions (today it only handles `acceptedPortions[0]`). **REMOVE** the `MULTI_SILO_ALLOCATION_REQUIRED` block | schema, `api/scale/*`, `ProductionUnloadingWorkspace.tsx`, `siloInventoryService.ts` |
| Business Date set once at first weight | Bug | **REMOVE** the overwrite in `api/security/gate-exit/route.ts` (L136: `operational_date: exitBusinessDate`). The 08:00 rule in `business-day.ts` is correct | gate-exit route |
| Weighted 13 TS (bigger portion counts more) | Conflicts (uses a simple mean) | **CHANGE** to weight by each portion's net weight | `vehicleQuantityService.ts`, `siloInventoryService.ts` |
| ZMCC loss/gain, Transit loss/gain | Partial (naming differs) | Map the workflow terms onto Tier 3 / Tier 4 and rename the labels | `lossCalculationService.ts`, `SupplyChainLossCard.tsx`, `MpdLossScreen.tsx` |
| **Tanker washed** before Gate Exit | ❌ | **ADD** `tanker_washed`, `washed_checked_by` and `washed_checked_at` on `GateLog`. Block exit until washed. A "Wash tanker" loop in the UI | `api/security/gate-exit`, `SecurityGatewayWorkspace.tsx` |
| MPD Head remarks on rejected portions | ❌ | **ADD** `mpd_disposition_remarks/_by/_at` on `VisitPortion`, plus a queue | MPD workspace |

### Edit access (§8)

**CHANGE** these correction paths to Data Executive and Super Admin only, and never delegated:
- `correctShopCollection`
- `correctMotArrival`
- `correctLocalSupplierArrival`
- `correctGateExit`
- `correctCompletedSession`
- `/api/zmcc/manager/correction-requests`

Zonal Manager **exception review** stays, but as its own function, separate from corrections.

---

## 4. UI/UX plan (senior designer review)

### 4.1 Top issues found

| # | Priority | Issue |
|---|---|---|
| 1 | P0 | Wrong approver text in the Lab screen and the Dispatch form |
| 2 | P0 | Four different decision UIs |
| 3 | P0 | No UI for ZMCC portions, seals, wash check, or per-portion weighing |
| 4 | P0 | Navigation is a chain of `role ===` checks. Several roles fall back to a single "Home" link |
| 5 | P1 | Very large single-file screens (ZmccArrivals 116 KB, ZmccLab 105 KB, MOT page 98 KB) |
| 6 | P1 | Only 2 pages use `StationShell` |
| 7 | P1 | 4,934 raw color classes. The brand primary red ≈ the destructive red, so "Submit" looks like "Reject" |
| 8 | P1 | Buttons and inputs are 36 px and text is 10–11 px. Too small for field use with gloves or in sunlight |
| 9 | P1 | No empty or offline states outside MOT. Errors are shown with `window.alert` |
| 10 | P2 | Not ready for Urdu or RTL |

### 4.2 Delegation UX (P0)

**"Working as" switcher in the header.**
- It lists only the user's descendant roles, with a waiting-count badge on each.
- The chosen role is kept per browser tab (`?as=`).
- On mobile it opens as a bottom sheet.

**Delegation banner.**
- A violet banner that cannot be dismissed: "ACTING AS ZONAL LAB ATTENDANT · ZMCC Sargodha".
- It has a [Return to my work] button.

**Navigation.**
- "My work" holds the user's own pages.
- "Team stations" holds one collapsible group per descendant role.
- Clicking a team-station page switches the acting role automatically.

**Submit confirmation.**
- The confirm dialog shows "Recorded by Ali Raza · Acting as Zonal Lab Attendant".
- The history row gets a "Delegated" chip.

**Self-approval guard.**
- An exception the user raised appears greyed out in their own inbox: "You raised this → routed to MPD Head".
- The Approve and Reject buttons are disabled on it.

### 4.3 `DecisionRulePanel` (one component for MOT, Lab, Dispatch, QAE)

- **Layout:** one card per portion. Each card shows the tests with ✓ or ✗, the photos, and the seal row (QAE only), then **SYSTEM RESULT**, then **YOUR DECISION**: two 56 px buttons, ✓ ACCEPT and ✗ REJECT.
- **States:** each state uses a colour plus an icon plus a word:

| State | Remarks |
|---|---|
| match-accept | Optional |
| match-reject | Required |
| mismatch → "Sent to {Approver}" | Required |
| photo-missing → primary action "Take picture now" | Required |
| seal-mismatch | Required |
| pending-approval | Locked |
| approved / rejected by manager | Approver's remarks are quoted |

- **Sticky action bar:**
  - When every portion matches the system: one primary button, e.g. "Submit & close shop" or "Submit — 2 accepted to weighbridge".
  - When any portion is an exception: the primary button becomes **"Send request to {Approver}"**, and a secondary button "Submit others now" sends the portions that match.
  - Dispatch mode: Submit is disabled with the reason shown, and Send Request becomes primary. For a Contractor, tests are optional.
- **Accessibility:** the decision buttons work as a radiogroup, live error announcements are read out, and remarks can be entered by voice.

### 4.4 One approval inbox pattern

The same `ApprovalInbox` serves the Zonal Manager, AVP-QA and MPD Head.

| Part | Behaviour |
|---|---|
| Layout | Desktop: list on the left, detail on the right. Mobile: full-screen card with sticky [✗ NO] / [✓ OKAY] buttons |
| Reason chips | Mismatch / Picture missing / Seal mismatch / Missing field / New route / New shop / New HC / New source |
| Waiting-time colours | Amber after 15 minutes, red after 60 minutes |
| Remarks | Required for every "NO" |
| Bulk actions | Allowed for master data only, never for quality decisions |

### 4.5 Screen changes per role

| Screen | KEEP | CHANGE / ADD | REMOVE |
|---|---|---|---|
| App shell | — | `StationShell` on every page; role switcher; banner; offline/sync bar for all stations; navigation built from the hierarchy (merge `SuperAdminSidebar`) | Hard-coded default-tab fix-ups in `HierarchicalNavDrawer` |
| MOT | Offline queue, camera, GPS | Full-screen steps on mobile: Token → Litres → Source → Tests → Decision; tests driven by policy; 48 px inputs; big sync status | "Physical/Commercial Milk Truth" jargon; exception checkbox |
| **MDO (new)** `/mdo` | — | Routes, Add Route (pending ZM), Assign Route to MOT, new-shop approvals, Add HC (pending ZM), My requests | — |
| PHE | Arrivals and tokens | Large MC / HC choice; HC search plus "Add new HC → needs ZM approval" | MOT dispatch and approvals from PHE navigation |
| Zonal Lab Attendant | — | Choose composite/portion-wise → panel per portion → weighing stepper per portion; dispatch adds Seal No. and Lab report photo, two buttons, and a "Returned by ZM" state | — |
| Contractor Operator | — | `/contractor/dispatch` (tests optional) | — |
| Zonal Manager | Overview, Live, Reconciliation | Move to `/zonal`, with **Inbox** as the landing tab; team stations | — |
| MPD Head | Executive screens | Inbox (new sources, allocation); "Rejected milk – remarks needed" queue | — |
| Admin Operator | Waiting / Inside / Ready-for-exit tabs | **Tanker washed? [YES clean] / [NO send to wash]** step before Gate Exit (button disabled until YES) | — |
| QAE | — | `DecisionRulePanel`; **seal verification row** per portion | "On Hold" tab; `window.confirm` |
| AVP-QA | — | Stage 4 inbox | — |
| Weighbridge | — | One row per accepted portion; Business Date chip on the first weight | — |
| Production Reception | — | Unloading per portion | — |
| QA Manager | — | — | `app/department/qa-manager` |
| Contractor Manager | — | Move useful reports to ZM/MPD first | `app/contractor/manager`, `PlantContractorManagerWorkspace.tsx`, `dashboard/contractor/*` |

### 4.6 Design system

**Status tokens.** Add these to `globals.css`, each with a fixed icon and word:

| Token | Colour | Icon |
|---|---|---|
| `--status-accepted` | green | ✓ |
| `--status-rejected` | red | ✗ |
| `--status-pending` | violet | ⏱ |
| `--status-exception` | amber | ⚠ |
| `--delegation` | unique violet | — |

**Primary colour.** Change `--primary` to dark navy. Keep the brand red for the logo and accents only.

**Sizes.**

| Element | Size |
|---|---|
| Buttons | 44 px (field primary buttons 56 px) |
| Inputs | 48 px on mobile |
| Text | Minimum 12 px; 16 px on mobile field screens |

**Lint rules.**
- Ban raw palette classes such as `emerald-500`.
- Ban `.role === '...'` outside the roles module.

**New components.**

| Priority | Components |
|---|---|
| P0 | `DecisionRulePanel`, `PortionCard`, `ApprovalInbox`, `RoleSwitcher`, `DelegationBanner`, `RecordedByChip`, `StatusBadge`, `SealCheckRow`, `PortionStepper` |
| P1 | `OfflineSyncBar`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `StickyActionBar`, `PhotoSlot`, `BusinessDateChip` |
| P2 | `DataTable`; Urdu / RTL via `next-intl` |

---

## 5. Removal list (consolidated)

| Remove | Why | Status |
|---|---|---|
| `QA_MANAGER` role, `app/department/qa-manager`, QA HOLD/resume flow | AVP-QA decides Stage 4 directly | Confirmed by the workflow |
| ~~`CONTRACTOR_MANAGER` role~~ | **Kept (round 2).** Its dashboards stay and gain an exception inbox | — |
| `escalationMatrix.ts` | Unused; replaced by `approvalMatrix.ts` | Confirmed |
| MPD Head as reviewer of ZMCC exceptions (UI text plus the `correctCompletedSession` pending path) | Workflow says Zonal Manager | Confirmed |
| PHE rights to create routes, approve shops and dispatch MOT journeys | Moved to MDO / Zonal Manager | Confirmed |
| Business-date overwrite at gate exit | Business date is set once, at the first weight | Confirmed bug |
| Single-portion shortcuts and the multi-silo block in `siloInventoryService.ts` | Weighing becomes per portion | Confirmed |
| `SecurityManager.tsx` | Not imported anywhere | Confirmed |
| Finance / Executive Management review of new sources | MPD Head owns new sources | Confirmed |
| ZMCC Contractor Arrival (`ZmccContractorArrival`, `submitContractorArrival`) | Stage 2 covers only MC and HC | ⚠ Owner to confirm |
| ZMCC gate exit for MOT/HC arrivals (`recordGateExit`) | Stage 2 ends with "journey closed" | ⚠ Owner to confirm |
| MOT "skip stop" | The workflow has only accept or reject at a shop | ⚠ Owner to confirm |
| Central correction-request desk | Corrections are limited to Data Executive / Super Admin | ⚠ Keep it, restricted to those two roles, unless the owner wants direct edits only |

---

## 6. Phased rollout

| Phase | Content | Risk |
|---|---|---|
| **P0** | Owner sign-off on the open questions (§7) | — |
| **P1** | Hierarchy module, labels, MDO role code, vitest setup. No change in behaviour | Low |
| **P2** | Prisma migration: audit attribution, `*_as_role` columns, portions, seals, photos, wash flag, ZM approval fields, per-portion weight tickets, MPD remarks. Add the `writeAuditLog` helper | Low–Medium |
| **P3** | Guard infrastructure: `requireRoles` with delegation, `actingContext`, scope rules, the non-delegable `CORRECT` capability | Medium |
| **P4a** | Stage 1: MOT/MDO decision rules, tests with photos, ZM review queue, route/shop approvals | High |
| **P4b** | Stage 2: ZMCC portions, weights, per-portion tank receipts, HC approval, auto-close, area loss, MPD remarks | High |
| **P4c** | Stage 3: seals, photos, Send Request to Zonal Manager, contractor dispatch page, weighted 13 TS on the server | High |
| **P4d** | Stage 4: seal verification, AVP-QA routing, per-portion weighbridge and unloading, wash check, business-date fix | High |
| **P5** | `approvalMatrix`, segregation-of-duties rules, notifications, the shared inbox | Medium |
| **P6** | Migrate users off the retired roles, update seed and dev profiles, routing, navigation, delete the removed screens | Medium |
| **P7** | UI polish: tokens, sizes, `StationShell` everywhere, splitting the large files, empty and offline states, lint rules | Low |

The UI components `DecisionRulePanel`, `ApprovalInbox`, `RoleSwitcher` and `DelegationBanner` are built in **P3/P4a** and reused in the later stages.

**Tests to add (vitest).**
- Hierarchy integrity: a single root and no cycles.
- A `canActAs` table covering every role pair. Examples:
  - Zonal Manager → Contractor Operator = false.
  - Admin Head → QAE = false.
  - Data Executive is a leaf.
- `expandToAncestors`.
- `actingContext` scope cases: `OUTSIDE_SCOPE` and `SOURCE_TYPE_MISMATCH`.
- Only Data Executive and Super Admin ever hold `CORRECT`.
- `resolveApprover` segregation-of-duties cases.
- The decision-rule evaluator, against every row of the §3 table.
- Weighted 13 TS.
- The business date at 07:59:59 and at 08:00:00.

---

## 7. Open questions for the product owner

> **All answered — see §8.**

1. **Figure 6 lines.** The lines Zonal Manager→PHE and Zonal Manager→Mobile Tester pass behind other boxes. Is the reading in §2 correct? It assumes Contractor Operator is under MPD Head and Admin Operator is under Admin Head only.
2. **Contractor dispatch exceptions.** A contractor source has no Zonal Manager. Proposal: if a contractor dispatch ever needs approval, it goes to the **MPD Head**.
3. **Who weighs at ZMCC** (Stage 2: First and Second Weight)? The workflow names no role. Proposal: the **Zonal Lab Attendant**.
4. **Super Admin self-approval.** Should it be allowed with remarks and a flag, or escalated to someone else?
5. **Retired-role users.** Confirm each person's new role. Should anyone become AVP-QA?
6. **Removals marked ⚠ in §5.** Confirm: ZMCC contractor arrival, ZMCC gate exit, MOT skip stop, the correction desk, and the contractor analytics dashboards.
7. **RMR token order at ZMCC.** Issue it before the decision (as the workflow states) or after acceptance (as the code does today)?
8. **Rejected-only vehicles.** They never get a first weight. Which business date should they carry?

---

## 8. Decisions — round 2 (owner answers, 19 Oct 2026)

These answers **override** anything above that disagrees.

| # | Question | Decision |
|---|---|---|
| 1 | Are PHE Operator and Mobile Tester under the Zonal Manager? | **Yes.** Hierarchy in §2 confirmed |
| 2 | Contractor dispatch rules | Super Admin decides **per test and per point** whether the test is compulsory and whether the system rule applies (§9.1). At contractor dispatch, if a compulsory test is missing or a rule-checked value fails, the operator must **Send Request to Contractor Manager**; the MPD Head (level above) can also answer. If the rule is switched off at that point, only a warning is shown |
| 3 | Who weighs at ZMCC (Stage 2 First/Second Weight)? | **MDO or PHE Operator** (and anyone above them by delegation) |
| 4 | Retired roles | **QA Manager removed. Contractor Manager kept**, placed under MPD Head, above Contractor Operator |
| 5 | Pictures | See §9. Super Admin controls where a picture is required. LR and Fat pictures are compulsory at every point **except contractor dispatch to plant**. The dispatch also sends a picture of the hand-written lab report. Camera only, never the gallery. Stamp shows user ID, point, date/time — and must **not cover the image**, because results are read by zooming into the photo |
| 6 | Delegation UI | Every superior gets the **"Team stations"** screens of all roles below them (§4.2) — required, not optional |
| 7 | Platform | One **Progressive Web App** for everyone, installable on phones and PCs, working **offline at MOT and ZMCC** level (§10) |
| 8 | ZMCC gate exit | **Remove.** Stage 2 ends with "journey closed" |
| 9 | Items left to my judgement | See below |

**Decisions taken on the owner's behalf ("whatever is best"):**

| Item | Decision | Reason |
|---|---|---|
| Super Admin self-approval | Allowed **with mandatory remarks**; record flagged `self_approved`; listed in an audit report for the Data Executive | Nobody is above the Super Admin; the flag keeps it visible |
| Contractor arrival at ZMCC | **Remove** | Stage 2 covers MC and HC only; contractors only dispatch to the plant |
| MOT skip shop | **Keep, renamed "Shop not visited"** with a required reason (shop closed, no milk, road blocked) | Real field cases; otherwise the MOT cannot close the route |
| Correction request desk | **Keep**, but only Data Executive / Super Admin can apply a correction | Gives a request trail and audit; matches workflow §8 |
| RMR token at ZMCC | Issued **after acceptance** (current behaviour) | Rejected milk never receives a reception token |
| Business date of a fully rejected plant vehicle | **Time of the last QA rejection**, same 08:00 rule | It is the moment the vehicle's result is final; gate exit can be hours later |

---

## 9. Test & picture policy (new — Super Admin controlled)

### 9.1 Policy matrix

Extend the existing `MilkTestPolicy` / `LabTest.isPhotoRequired` into one matrix that the **Super Admin** edits in Stage Policies & Rules:

Rows = tests (LR, Fat, SNF, adulterants…) plus document items such as **"Lab report (hand-written)"**.
Columns = testing points:

| Point code | Where |
|---|---|
| `MOT_SHOP` | Stage 1, shop |
| `ZMCC_LAB_MC` / `ZMCC_LAB_HC` | Stage 2, ZMCC lab |
| `ZMCC_DISPATCH` | Stage 3, Zonal Lab Attendant |
| `CONTRACTOR_DISPATCH` | Stage 3, contractor |
| `PLANT_QA` | Stage 4, QAE |

Each cell has three settings:

| Setting | Values | Effect |
|---|---|---|
| Test | Compulsory / Optional / Off | Compulsory and missing → exception path |
| System rule | Apply / Warn only | Apply → rule failure goes to the approver. Warn only → amber warning, no approval |
| Picture | Required / Optional / None | Required and missing → exception path |

**Default values (seeded):**

| | MOT_SHOP | ZMCC_LAB | ZMCC_DISPATCH | CONTRACTOR_DISPATCH | PLANT_QA |
|---|---|---|---|---|---|
| LR picture | Required | Required | Required | **Optional** | Required |
| Fat picture | Required | Required | Required | **Optional** | Required |
| Lab report picture | — | — | Required | Required | — |
| Contractor tests | — | — | — | Compulsory, rule Apply | — |

**Rules for changes:**
- Every change is versioned (`effective_from`, `changed_by`, reason). A record always uses the policy version that was active when it was started, so old records never become "invalid".
- Adding a new test asks the Super Admin to fill its column for every point before it goes live.
- Only Super Admin edits the matrix (Data Executive can view).

**Code:** `milkTestPolicyService.ts`, `MilkTestPolicyWorkspace.tsx`, `UnifiedStagePoliciesRulesWorkspace.tsx`, `LabTest`, new `TestPointPolicy` table (test_id, point, test_mode, rule_mode, photo_mode, version). The shared `decisionRule.evaluate()` (§3) reads this policy.

### 9.2 Camera only — no gallery

- **Today:** `src/components/camera/LiveCameraCapture.tsx` uses `<input type="file" capture="environment">`. On many Android phones and on every PC this still lets the user **pick a gallery file**. It must be replaced.
- **New:** a live camera view using `getUserMedia` (back camera on phones, webcam on PCs). The user presses Capture; the frame is taken from the live video. There is no file input anywhere in the app. A lint rule bans `type="file"` for images.
- If the device has no camera or permission is denied, the screen says so and the record goes to the exception path as "picture missing" — never an upload.

### 9.3 Stamp (proof of who, where, when)

The stamp is drawn on a **band added below the photo** (the canvas is made taller). Nothing is painted over the picture, so corners and test readings stay clear for zooming. The current code paints dark bars over the top and bottom of the photo — this changes.

```
┌─────────────────────────────────────┐
│                                     │
│          (photo, untouched)         │
│                                     │
├─────────────────────────────────────┤
│ EMP-0142 · Zonal Lab Attendant      │  ← user ID + role (+ "acting as" if delegated)
│ ZMCC Hasilpur · Dispatch · Portion 2 · LR │  ← point
│ 19-10-2026 14:32:07 PKT · 30.12N 71.45E ±8m │  ← date/time + GPS
│ TK-4471 · Token 55120 · ID 7F3A-91C2 · OFFLINE │  ← vehicle, token, photo ID
└─────────────────────────────────────┘
```

- **Privacy:** the stamp shows the **user ID / employee code**, not the full name. The name is linked in the database for anyone authorised.
- **Tamper evidence (server side):** each photo stores capture ID, SHA-256 hash, device time, server receive time, GPS, user, acting role, policy version. Re-use of the same image (same hash) on another record is flagged. If device time and server time differ by more than 10 minutes, the record shows a "clock mismatch" warning.
- **Quality:** test photos keep up to 1920 px on the long side (JPEG ≈ 0.85) so readings can be zoomed; document photos (lab report) the same.
- **Storage:** photos are uploaded to server file storage, not kept as data-URLs in the database (today they are never uploaded at all). Path pattern: `/photos/{yyyy}/{mm}/{point}/{capture_id}.jpg`.

---

## 10. Progressive Web App & offline (MOT and ZMCC)

- **One PWA** for all roles: installable on Android phones and Windows PCs, same login, same screens adapted to size.
- **Offline today:** only the MOT page (`frontend/modules/mot/offlineStore.ts`, `lib/offline/photoStore.ts`).
- **Offline target:** MOT, PHE Operator, MDO, Zonal Lab Attendant, ZMCC dispatch, and superiors working those stations.
- **How:**
  - Service worker caches the app shell and master data (routes, shops, sources, test policy, tanks) with a "last synced" time.
  - Every write gets a client UUID; the server is idempotent on that UUID, so a retried upload never creates duplicates.
  - Photos queue in IndexedDB with their stamp and hash; a sync bar shows "3 records · 5 photos waiting".
  - Token numbers are validated against the downloaded paper-reference ranges offline and re-checked on sync; a conflict lands in an "Needs attention" list.
  - ZMCC tank balance shown offline is marked "estimated" until synced.
  - **Approvals need a connection.** A record that needs Zonal Manager / Contractor Manager / AVP-QA approval is queued as "Request pending upload" and reaches the approver when the device is back online.
  - Delegated MOT work stays online-only in version 1 (the offline token is bound to one user).
- **Plant stations** (QAE, weighbridge, production, Admin Operator) are online-first, but photo capture and form drafts survive a short network drop.

### Rollout impact
- **P2** schema gains: `TestPointPolicy`, photo table (`capture_id`, hash, times, GPS, user, acting role, policy version, file path), `client_uuid` columns for idempotency.
- **P3** adds: new `LiveCamera` component, photo upload API, service-worker extension for ZMCC stations.
- **P7** adds: Super Admin policy-matrix screen polish.

---

## 11. Delegation — honest assessment and safeguards

**Verdict:** letting a superior do the work of the roles below is good **as a backup**, and it is standard in ERPs (SAP "substitutes", Oracle "proxy users"). It becomes a problem if it is used every day without controls.

| Risk | What can go wrong | Safeguard in this plan |
|---|---|---|
| Same person makes and approves | MPD Head enters a lab result and approves its own exception | Exception goes to the level above the real person (§2.2-5) |
| Physical work done remotely | MPD Head "records" a test at a ZMCC 200 km away | Live camera + GPS stamp on required photos; MOT shop submit must be inside the shop geofence (§13) |
| Hidden staffing gaps | Seniors silently do junior work for weeks | "Delegated actions" report per person/role/week on the Super Admin and MPD Head dashboards |
| Bigger damage if a senior account is stolen | One login can do everything below | Two-step login (OTP) for Zonal Manager and above; device list with remote logout |
| Seniors' time wasted on routine screens | — | Team stations stay collapsed; own inbox is the landing page |

**Recommended rule (zero-friction, owner decision round 3):** no reason prompt, no extra step for anyone.

- **Every superior can open any station below them and work immediately** — same screens, same buttons as the subordinate.
- **The system records it automatically:** each record stores the real user and the role they acted as (`performed_as_role`, `is_delegated`). The only visible sign is a small "Covered by Ali Raza (MPD Head)" chip on the record and in history.
- **Helpful, non-blocking hint:** when a superior opens a station, a one-line note shows who is on duty there ("Usman — Zonal Lab Attendant — active 5 min ago"). It never blocks the work; it only avoids two people doing the same entry.
- **Control comes from the system, not from the user:**
  - no self-approval (exception goes one level above the real person);
  - live camera + GPS stamp on required photos and the shop geofence prove physical presence;
  - one-time-passcode login for Zonal Manager and above;
  - weekly "Covered work" report (who covered which role, how often, where) on the Super Admin and MPD Head dashboards.
- **Super Admin options (optional, in the Control Center §12):** switch "can be covered by superior" off for a role, or set planned covers for leave. Neither is required for day-to-day use.

---

## 12. Super Admin Control Center (ERP-style configuration)

All settings are versioned (who, when, why, effective date) and every change is in the audit log. Critical settings (marked ★) use **maker–checker**: a Super Admin change waits for a second Super Admin or the Data Executive to confirm.

| # | Module | What the Super Admin controls (checkboxes / tables) |
|---|---|---|
| 1 | Users & devices | Create/deactivate users, reset password, assign ZMCC/contractor/department, two-step login on/off per role, see each user's devices and app version, force logout |
| 2 | Hierarchy & delegation ★ | Tree view of roles; per role "can be covered by superior"; optional planned covers for leave |
| 3 | Permission matrix ★ | Role × action checkboxes (view / create / submit / approve / export) per module |
| 4 | Test & picture policy ★ | Test × point matrix: compulsory, rule apply/warn, picture required (§9.1) |
| 5 | SOP rule limits ★ | Min/max per test per point and source type, with effective date |
| 6 | Approval & escalation | Approver per exception type; **auto-escalate if not answered** in N minutes to the next level (solves "approver not available"); reminder times |
| 7 | Master data | ZMCCs, routes, shops (with GPS point), HCs, sources (SFPL ERP codes), tanks, silos, vehicles, contractors |
| 8 | Token books & number series | Paper token ranges per station, RMR / dispatch token series, duplicate checks |
| 9 | Business rules ★ | Business-date cutoff (08:00), loss/gain tolerance per stage, alert thresholds |
| 10 | GPS & tracking | Tracking interval, accuracy limit, shop geofence radius, offline retention, mock-location policy (§13) |
| 11 | Photo settings | Max resolution, stamp fields, clock-mismatch limit |
| 12 | Offline settings | Which stations may work offline, max hours offline before forced sync |
| 13 | Notifications | Per event: in-app / push / WhatsApp / SMS, recipients by role |
| 14 | Audit & reports | Full audit log, delegated actions, self-approvals, config change history, export to Excel |
| 15 | System health | Sync queues per device, failed uploads, storage use, backups, data retention |
| 16 | Language | English / Urdu labels |

Today several of these exist as separate pages (`super-admin/users`, `lab-tests`, `sop-rules`, `test-policies`, `silos`, `procurement-sources`, `zmcc-master-data`, `notification-devices`, `audit`, `settings`). The Control Center groups them under one navigation with the same table/checkbox pattern, and adds modules 2, 3, 6, 8–12 and 15.

---

## 13. GPS tracking and live map (MOT)

### 13.1 Why the map looks old today (found in code)

| Problem | Where | Effect |
|---|---|---|
| Accepts cached positions up to **10–15 minutes old** | `src/lib/gps.ts` `acquireRobustGps` stage 1 (`maximumAge: 10 min`) and stage 3 (`15 min`) | The "current" point is often where the MOT was minutes ago |
| Stores **now** instead of the GPS fix time | `app/mot/page.tsx` ~L511: `device_recorded_at: new Date().toISOString()` | Old positions are saved as if fresh, so nobody can tell they are stale |
| Records with `setInterval` every 60 s | `app/mot/page.tsx` ~L506 | When the screen is off or the app is in the background, Android pauses the browser, so the trail has gaps |
| No real map | `frontend/modules/mot/ManagerJourneyMap.tsx` draws lines on a blank SVG grid | No roads, no place names, no satellite view |

### 13.2 Solution

**Step 1 — fix the data (quick, PWA only):**
- One continuous `watchPosition` stream with `maximumAge: 0` and high accuracy while a journey is active.
- Save the GPS fix's own time (`position.timestamp`), plus accuracy, speed, heading, battery level and an "online/offline" flag.
- Drop points worse than the accuracy limit (default 50 m) or older than 30 s.
- Save a point when the MOT moves more than 25 m, or every 2 minutes when standing still.
- Show "Last GPS fix: 3 min ago" on the MOT screen and on the manager map; grey out the marker when stale.

**Step 2 — real map:**
- **MapLibre GL JS** (free, open source) with **OpenStreetMap** street tiles; optional satellite layer (MapTiler or similar, paid per use).
- Offline: pre-download the map area of each ZMCC's routes (PMTiles file) to the device, so the MOT sees the map without internet.
- Alternative: Google Maps — best street detail in Pakistan, but needs internet, has per-load cost, and its terms do not allow offline tile storage.

**Step 3 — complete tracking (screen off / background):**
- A browser PWA **cannot** track reliably when the phone screen is off; Android suspends it. This is a platform limit, not a bug.
- For complete tracking, ship the **same app inside a thin Android shell (Capacitor)** for MOTs only, with a background-location plugin:
  - runs as a foreground service with a permanent notification "Route tracking on" (required by Android);
  - stores points in on-device storage when offline and uploads later;
  - **detects fake-GPS apps** (mock location), a common fraud;
  - reports GPS switched off and low battery.
- Other roles keep the normal PWA.

### 13.3 Map features (manager / MPD Head / Super Admin)

| Feature | Description |
|---|---|
| Live fleet | All MOTs on the map, colour by freshness (live / 5–15 min / stale / offline) |
| Trail & playback | Route line for the day with a time slider; offline gaps drawn dashed |
| Shop pins | Visited (green), rejected (red), not visited (grey), pending (amber) |
| Shop geofence check | Shop submit is allowed only within the radius set in §12 (default 100 m); outside → exception "Submitted away from shop" to the Zonal Manager |
| Stop detection | Stops longer than 3 min shown; stops not at a shop flagged |
| Route deviation | Distance off the planned route; km driven per journey |
| Alerts | GPS off, mock location, no signal > 30 min, shop skipped |
| Shop location capture | First approved visit sets the shop's GPS point; MDO can verify or move it |

### 13.4 Code changes

- `src/lib/gps.ts` — replace stage-1/3 cached reads during journeys; return fix time and accuracy.
- `src/app/mot/page.tsx` — single watch stream, distance/time filter, real fix timestamp, stale badge.
- `prisma/schema.prisma` `MotJourneyLocation` — add `speed`, `heading`, `battery_pct`, `is_mock`, `was_offline`, `provider` (web / native).
- `ManagerJourneyMap.tsx`, `MpdFleetRadarScreen.tsx` — rebuild on MapLibre.
- New `ZmccShop.geofence_radius_m`, shop `latitude/longitude` verified flag.
- New Android shell project (`/android`, Capacitor) — phase P8.

### Rollout additions

| Phase | Content |
|---|---|
| P1 (with hierarchy) | GPS data fix (§13.2 step 1) — small change, big gain |
| P5 | Approval auto-escalation (§12 module 6) |
| P7 | Control Center navigation and new modules; MapLibre map |
| P8 | Android shell for MOT with background tracking and mock-location detection |


---

## 14. Simplified exception rule (owner decision, round 4) — overrides §2.2-5, §8 and §11

**Rule: "If you can approve it, you can decide it."**

- When a superior does a subordinate's work and an exception appears (mismatch, missing picture, seal mismatch, rule failure), **the superior decides it immediately on the same screen**. Nothing is sent upward, nobody waits.
  - Example: Zonal Manager does the lab test, the result is against the rule → the Zonal Manager presses OKAY or NO in the same form. Done.
  - Example: MPD Head does contractor dispatch with a missing test → MPD Head decides it directly.
- **No extra fields.** The remarks box is the one §3 already requires for any mismatch — no additional reason, no second approval.
- The record is tagged automatically "Decided by Zonal Manager (covered work)" so it is visible in history and in the weekly Covered-work report. Nobody has to review it.
- **Super Admin and Data Executive are outside these rules:** no tags, no reports, no escalation for their actions (normal audit log only).
- Normal case is unchanged: when the subordinate does the work, the exception goes to the approver as before (Zonal Manager / Contractor Manager / AVP-QA).

**Removed from the plan for simplicity:**
- Escalating a superior's own exception one level up.
- `self_approved` flag and the `SELF_APPROVAL_REVIEW` notification.
- Super Admin self-approval remarks rule and Data Executive review list.

**Kept (all automatic, zero user effort):** live camera + GPS stamp, shop geofence, one-time-passcode login for Zonal Manager and above, `performed_as_role` on every record.

---

## 15. Security hardening and other gaps (round 5)

### 15.1 Security — found in code

| # | Pri | Finding | Fix |
|---|---|---|---|
| S1 | P0 | No security headers (no CSP, X-Frame-Options, HSTS) — `next.config.js` sets none | Add headers in `next.config.js`: CSP (self + map tiles), `frame-ancestors 'none'`, HSTS, `nosniff`, Referrer-Policy, Permissions-Policy allowing only camera + geolocation on self |
| S2 | P0 | Login rate limit is **in memory** (`src/lib/rate-limit.ts`) and only on login; lost on restart | Store failures in the DB; lock account for 15 min after 5 failures; also rate-limit password reset, photo upload and sync APIs |
| S3 | P0 | Only a password, min 8 characters, no first-login change (`api/super-admin/users/route.ts` L133) | Force password change at first login and after admin reset; block common passwords; one-time code (SMS/WhatsApp) for Zonal Manager and above, Super Admin, Data Executive |
| S4 | P0 | Simple seed / dev passwords (`prisma/seed.ts`, `reset-dev-login-passwords.ts`); dev one-click login cards exist | Seed must never run in production; dev login hard-disabled when `NODE_ENV=production` (keep the existing guard, add a startup check that fails if the flag is on in production) |
| S5 | P1 | JWT session cookie is `secure` only in production, `sameSite: lax` | Keep `httpOnly`; use `sameSite: strict` for the session; short session (12 h) with silent refresh; **server-side session list** so Super Admin can log out a device or a stolen phone immediately |
| S6 | P1 | WhatsApp gateway uses Baileys (unofficial WhatsApp Web library); session keys in `data/` | Keep `data/` out of backups shared outside IT; plan to move to the official WhatsApp Business API (unofficial numbers can be banned without warning) |
| S7 | P1 | Photos: none uploaded yet | Store outside the web root; serve only through an authorised API with short signed links; check file type and size on the server |

### 15.2 Security — to add

- **Lost/stolen phone:** remote logout, offline data on the phone encrypted and wiped on remote logout; offline login allowed only for the last user of that device and only for N hours (Control Center §12).
- **Device registration:** MOT/ZMCC phones registered by the Super Admin; unknown devices need approval before working offline.
- **Least privilege:** every API checks role **and** ZMCC/contractor scope on the server (the delegation work in §2 does this centrally).
- **Audit log is append-only:** no update/delete on `audit_log` at the database level (DB trigger or separate DB user without UPDATE/DELETE).
- **Database:** app uses a DB user without schema rights; nightly encrypted backups kept off-site for 30 days; monthly restore test.
- **Secrets:** `JWT_SECRET`, `CRON_SECRET`, `WHATSAPP_GATEWAY_SECRET` long random values, different per environment, rotated yearly; `.env` never shared (it is already in `.gitignore`).
- **HTTPS everywhere**, including the local plant/ZMCC network (needed anyway: browsers allow camera and GPS only on HTTPS).
- **Dependency checks:** `npm audit` in CI; update Next.js monthly.
- **Login alerts:** notify the user and Super Admin on login from a new device or outside working hours (configurable).

### 15.3 Other gaps (not security)

| Area | Missing | Suggestion |
|---|---|---|
| Testing | No test runner in the repo | vitest for rules/calculations; Playwright for the 4 stage flows |
| Environments | Single environment | Separate **staging** with copy of master data for training and testing updates |
| Monitoring | No error tracking | Error tracking (e.g. Sentry self-hosted) + uptime check + alert to IT on WhatsApp |
| Time | Device clocks can be wrong | Use server time for business date; show warning when device clock differs > 10 min |
| ERP | SFPL ERP sources are mapped by hand | Daily export (Excel/CSV or API) of accepted milk per source and business date for ERP posting |
| Data retention | Not defined | Keep records 7 years (finance), GPS points 1 year, photos 2 years (configurable) |
| Training | — | Short in-app guide per station (3–5 screens), Urdu labels, and a "practice mode" on staging |
| Support | — | "Report a problem" button that sends screen name, device, app version and sync status to IT |
| Updates | PWA may keep old version | Version check on start; force refresh when a new version is required |

---

## 16. "My data must never be lost" — offline & logout safety (round 6)

### 16.1 What happens today (found in code) — ⚠ data loss risk

| Scenario | Today | Result |
|---|---|---|
| MOT presses **Logout** with unsent shops | `frontend/modules/auth/logout.ts` calls `clearMotOfflineWorkspace()`, which **clears `collection_queue`, `gps_queue`, `skip_queue`, drafts** (`offlineStore.ts` L332–338). Logout runs even when offline (the network error is ignored) | **Unsent shop collections and GPS are deleted permanently** |
| Session expires while offline, then the phone reconnects | Sync gets 401 → page sends user to `/login` (`app/mot/page.tsx` L539–560) | Data stays but nothing tells the user it is waiting; if they then logout, it is deleted |
| Phone low on storage | No `navigator.storage.persist()` anywhere | Browser may silently remove offline data on cheap phones |
| User clears Chrome data / uninstalls | — | Everything unsent is lost |
| Photos | Separate `photoStore`, not linked to the queue | Photo and record can get separated |

### 16.2 Golden rule

> **Nothing is deleted from the phone until the server confirms it has saved it.** Logout, session expiry, a new user, or closing the app never delete unsent work.

### 16.3 Solution

1. **Safe logout**
   - If anything is unsent, Logout shows one big screen (icons + Urdu):
     `⚠ 5 shops and 3 photos are not sent yet` → **[Send now]** (green, big) · **[Keep on phone and logout]**.
   - There is **no "delete" option** for the user, ever.
   - Unsent work stays on the phone, encrypted, labelled with the user who made it, and keeps uploading in the background.
   - For field roles (MOT, PHE, MDO, Zonal Lab Attendant) the Logout button moves inside the menu with a confirmation; the normal way to leave is **Lock** (see 4).

2. **Upload does not depend on being logged in**
   - Each registered phone gets a **device sync key** (separate from the login session, revocable by Super Admin).
   - Every record is stamped at capture time with user, role, time, GPS and a client ID.
   - The server accepts the upload with the device key even if that user logged out or their session expired, and keeps the original user on the record. Duplicate uploads are ignored (client IDs are already used for this).
   - Only after the server answers "saved" for an item is it removed from the phone.

3. **Session expiry never throws work away**
   - While offline or while unsent work exists, the app never forces a logout.
   - On reconnect with an expired session: ask for **PIN** (see 4), upload, continue. Work in progress stays on screen.

4. **PIN lock instead of logout**
   - After first login with password (online), the user sets a **4-digit PIN** for that phone.
   - Idle 10 min → screen locks; unlock with PIN, **works offline**.
   - 5 wrong PINs → password needed (online).
   - Much easier than passwords for low-literacy users.

5. **Another user on the same phone**
   - Previous user's unsent work is kept (locked, not visible to the new user) and keeps uploading with the device key.
   - The new user sees a small note: "Previous user's 4 records are being sent".

6. **Autosave everything**
   - Every field and photo is saved to the phone the moment it is entered; if the battery dies or the app closes, the form re-opens exactly where it was.
   - The photo and its record are saved in **one** queue item so they always travel together.

7. **Protect the storage**
   - Call `navigator.storage.persist()` at first login (asks Android not to clear app data).
   - Storage meter: warn the user and the Zonal Manager when free space is low; compress photos before storing.
   - For MOTs, the Android shell app (§13.2 step 3) keeps data in app-private storage, which "Clear browsing data" does not touch.

8. **Supervisors can see waiting data**
   - Each phone reports a small heartbeat when online: unsent count, oldest unsent time, storage free, app version.
   - Zonal Manager dashboard: "Phone of Usman — 12 records waiting for 6 hours" → they can call the user. Super Admin sees all phones (Control Center §12, module 15).

9. **Last-resort recovery**
   - If a phone cannot reach the server for a long time (e.g. broken network config), the Zonal Manager can use **"Send by cable / nearby"**: the app saves an encrypted backup file that only the server can open; it is uploaded from a PC and imported with the same duplicate check.

10. **One simple sync sign for everyone** (top of every screen)

| Sign | Meaning |
|---|---|
| 🟢 ✓ | Everything sent |
| 🟡 ⟳ 5 | 5 items waiting, will send automatically |
| 🔴 ! | Problem — tap to see; the app also tells the Zonal Manager |

### 16.4 Code changes

| File | Change |
|---|---|
| `src/frontend/modules/auth/logout.ts` | **Remove** clearing of `collection_queue`, `gps_queue`, `skip_queue`, `shop_request_queue`, drafts; only clear them after confirmed upload; add the unsent-check screen |
| `src/frontend/modules/mot/offlineStore.ts` | Add `owner_user_id`, `captured_at`, `status` (pending / sending / failed) to each queue item; encrypt payload (Web Crypto, key from device key + PIN); delete only on server ACK |
| `src/lib/offline/photoStore.ts` | Join photo to its record's queue item |
| `src/app/mot/page.tsx` | On 401: keep data, show PIN unlock, retry; never `router.push('/login')` while unsent work exists |
| New `src/frontend/modules/pwa/syncEngine.ts` | One sync engine for all offline stations (MOT, PHE, MDO, ZMCC lab, dispatch), with retry/backoff and per-item ACK |
| New API `POST /api/sync/batch` | Accepts device-key uploads, idempotent by client ID, returns per-item result |
| `prisma/schema.prisma` | `Device` (id, key hash, user, ZMCC, last heartbeat, unsent count, app version, revoked), `UserPin` (hash, device) |
| Control Center §12 | Device list, revoke key, offline hours limit, PIN policy |

### 16.5 Test scenarios (must pass before go-live)

1. Offline: record 3 shops → Logout → login again → 3 shops still waiting → go online → all sent once.
2. Offline: record 3 shops → session expires → reconnect → PIN → sent.
3. User A records offline, logs out; User B logs in on the same phone → A's records still upload with A as the owner; B cannot see them.
4. Battery pulled during photo capture → reopen → form and photo restored.
5. Same item uploaded twice (network drop after send) → stored once.
6. Low storage warning appears; data not lost.
7. Device revoked by Super Admin → phone stops syncing, unsent count visible on the server for follow-up.

**Phase:** the logout fix (16.4 first row) goes into **P1** — it is small and stops data loss today. The rest lands in P3 (sync engine, device key, PIN) and P8 (Android shell).

---

## 17. "The system does it, not the user" — simplified security for field users (round 7, overrides §15 S3/S5 and §16 items 3–4 for field roles)

**Principle:** field users do only their real work (test, photo, quantity, accept/reject). Security, saving, sending, GPS and proof run automatically in the background. Strong controls stay — but they sit on the **device and the server**, not on the user.

### 17.1 Two security levels

| | Field users (MOT, PHE, MDO, Zonal Lab Attendant, Contractor Operator, Admin Operator, QAE, Weighbridge, Production Reception) | Managers & above (Zonal Manager, Contractor Manager, heads, MPD Head, AVP-QA, Finance, Senior Exec) | Super Admin, Data Executive |
|---|---|---|---|
| Login | Once, on a phone/PC **registered by Super Admin / Zonal Manager**. Stays logged in (30 days, renews by itself while in use) | Password; one-time code **only on a new device** | Password + one-time code every login |
| PIN / OTP / password change | **None** | Forced password change only when admin resets it | Yearly password change |
| Logout button | **Hidden.** User change on a phone is done by the Zonal Manager ("Release phone") | Normal | Normal |
| Shared station PC (ZMCC lab, plant gate, weighbridge) | Tap own name card + 4-digit PIN (only case with a PIN) | — | — |
| Lost / stolen phone | Zonal Manager or Super Admin presses **Block phone** → phone stops working and its data is wiped after unsent work is uploaded | Same | Same |

Removed for field users: idle PIN lock, password rules, forced changes, login alerts to the user.

### 17.2 What runs automatically (user does nothing)

| Job | How |
|---|---|
| Save | Every field and photo saved on the phone instantly |
| Send | Background upload with the device key; retries forever; deletes only after server confirms |
| Session | Never expires while working or while data is unsent |
| GPS | Starts with the journey, stops at the end; the user never switches it |
| Photo proof | Stamp, time, GPS, hash added automatically |
| Updates | App updates itself at the next safe moment (never in the middle of a form) |
| Storage | Old sent photos/cache cleaned automatically; warning goes to the Zonal Manager, not the user |
| Problems | Sent automatically to the Zonal Manager / IT (unsent > 2 h, GPS off, low storage, clock wrong) |

### 17.3 "Black box" — proof when someone blames the app

Every phone keeps a small **activity diary** that uploads with the data:

```
10:02  Opened shop "Haji Milk Point"
10:04  LR photo taken (GPS ±6 m)
10:05  Saved on phone            ← offline
10:41  Sent to server ✓  Receipt R-55120
```

- Zonal Manager and IT can open the diary for any phone and any day.
- After the server confirms, the user's screen shows a **receipt number** (and the shop can get the existing SMS), so both sides have proof.
- Disputes are settled with facts: "saved at 10:05, sent at 10:41, receipt R-55120", or "never opened the form".

### 17.4 Code impact

- `src/frontend/modules/shared/UserMenu.tsx` / `Header.tsx`: hide Logout for field roles; show sync sign + receipt list instead.
- `Device` table (§16.4) gains `release_requested`, `blocked`, `diary` upload; new `DeviceActivityEvent` table.
- Zonal Manager dashboard: **Phones** tab — status, unsent, last seen, diary, Release / Block buttons.
- Login: "remember this device" for field roles (long-lived device session, revocable server-side).

---

## 18. Device control only for Super Admin and Data Executive (round 8, overrides §16 items 8–9 and §17)

Phone and user control is powerful, so it stays at the top only.

| Action | Super Admin | Data Executive | Everyone else (incl. Zonal Manager, MPD Head) |
|---|---|---|---|
| Register a phone / PC | ✓ | ✓ | ✗ |
| Release phone (change user) | ✓ | ✓ | ✗ |
| Block lost / stolen phone | ✓ | ✓ | ✗ |
| See phone list, unsent data, last seen, app version | ✓ | ✓ | ✗ |
| Open activity diary (black box) | ✓ | ✓ | ✗ |
| Receive alerts (unsent > 2 h, GPS off, low storage, clock wrong) | ✓ | ✓ | ✗ |
| Last-resort backup file import | ✓ | ✓ | ✗ |
| Reset password / unlock account | ✓ | ✓ | ✗ |

- The **Phones** tab moves from the Zonal Manager dashboard to the **Control Center (§12, modules 1 and 15)**.
- Zonal Manager and other managers keep only their normal work screens and approval inbox.
- If a field user has a phone problem, they tell their manager, who contacts the Super Admin / Data Executive (or later: a "Report problem" button that goes straight to them).
- Every device action (register, release, block, diary opened) is itself recorded in the audit log.
