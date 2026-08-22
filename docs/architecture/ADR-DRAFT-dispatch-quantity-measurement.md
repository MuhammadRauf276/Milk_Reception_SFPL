# ADR-DRAFT: Multi-Mode Dispatch Quantity & Source Measurement Policies

## Status
DRAFT — NOT IMPLEMENTED — NOT AUTHORITATIVE

## Notice
This document outlines candidate architectural concepts for future Dispatch quantity declarations, measurement precision classifications, and source policy governance. It is currently under design review and **MUST NOT** be consumed as authoritative business logic or implemented in code until approved.

## Neutral Candidate Concepts Under Exploration
1. **Vehicle vs Portion Quantity Concepts**:
   - Vehicle-level quantity and portion-level quantity represent distinct operational measurement scopes.
2. **Supported Quantity Units**:
   - Explicit capture in `KG` or `LITER` units without silent or implicit unit assumptions.
3. **Measurement Precision Classifications**:
   - Potential classification into `ESTIMATED` vs `MEASURED` precision levels.
4. **Explicit Measurement Methods**:
   - Potential explicit capture of the physical measurement method used at source.
5. **Source Policy & Administrative Governance**:
   - Source-specific quantity policies and operational hierarchy are currently under design exploration.
6. **Separation of Concerns**:
   - Contractor laboratory default behaviors (`NOT_PERFORMED` / `"Contract Vehicle"`) remain a completely separate architectural concern from Dispatch quantity measurement models.

## Implementation Precondition
Stage 4C-1 will perform a comprehensive audit of existing code, database records, and operational requirements before any candidate Dispatch quantity model is finalized or implemented.
