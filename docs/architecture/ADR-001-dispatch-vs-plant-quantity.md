# ADR-001: Dispatch vs Plant Quantity & Authoritative Final Receipt

## Status
Accepted

## Context
Milk intake involves two distinct testing and measurement phases: Dispatch (at ZMCC or Contractor origin) and Plant Reception (at Factory Weighbridge and Laboratory). Physical receiving mass is measured at the factory weighbridge after accepted portions are unloaded.

## Decision
1. **Portion-Wise Testing & Authoritative Plant Decisions**:
   - **Dispatch Testing** is performed portion-wise (P1..Pn) at source.
   - **Plant QA Testing** is performed portion-wise (P1..Pn) upon arrival.
   - **Plant QA** makes the authoritative Plant acceptance, rejection, and hold decisions used downstream for unloading, weighing, and inventory posting.
   - Dispatch does not share downstream decision lifecycles with Plant QA.

2. **Vehicle-Wise Final Receipt Mass**:
   - **Gross Weight / First Weighment**: Measured upon vehicle entry before unloading (Vehicle + all Portions).
   - **Second Weight / Post-unloading Weighment**: Measured after accepted portions are unloaded into plant receiving silos.
   - **Net Milk Received (kg) = Gross Weight - Second Weight**.
   - **Tare Safety Invariant**: Second Weight is not necessarily an empty vehicle tare weight because any rejected milk remains physically onboard inside the vehicle tank.

3. **No Per-Portion Plant Mass Allocation**:
   - The actual physical mass of individual accepted portions inside a multi-compartment vehicle is not measured independently by the weighbridge.
   - The system strictly records vehicle-level Net Milk Received (kg) and does **NOT** fabricate proportional mass allocations.

4. **No Dispatch Fallback into Plant Calculations**:
   - Plant calculations strictly use authoritative Plant QA laboratory results.
   - Dispatch LR/Fat values are never substituted or fallen back into Plant receipt formulas.

5. **Accepted-Only Quality Averaging**:
   - Composite Plant quality metrics (LR and Fat) are computed strictly as the simple arithmetic average of authoritative Plant quantitative source inputs across accepted portions only.
   - Rejected and held portions are strictly excluded from composite averages.
   - No quantity weighting is applied (since per-portion physical mass is not measured).
   - Derived metrics (Plant Density, SNF %, Total Solids %, SNF:Fat Ratio) are recalculated from averaged authoritative source inputs.
   - Internal calculation averages are not a fake `PlantLabResult` and are not exposed as a Weighbridge UI requirement.

6. **Physical Liters vs 13 TS Distinction**:
   - `Physical Liters = Net Milk Received (kg) / Plant Density`. This represents actual volumetric space occupied in receiving silos.
   - `13 TS Volume = Physical Liters * Total Solids % / 13.0`. This represents the standardized commercial accounting equivalent.
   - Silo inventory ledger balances are tracked strictly in **Physical Liters**.

7. **Multi-Silo Allocation Guard**:
   - Actual Net Milk Received (kg) is measured strictly at the **vehicle level**.
   - Actual accepted per-portion received mass is unknown.
   - If accepted portions map to more than one destination silo, actual per-silo received quantity cannot be derived safely.
   - The system must **never** proportionally allocate received mass across silos.
   - The system must **never** use declared portion quantities to fabricate per-silo allocation.
   - The system must **never** use Dispatch quantities as a substitute.
   - Final receipt remains strictly blocked with `MULTI_SILO_ALLOCATION_REQUIRED`, even when individual portion destinations (e.g. P1 -> Silo A, P2 -> Silo B) are known.
   - A future explicit multi-silo allocation business rule or actual per-silo physical measurement is required before this guard can be removed.
