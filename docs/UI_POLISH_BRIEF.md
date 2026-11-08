# UI polish brief

Applies the unslop passes (`.claude/skills/unslop`, by Damir Sokolovsky, CC BY 4.0) to every screen.
Mode: polish. Keep the palette, the features, the content and the order of sections.

## Direction
- **Product:** tracks raw milk from village shop to plant silo, for testers, labs, weighbridge staff and managers.
- **Character:** exact, sturdy, unhurried.
- **World:** weighbridge slips, lab sheets, steel tanks and route registers.
- **Moments:** the weight or lab result on each working screen, and tank levels from real silo data.
- **Signature:** tokens and weights look like a printed weigh slip: mono, tabular figures on a thin ruled line. Only on those values.

## Hard rules
1. UI only. Never change data fetching, query keys, API calls, validation rules, calculations, permissions, role checks, workflow steps, or what a button does. If a change needs any of these, leave it and report it.
2. Never edit `src/backend`, `src/app/api`, `prisma`, or any `__tests__` folder.
3. Never run seed, migration, database or dev server commands.
4. Do not edit `src/components/ui` or `src/lib`. Use what is there.
5. Do not commit. Stay inside your own folders.
6. Keep the Shakarganj logo and the red S mark. Keep 44px touch targets on buttons and inputs.
7. Weights, volumes, tokens and codes are never shortened. No `truncate` on any number or code. A cut-off figure is a wrong figure.
8. Do not invent features, data or claims.

## What to fix
- **Fits every screen:** no fixed `grid-cols-3` or `grid-cols-4` for tiles or stats. Use `grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))]`. Replace fixed widths like `w-[300px]` with `w-full max-w-*`. Flex rows that can overflow get `flex-wrap` and `min-w-0`. Drop `whitespace-nowrap` where text could overflow, and `truncate` on anything a person must read in full.
- **Lists:** replace raw `<table>` with `DataTable` from `@/components/ui/data-table` where it is a list of records. Leave comparison matrices, pivot grids and lab grids as tables inside `TableWrapper`. Never add `bulkActions` to approvals, weights, lab results or dispatches.
- **Loading:** first load uses `SkeletonList`, `SkeletonTable` or `SkeletonStats` from `@/components/ui/loaders` instead of a spinner with text. Keep the spinner inside a pressed button.
- **Empty and error:** use `EmptyState` and `ErrorState` from `@/components/ui/empty-state`. Do not show the same empty message twice.
- **Dates:** use `formatDate`, `formatTime`, `formatDateTime` from `@/lib/format` for anything shown to people. Do not touch dates sent to the server.
- **Colour:** red only for the main action, the selected item or a real problem. Cards in a queue get a plain border, not red. Icons use the muted text colour unless they carry a warning or status. No coloured icon tiles. Status colours only mean pass, warning or fail.
- **Buttons:** one main action per area. The rest are `outline` or `ghost`.
- **Type:** sentence case. Weights up to `font-semibold`, and use it rarely. No `text-[10px]` or `text-[11px]`, use `text-xs`. No `tracking-tight` on small text. Codes stay in capitals.
- **Copy:** short, plain words from this business. No exclamation marks, no trailing periods on labels, no words like operational, comprehensive, enterprise, unified, seamless. Use Mobile Tester and HC, never MOT or Local Supplier in visible text. Do not change text that identifies a role or a legal or SOP term.
- **Titles:** one title per page. Remove a heading that repeats the header title.
- **Motion:** remove `animate-pulse` and `animate-ping` unless the thing is live or a skeleton. Use `transition-colors`.
- **Corners:** outer cards `rounded-2xl`, inner items `rounded-xl` or `rounded-lg`, controls `rounded-lg`.

## Order of work
Start with the largest and most used screens. Do every file you can, read each before editing, and skip anything you are unsure about rather than guess.
