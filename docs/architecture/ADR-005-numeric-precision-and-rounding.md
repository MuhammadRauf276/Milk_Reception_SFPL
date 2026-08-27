# ADR-005: Numeric Precision, Calculation Chains, and Rounding Policy

## Status
**Accepted**

## Context
The Milk Reception application performs critical mass, volume, and quality calculations:
- Intake weighments (Gross, Tare, Net in Kilograms);
- Supplier declared quantities (Liters or Kilograms);
- Laboratory quality test measurements (Lactometer Reading / LR, Fat %, SNF %, Total Solids %, SNF:Fat Ratio);
- Derived physical milk volume (Physical Liters);
- Commercial standardized milk volume (@13 TS Liters);
- Silo inventory ledger balances and physical capacity tracking.

Prior to Stage 4C-0, sporadic `toFixed(2)` and `toFixed(3)` calls were applied indiscriminately across reporting functions, sometimes truncating intermediate variables before downstream calculation steps. Furthermore, schema definitions, runtime memory models, and UI presentation components used differing rounding conventions.

This ADR establishes the definitive architectural policy separating source measurement preservation, unrounded intermediate calculation chains, canonical formula authority, and presentation-layer rounding.

---

## 1. Current Implementation vs Architectural Policy

### A. Source Values & Measurement Preservation
* **Current Reality:** Database columns use `Decimal(10, 2)` for weights, lab result numeric values, portion declared quantities, and silo capacities.
* **Architectural Policy:** Preserve the genuine entered/measured precision supported by the data model. Never round, truncate, or normalize stored facts merely because an active UI screen displays fewer decimal digits.

### B. Intermediate Calculation Chains (No Intermediate Rounding)
* **Current Reality:** In `vehicleQuantityService.ts` and `milkFormulas.ts`, calculations proceed with raw IEEE-754 double precision (JavaScript `number`).
* **Architectural Policy:** Do **NOT** round after intermediate calculation steps. The calculation chain:
  `Plant LR + Plant Fat -> Density + SNF -> TS + Ratio -> Physical Liters -> @13 TS Liters`
  must maintain full floating-point precision throughout all mathematical transformations. Truncating intermediate variables (e.g., rounding Density to 2 decimals or SNF to 2 decimals before computing TS or Liters) induces compounding errors and is strictly forbidden.

### C. Canonical Derived Values Authority
* **Current Reality:** Canonical formulas are centralized in `src/backend/utils/milkFormulas.ts` and evaluated by `src/backend/services/vehicleQuantityService.ts`.
* **Architectural Policy:** All runtime modules, API routes, and backend workflows must consume the centralized canonical helpers in `milkFormulas.ts`. Creating local duplicate, ad-hoc, or rounded formula variants is prohibited.

### D. Separation of Presentation Display from Calculation & Storage
* **Current Reality:** Some read-model and reporting helpers (`operationalCalculations.ts`, `operationalReadModelService.ts`) applied `Number(val.toFixed(2))` inside data aggregation pipelines.
* **Architectural Policy:** Display rounding is strictly a presentation-layer concern. Storage and business calculations must produce unrounded numbers (or exact database Decimals). Formatting functions (`Intl.NumberFormat`, React formatting components, or UI formatters) must apply visual rounding only at the rendering boundary.

### E. Numeric Comparisons & Tolerance Governance
* **Current Reality:** Reconciliation and consistency tests evaluate derived values against known analytical baselines.
* **Architectural Policy:** Do not use naive exact equality (`===`) for derived floating-point quantities where binary floating-point representation errors may occur (e.g. `0.1 + 0.2 !== 0.3`). However, developers and AI agents must **never** invent arbitrary reconciliation tolerances (e.g. `±0.01`, `±1%`, `±50 KG`). Any business tolerance or variance threshold requires explicit stakeholder approval and documentation.

### F. Field Display Precision Policy
* **Architectural Policy:** Calculation and storage precision are strictly separate from display precision.
  - The application does **not** impose a blanket "2 decimals for everything" rule.
  - Display precision may differ by field based on domain and UI context.
  - Exact display precision standards are **TO BE DEFINED** where required by official UI/business specifications.
  - No developer or AI assistant may invent display precision standards as an unapproved business rule.


---

## 2. Database Reality & Future Considerations

### Current Database Types
The current PostgreSQL schema (`prisma/schema.prisma`) uses:
- `Decimal(10, 2)` for `WeightTicket.gross_weight_kg`, `tare_weight_kg`, `net_weight_kg`
- `Decimal(10, 2)` for `VisitPortion.declared_quantity_value`
- `Decimal(10, 2)` for `DispatchLabResult.numeric_value`, `PlantLabResult.numeric_value`
- `Decimal(10, 2)` for `LabTestRule.min_value`, `max_value`
- `Decimal(10, 2)` for `Silo.capacity_liters`
- `Decimal(10, 2)` for `SiloInventoryTransaction.quantity_kg`, `quantity_liters`

### Future Consideration (Post-Development Phase)
When higher lab precision (e.g., 3-4 decimal places for density/specific gravity or microbiological assays) is mandated by operational standards, a dedicated schema migration expanding `numeric_value` to `Decimal(12, 4)` or `Decimal(14, 4)` should be planned under tracked Prisma migrations. No schema change is performed during Stage 4C-0.

---

## 3. Decision Summary
1. **Source Precision:** Preserve genuine input precision.
2. **Intermediate Rounding:** Forbidden in calculation chains.
3. **Canonical Formulas:** `src/backend/utils/milkFormulas.ts` is the single source of truth.
4. **Display Rounding:** Restricted to presentation components only.
5. **Arbitrary Tolerances:** Prohibited without explicit business sign-off.
6. **Schema Types:** Documented as `Decimal(10, 2)` with future migration considerations recorded.
