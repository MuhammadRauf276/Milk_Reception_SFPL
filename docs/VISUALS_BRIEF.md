# Visuals — brief

A new **Visuals** page (`/visuals`) for senior management, with one sub-tab per level. The charts that were
under *Whole Loss / Gain → Stages* move here (ZMCC tab); Whole Loss / Gain keeps its tables.

Roles: SUPER_ADMIN, EXECUTIVE_MANAGEMENT, HEAD_OF_MPD, DATA_EXECUTIVE (the Command Center roles). Read-only.

## Sub-tabs (`/visuals?tab=…`)

| Tab | Key | What it answers |
|---|---|---|
| Shops & routes | `SHOPS` | Which routes and shops we depend on: litres @13 TS per route/shop, share, trend, rejected shops, shops visited vs planned. Route filter. |
| Mobile Testers | `TESTERS` | Per Mobile Tester: collected vs received at ZMCC (@13 TS), trip loss/gain, shops, rejections, TS. Tester check boxes per ZMCC, or the whole ZMCC. |
| HC suppliers | `HC` | Which HC suppliers we rely on (share), most rejected, most accepted, rejection rate, TS, arrivals per day, left early. |
| ZMCC | `ZMCC` | Intake MC / HC / other, tank level at end of day (opening + intake − dispatch), dispatched, plant received, road loss/gain. Old Stages charts live here. |
| Plant | `PLANT` | Time inside the plant (gate entry → gate exit), time per stage (gate → QA → first weight → unloading → second weight → receipt → exit), slowest vehicles, by ZMCC / contractor / source; accepted vs rejected, rejection rate by source, rejection reasons. |

Every tab: period presets (Today … This year), custom From/To (max 366 days), Day / Week / Month grouping,
calendar or business day where it applies, ZMCC check boxes, and **compare with the previous period of the same
length** (totals + % change on the KPI tiles). A click on a chart bar narrows the view where it makes sense.

## Trusted numbers (must match what the app already reports)

- Shop collected = `mot_shop_collection` rows with `final_decision = 'ACCEPTED'`, `gross_liters`, `at_13ts_liters`;
  rejected shops = `final_decision = 'REJECTED'`. Journey day = `mot_journey.operational_date`, cancelled journeys out.
- Received at ZMCC = `zmcc_tank_receipt.gross_liters`, @13 TS = `gross_liters * ts / 13` (corrections included,
  as the receipt is now). Same as `zmccStageDrillService.ts`.
- Trip loss/gain = received − collected, **only journeys that arrived** (`notArrived` left out).
- HC: arrivals = `zmcc_local_supplier_arrival`, decision = `zmcc_lab_session.final_decision`, received = tank receipts.
  Day = `arrival_date` (calendar) or `pkLocal(arrival_timestamp) - 8h` (business).
- ZMCC intake / dispatch / plant / road = `getZmccStageChain` (`zmccStageChainService.ts`) — reuse, never rewrite.
- Tank level: running sum over `zmcc_tank_inventory_transaction` per tank in **id order**
  (RECEIPT/ADJUSTMENT_IN +, ISSUE/ADJUSTMENT_OUT −), level at end of each day = last running value that day.
- Plant times from `gate_log.entry_timestamp/exit_timestamp`, `qa_testing_session.started_at/completed_at`,
  `visit_portion.plant_decided_at`, `weight_ticket.gross_timestamp/tare_timestamp`,
  `unloading_log.pump_start_timestamp/pump_end_timestamp`, final receipt = `silo_inventory_transaction` RECEIPT
  `operational_timestamp`. A duration counts only when both ends exist and end ≥ start; medians, not just averages.
- Plant decision = `visit_portion.plant_decision` (ACCEPTED / REJECTED; PENDING left out of rates),
  reason = `plant_rejection_reason`. Source = `procurement_source` (ZMCC / CONTRACTOR). Vehicle day =
  `vehicle_visit.operational_date` (business day) or Pakistan date of gate entry (calendar).
- Formulas: @13 TS = L × TS / 13; TS = Fat + SNF.

## Load rules (protect the live system)

1. Aggregate in PostgreSQL (`GROUP BY day, entity`) on indexed date columns; never send raw rows to the browser.
2. One request per tab returns **daily** rows for the current range and the previous range; Week / Month / compare
   are derived in the browser from those days (switching grouping costs nothing).
3. Every query runs in `runVisualsQuery` = read-only transaction with `statement_timeout` (8 s).
4. Results are cached in-process for 60 s per (tab, range, filters) via `createTtlCache`; concurrent identical
   requests share one computation. React Query `staleTime` 60 s on the page.
5. Range capped at 366 days; entity lists capped (top 50 by volume + "Others").
6. No new tables, no stored derived data. Index changes only with the owner's yes.

## Files

Shared (orchestrator): `visualsContracts.ts`, `services/visuals/visualsCommon.ts`, API
`/api/management/visuals/[tab]`, page `/visuals`, `VisualsShell.tsx`, `VisualsFilters.tsx`, `visualsKit.tsx`,
nav links. Per tab (one owner each): `services/visuals/<tab>Visuals.ts`, `modules/visuals/tabs/<Tab>Tab.tsx`.
