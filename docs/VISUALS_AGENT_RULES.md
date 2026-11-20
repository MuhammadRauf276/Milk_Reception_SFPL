# Rules for every Visuals tab builder

Read first: `docs/VISUALS_BRIEF.md`, then these shared files (do NOT edit them — if you need a change, say so in your report):
- `src/backend/modules/management-reporting/visuals/common.ts` (VisualsQuery, VisualsResponse, QtyPair)
- `src/backend/services/visuals/visualsCommon.ts` (daySql, allDays, qty, tsOfPair, median, num, round2, VISUALS_TOP_N, VisualsDb)
- `src/backend/services/visuals/registry.ts`, `src/app/api/management/visuals/[tab]/route.ts`
- `src/frontend/modules/visuals/VisualsWorkspace.tsx` (VisualsTabProps: filters, options, unit 'at13'|'liters', bucket 'DAY'|'WEEK'|'MONTH', ids/setIds)
- `src/frontend/modules/visuals/visualsKit.tsx` (useVisuals, bucketRows, TrendChart, DonutChart, AcceptRejectBars, RankedBarsChart, KpiTile, KpiRow, ChartGrid, VisualTable, PickList, formatters, SERIES_COLORS)

How it works: the route calls your loader twice (chosen days and the previous same-length period) inside a read-only
transaction with an 8 s statement timeout, caches 60 s, and returns `{ meta, current, previous }`. Your loader gets
`(q: VisualsQuery, db: VisualsDb)`; run all SQL with `db.$queryRaw` (Prisma.sql templates, `Prisma.join` for id
lists). `q.zmccIds` is never empty (all ZMCCs when none picked). `q.ids` = your tab's picks (empty = all).

Your tab component gets `VisualsTabProps`, calls `useVisuals<YourType>('TAB', filters, ids)`, groups days with
`bucketRows(rows, bucket, derive)` and draws with the kit. KPI tiles show `previous` for comparison.

## Must
- Numbers must match the app's existing definitions (see the brief, "Trusted numbers"). Reuse SQL patterns from
  `src/backend/services/zmccStageDrillService.ts` and `zmccStageChainService.ts`; never invent a new formula.
- Aggregate in SQL (GROUP BY day / entity). Send daily rows + per-entity totals only, never raw records. Cap named
  lists at VISUALS_TOP_N (rest = "Others"), except small lists for pick boxes (id, name, group).
- Filter big tables on an **indexed** column first (see `@@index` in prisma/schema.prisma); when the real filter
  column has no index, narrow by an indexed column with a 2-day margin, then filter exactly.
- Fill missing days with zeros (`allDays`) so trends are honest.
- @13 TS vs litres: follow `props.unit` wherever both exist.
- UI wording: few words on screen; explanations go in the `info` prop (InfoTip). Errors via `<ErrorPopup>`
  (`@/components/ui/error-popup`). Lists as `VisualTable`. Mobile first (works at 375 px).
- Tailwind colour tokens only (`text-foreground`, `text-secondary-foreground`, `text-muted-foreground`, `bg-card`,
  `border-border`, `text-primary`, `text-destructive`); no raw `text-slate-*` etc. Chart colours from the kit.
- One value axis per chart (never two y-axes). Legends for ≥2 series. No dark-mode work.
- Pure calculation code in a separate exported function with a `node:test` test in
  `src/backend/services/__tests__/<tab>Visuals.test.ts` (import with `@/…` paths).

## Must not
- No schema/migration changes, no writes to the database, no new npm packages.
- Do not edit files you do not own. Do not run `git stash`, `git commit`, `git checkout` or any git write.
- Do not start or stop the dev server (port 3200 belongs to the orchestrator).
- Keep each file's line endings (CRLF/LF) as they are.

## Check before reporting
1. `rm -rf .next/dev/types; npx tsc --noEmit -p .` — no errors in any file.
2. `node scripts/check-ui-text.js` passes.
3. `npx tsx --env-file=.env --test src/backend/services/__tests__/<your tests>` passes (the local DB is dummy data; read only).
4. Run your loader once against the local DB with a scratch script outside `src/` (e.g. `npx tsx --env-file=.env <scratch>.ts`
   calling `runVisualsQuery((db) => loadX(q, db))` for the last 60 days) and confirm it returns sensible numbers and a
   total that matches the existing report for the same days. Delete the scratch script afterwards.

Report in ≤150 words: files, what each chart shows, any number you could not reconcile, anything you needed changed in a shared file.
