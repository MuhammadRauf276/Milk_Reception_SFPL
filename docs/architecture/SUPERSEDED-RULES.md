# Superseded Business Rules (Historical Reference Only)

This document catalogs former assumptions, superseded requirements, and obsolete designs. 
**DO NOT USE THESE RULES FOR ACTIVE IMPLEMENTATION.** Refer to `CURRENT-RULES.md` and relevant ADR documents.

---

## 1. Superseded Rules Catalogue

| Obsolete Assumption / Rule | Status | Superseded By (Active Truth) |
| :--- | :--- | :--- |
| **Contractor always uses LITER** | **SUPERSEDED** | Generic source-level Quantity Policy (ADR-001 / `CURRENT-RULES.md`). Contractors and ZMCCs both support configurable units (KG/LITER). |
| **ZMCC always uses KG** | **SUPERSEDED** | Generic source-level Quantity Policy (`CURRENT-RULES.md`). Units are configurable per source. |
| **Portion quantity total automatically equals vehicle quantity** | **SUPERSEDED** | Vehicle quantity and portion quantities are separate logical entities (`CURRENT-RULES.md`). |
| **Quantity unit determined strictly by source type** | **SUPERSEDED** | Source Quantity Policy (`CURRENT-RULES.md`). |
| **First active ProcurementSource automatically selected as fallback** | **SUPERSEDED** | Source-bound user binding or explicit user selection (`CURRENT-RULES.md`). Silent fallbacks removed. |
| **One global Dispatch draft `sessionStorage` key** (`mpd_active_draft_visit_id`) | **SUPERSEDED** | Scoped draft key `mpd_active_draft_visit_id:<USER_ID>:<SOURCE_ID>` (`CURRENT-RULES.md`). |
| **"Operational Date" as preferred user-facing term** | **SUPERSEDED** | **Business Date** with Asia/Karachi 08:00 AM cutoff (`CURRENT-RULES.md`). |
| **Auto-converting KG to LITER using Dispatch LR** | **SUPERSEDED** | No automatic KG ↔ LITER conversion during dispatch creation (`CURRENT-RULES.md`). |
| **Plant allocating Net KG back to individual portions** | **SUPERSEDED** | Final receipt is vehicle-wise (`Gross - Tare`). Portion quantities remain unallocated (`CURRENT-RULES.md`). |