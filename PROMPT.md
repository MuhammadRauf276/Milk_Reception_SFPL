# AI Worker Execution Master Guide

**Role**: Execution Agent  
**Goal**: Execute the Milk Reception System architectural cleanup, operational overhaul, and performance optimization in strict dependency order.  
**Repository**: `D:\MilkReceptionApp`  

---

## Operating Rules for the Worker AI:
1. **Strict Dependency Order**: Follow Phase 1 through Phase 7 sequentially. Do not jump ahead.
2. **Zero `any` Types**: Write clean, strict TypeScript types.
3. **No Patch Scripts**: Do not create temporary `.js` monkey-patch scripts in the root directory. Edit files directly and cleanly.
4. **Token-Lean Testing**: Do NOT generate mock-heavy unit tests for UI components or CRUD routes. After each phase, verify with:
   - `npm.cmd run typecheck` (verifies all types and syntax in 5 seconds)
   - `npm.cmd run test:unit` (verifies pure math calculations in 2 seconds)
5. **Human Redundancy Elimination**: If the system can calculate a value (e.g., auto-codes, vehicle LR/Fat from portions, loss percentages), never force human re-typing.
6. **Strict Clean UI & Anti-Clutter Protocol**:
   - **No Explanatory Text / Notes**: NEVER add instructions, guides, hints, or verbose explanatory sentences under inputs, cards, or headers (e.g., "Enter value between...", "Authoritative measured issue...", "Values falling within this range will automatically pass..."). Clean, self-explanatory labels ONLY.
   - **Zero Micro-Text**: Never use `text-[9px]`, `text-[9.5px]`, `text-[10px]`, or `text-[10.5px]`. Use standard `text-xs font-bold` (12px) for secondary labels and `text-sm` / `text-base` for values.
   - **Zero Slogans / Version Badges**: Do not add internal version tags, formula versions, section reference badges, or slogans (e.g., "Physical Truth", "Commercial Truth", "Formula v1", "Section 24", "Bounded page metrics").
   - **Calm, Compact Layout**: Avoid stacking duplicate cards. Use compact tables or clean single cards with high contrast and intuitive spacing.

---

## Dependency Graph Overview

```
Phase 1: Foundation & Syntax Fix [COMPLETED & VERIFIED]
   │
   ▼
Phase 2: Database Schema & Model Consolidation [COMPLETED & VERIFIED]
   │
   ▼
Phase 3: Master Data & Field Operations [COMPLETED & VERIFIED]
   │
   ▼
Phase 4: Quality Acceptance Criteria & Data Executive Role [COMPLETED & VERIFIED]
   │
   ▼
Phase 5: 3-Way Quality Decision Engine [COMPLETED & VERIFIED]
   │
   ▼
Phase 6: ZMCC Dispatch Performance & Auto Portion Math [COMPLETED & VERIFIED]
   │
   ▼
Phase 7: 3-Tier Supply Chain Loss Hierarchy, Excel Export & Digital RMR Receipts [ACTIVE]
```

---

## Phase 1: Foundation, Syntax Fix & Workspace Cleanup

### Step 1: Clean Up Root Debris & Restore ADR Files
1. Delete the 19 obsolete patch scripts and zip files from the project root:
   - `D:\MilkReceptionApp\Milk_Reception_UI_Audit.zip`
   - `fix_any.js`, `fix_any_raw.js`, `fix_catch_any.js`, `fix_client_guards.js`, `fix_cursor.js`
   - `fix_includes.js`, `fix_layout.js`, `fix_procurement.js`, `fix_procurement2.js`
   - `fix_role_routing.js`, `fix_roles.js`, `fix_schema.js`, `fix_schema2.js`
   - `fix_test_policies.js`, `fix_ts.js`, `fix_ts_final.js`, `inject_phase2.js`, `split_mot.js`
2. Restore the 6 deleted ADR files from git history:
   ```bash
   git checkout HEAD -- docs/architecture/ADR-000-schema-workflow.md docs/architecture/ADR-001-dispatch-vs-plant-quantity.md docs/architecture/ADR-002-lab-test-assignment-snapshot.md docs/architecture/ADR-003-configurable-lab-result-options.md docs/architecture/ADR-004-development-data-lifecycle.md docs/architecture/ADR-005-numeric-precision-and-rounding.md
   ```

### Step 2: Fix Syntax Blocker in Journey Reconciliation Route
File: `src/app/api/management/reconciliation/journeys/[journeyId]/route.ts`  
Lines 18–20 have mismatched closing braces. Replace lines 18–20 with the properly structured `include`:
```ts
mot_arrival: {
  include: {
    lab_session: {
      include: {
        results: {
          select: {
            test_code_snapshot: true,
            test_name_snapshot: true,
            numeric_value: true,
            text_value: true,
            evaluation_status: true,
            is_passed: true,
          },
        },
        tank_receipt: {
          select: {
            id: true,
            quantity_liters: true,
            at_13ts_liters: true,
            received_at: true,
          },
        },
      },
    },
  },
},
```

### Step 3: Remove Duplicate Stacked UI from ZMCC Manager Workspace
File: `src/frontend/modules/dashboard/ZMCCManagerWorkspace.tsx`
1. Remove obsolete imports:
   ```tsx
   import { ZmccManagerSnapshot } from './zmcc/ZmccManagerSnapshot';
   import { ZmccReconciliationSnapshot } from './zmcc/ZmccReconciliationSnapshot';
   ```
2. In the `OVERVIEW` tab (~line 448), remove:
   ```tsx
   <ZmccManagerSnapshot />
   <ZmccReconciliationSnapshot />
   ```
   Keep only the canonical `<ZMCCManagerOverview ... />`.

### Step 4: Remove Footer Version Badge
File: `src/frontend/modules/shared/navigation/HierarchicalNavDrawer.tsx`  
Remove the raw internal build string (`v6G-E`) at lines ~361-363.

### Step 5: Phase 1 Verification
```bash
npm.cmd run typecheck
npm.cmd run test:unit
```
Ensure code compiles with zero syntax errors.

---

## Phase 2: Database Schema & Model Consolidation

### Step 6: Delete Rogue `CommercialMilkSupplier` Artifacts
1. Delete unused orphan service and API files:
   - `src/backend/services/commercialSupplierService.ts`
   - `src/app/api/commercial-suppliers/route.ts`
   - `src/app/api/commercial-suppliers/assign/route.ts`
2. Remove any references to `commercialSupplierService` or `CommercialMilkSupplier` in other files.

### Step 7: Clean Up `prisma/schema.prisma` & Re-generate Client
1. In `prisma/schema.prisma`:
   - Remove unused rogue models `CommercialMilkSupplier` and `SupplierZmccAssignment`.
   - Reconfirm canonical supplier routing:
     - Direct ZMCC deliveries $\to$ `ZmccLocalSupplier`.
     - Direct factory plant deliveries $\to$ `ProcurementSource` (`source_type: 'CONTRACTOR'`).
2. Run Prisma client generation:
   ```bash
   npx prisma generate
   ```
3. Run `npm.cmd run typecheck` to confirm clean typing across the entire codebase.

---

## Phase 3: Master Data & Field Operations

### Step 8: Auto-Generated Route & Area Codes with ZMCC Isolation
1. **Backend** (`src/backend/services/zmccMasterDataService.ts`):
   - In `createRoute()`: Auto-generate `RT-${zmcc.code || 'ZMCC'}-${String(count + 1).padStart(3, '0')}` if `route_code` is empty.
   - In `createArea()`: Auto-generate `AR-${route.route_code}-${String(areaCount + 1).padStart(2, '0')}` if `area_code` is empty.
2. **Frontend** (`src/frontend/modules/zmcc/ZmccMasterDataWorkspace.tsx`):
   - In `CREATE_ROUTE` modal: Remove manual text input for Route Code. Show read-only badge `[ Auto-generated by system ]`. Pre-fill Origin with current ZMCC name and Destination with "Main Factory Plant".
   - In `CREATE_AREA` modal: Remove manual Area Code input. Add Route selector showing only active routes for the current ZMCC.

### Step 9: Auto-Generated Shop & Local Supplier Codes
1. In `createShop()`: Auto-generate `SHP-${String(count + 1).padStart(6, '0')}` if empty. Remove manual typing in Shop modal.
2. In `createLocalSupplier()`: Auto-generate `ZLS-${String(count + 1).padStart(6, '0')}` if empty. Remove manual typing in Local Supplier modal.
3. In `CREATE_LOCAL_SUPPLIER` modal:
   - Add Milk Source dropdown loaded from the ZMCC's sources.
   - Include `[+ New / Unknown ERP Source]` for non-blocking intake.

### Step 10: Pakistani Substitute Vehicle Registration
File: `src/frontend/modules/zmcc/ZmccMasterDataWorkspace.tsx` & `src/backend/services/mot/motCore.ts`
1. Add emergency substitute vehicle registration modal with fields:
   - `Registration Plate *` (e.g., `LEA-8921`, `FSD-4019`, `ICT-202`)
   - `Vehicle Type *`: `SUZUKI_PICKUP` (Suzuki Ravi/Bolan), `MINI_TRUCK` (Shehzore/Forland), `MEDIUM_TRUCK` (Mazda/Isuzu), `INSULATED_TANKER`
   - `Tank / Drum Capacity (Liters) *`
   - `Driver Name *` & `Driver Phone Number *`
   - `Category`: `EMERGENCY_SUBSTITUTE`

### Step 11: Non-Blocking ERP Intake & Financial Hold
1. In `src/backend/modules/notifications/eventCatalog.ts`:
   - Add event: `ERP_VENDOR_MAPPING_REQUIRED` (recipients: `FINANCE_ACCOUNTS`, `ZMCC_MANAGER`, `DATA_EXECUTIVE`).
2. When creating a Shop or Local Supplier with `PENDING_ERP_MAPPING`:
   - Milk reception is permitted immediately without delay.
   - Fire notification to Finance and ZMCC Manager.
   - In Finance view, show an amber alert: *"Payment on hold: [N] entities pending ERP code mapping."*
   - Provide a 1-click modal to map the official ERP code and release the hold.

### Step 12: 100% Offline GPS & Vector Route Trail
1. Verify `src/frontend/modules/mot/offlineStore.ts`:
   - Hardware satellite GPS pings are saved to IndexedDB `gps_queue` when offline.
   - Auto-syncs to `/api/zmcc/mot/journeys/current/locations` with idempotency keys upon connection return.
2. In `src/frontend/modules/mot/ManagerJourneyMap.tsx`:
   - Update banner to reassuring: `GPS Route Trail Active (Schematic Vector Mode) • 100% of waypoints safely saved in DB`.

---

## Phase 4: Quality Acceptance Rules & Data Executive Empowerment

### Step 13: Empower `DATA_EXECUTIVE` in Role Policies
1. **Access Control Policy** (`src/backend/modules/access-control/rolePolicies.ts`):
   - Grant `DATA_EXECUTIVE`: `['VIEW', 'CREATE', 'EDIT_DRAFT', 'SUBMIT', 'APPROVE', 'ADMINISTER']` for quality test policies.
2. **API Authorization Endpoints**:
   - `src/app/api/super-admin/lab-tests/route.ts` & `[id]/route.ts`: Allow `SUPER_ADMIN` and `DATA_EXECUTIVE`.
   - `src/app/api/super-admin/sop-rules/route.ts`: Allow `SUPER_ADMIN` and `DATA_EXECUTIVE`.
   - `src/app/api/qa-head/sop-rules/route.ts`: Allow `['QA_HEAD', 'QA_MANAGER', 'SUPER_ADMIN', 'DATA_EXECUTIVE']`.

### Step 14: Unified Quality Acceptance Configuration Across 4 Stations
1. Allow test policies to be directly created and configured across all 4 stations:
   - `PLANT_QA`: Factory reception testing.
   - `DISPATCH`: ZMCC dispatch testing.
   - `ZMCC_LAB`: ZMCC laboratory reception testing for all vehicles.
   - `MOT_SHOP`: Village collection testing at shops.
2. Direct Criteria Definition:
   - **Numeric Tests**: `minValue` and `maxValue` acceptable ranges (e.g., Fat 3.5–5.0%, LR 28–32).
   - **Qualitative & Sensory Tests**:
     - Adulteration: `acceptableOption: 'NEGATIVE'` (or `'POSITIVE'`).
     - Smell: `acceptableOption: 'NORMAL'` or `'CLEAN'`.
     - Taste: `acceptableOption: 'NORMAL'` or `'SWEET'`.
     - Clot-on-Boiling: `acceptableOption: 'NEGATIVE'`.
3. In `MilkTestPolicyWorkspace.tsx`:
   - Allow `DATA_EXECUTIVE` and `SUPER_ADMIN` to configure these parameters in one unified workspace modal without bottleneck approvals.

---

## Phase 5: 3-Way Quality Decision Engine & Exception Review

### Step 15: Implement the 3-Way Decision Matrix
File: `src/backend/services/zmccLabService.ts` & `src/backend/services/qaSessionService.ts`
Implement the evaluation matrix based on rules from Phase 4:
- **Case 1 (System PASS + Attendant ACCEPT)**:
  - Status $\to$ `ACCEPTED`.
  - Zero second delay, no manager queue, no reason required.
- **Case 2 (System FAIL + Attendant ACCEPT)**:
  - Require mandatory `exceptionReason` string from attendant.
  - Status $\to$ `PENDING_MANAGER_REVIEW`.
  - Fire high-priority notification to ZMCC Manager / QA Manager.
  - Manager has final authority to Accept (with reason) or Reject.
- **Case 3 (System FAIL + Attendant REJECT)**:
  - Status $\to$ `REJECTED`.
  - Displayed in manager's rejected records. Manager can view and overrule with audited rationale if required.

### Step 16: MOT Shop Live Collection Exception Flow
File: `src/backend/services/motService.ts`
- If shop milk fails quality specs: default to rejected.
- If MOT requests exception: send live notification to ZMCC Manager to authorize or deny collection.

---

## Phase 6: ZMCC Dispatch Performance & Automated Portion Math

### Step 17: Lazy-Load Recent Dispatches
File: `src/frontend/modules/dashboard/MPDFieldWorkspace.tsx`
- Remove the automatic `fetchDbDispatches(1, '7d')` call on initial page mount.
- Only invoke `fetchDbDispatches` when `activeTab === 'recent'` (user clicks "Recent Dispatches" tab).
- Allows the "New Dispatch" tab to open instantly with 0 ms query delay!

### Step 18: Clean Up Left Summary Column Clutter
File: `src/frontend/modules/forms/components/DispatchSummaryPanel.tsx`
- Replace cluttered 5-column wall of text with a concise single **Dispatch Summary Card**:
  - **Total Vehicle Dispatch Quantity**: Measured Liters / Kg.
  - **Calculated Average Quality**: `Average LR` & `Average Fat %`.
  - **Commercial Volume**: Gross Liters & 13% TS Liters.
  - Remove redundant comparison boxes and repetitive per-portion text strips.

### Step 19: Auto-Calculate Vehicle LR and Fat from Portions
Files: `src/frontend/modules/forms/components/DispatchVehicleSection.tsx` & `src/frontend/modules/forms/DynamicDispatchForm.tsx`
- Eliminate redundant typing: When portion test values are entered (Portion 1 LR/Fat, Portion 2 LR/Fat):
  - Automatically calculate vehicle composite quality:
    $$\text{Weighted LR} = \frac{\sum (\text{Portion Qty} \times \text{Portion LR})}{\text{Total Portion Qty}}$$
    $$\text{Weighted Fat} = \frac{\sum (\text{Portion Qty} \times \text{Portion Fat})}{\text{Total Portion Qty}}$$
    *(If quantities are equal or pending: simple arithmetic mean).*
  - Auto-fill `vehicleLr` and `vehicleFat` with badge `[ Auto-calculated from Portions ]`.
  - Allow manual override only if desired, but default to 100% automated calculation.

---

## Phase 7: 3-Tier Supply Chain Loss Hierarchy, Excel Export & RMR Receipts

### Step 20: 3-Tier Loss Calculation Engine & Snapshots
File: `src/backend/services/lossCalculationService.ts`
Implement standard dairy loss formulas across the supply chain:
1. **Tier 1 (MOT Route / Area Loss)**: $\sum \text{Shop Collections} - \text{ZMCC Arrival}$.
2. **Tier 2 (ZMCC Process & Chilling Loss)**: $(\text{MOT Inward} + \text{Local Inward}) - \text{Dispatched Tankers} \pm \Delta\text{Stock}$.
3. **Tier 3 (Road Transit Loss)**: $\text{ZMCC Dispatched} - \text{Plant Accepted Net Weight}$.
   - If Transit Loss $> 1.0\%$, trigger `HIGH_TRANSIT_LOSS_ALERT` to ZMCC Manager and Plant Security.
4. **Tier 4 (Total MPD Loss)**: Cumulative supply chain loss from shop collection to plant silo.
5. Persist calculated snapshots into completed visit/journey records so reporting requires zero in-memory recalculation.

### Step 21: Unified Supply Chain Loss Card
File: `src/frontend/modules/dashboard/components/SupplyChainLossCard.tsx`
- Display 3 tiers + Total MPD Loss.
- Timeframe filter buttons: `Daily (Today)`, `Weekly (WTD)`, `Monthly (MTD)`.
- Display loss metrics in Liters, %, and equivalent 13% TS.

### Step 22: Loss Reconciliation Excel Export
Endpoint: `GET /api/management/reports/loss-reconciliation/export?period=today|wtd|mtd|custom`
- Generates an `.xlsx` workbook containing:
  - Date, ZMCC Name, Tanker Registration Plate, Route Code
  - Shop Liters, ZMCC Liters, Route Loss (L & %)
  - Dispatched Liters, Plant Accepted Net (Kg & L), Transit Loss (L & %)
  - Quality Discrepancies (LR & Fat differences)
  - Financial impact and audit trail.

### Step 23: Digital Receipt Format & Physical RMR Number Sync
File: `src/backend/utils/milkFormulas.ts` (`formatCollectionSmsMessage`)
1. Show physical paper `RMR No` (`shopRmrNumber`):
   ```ts
   `RMR No: ${params.shopRmrNumber || 'N/A'}`
   ```
2. **Remove internal database reference IDs** (`Ref: COL-XXXX`) from receipt text.
3. Keep SMS toggle disabled (Rs. 0 fees); provide 1-click WhatsApp receipt.
4. Ensure Tier 1 loss is labeled as **"MOT Route / Area Loss"**.

### Step 24: Final Verification Checkpoint
Run the standard validation commands:
```bash
npm.cmd run typecheck
npm.cmd run test:unit
```
Both commands must exit with code 0 (zero errors, all tests passing).
