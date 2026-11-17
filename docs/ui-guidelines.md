# Shakarganj (SFPL) Milk Reception System 2.0
# Master UI/UX Design System & Component Guidelines

> **Master UI/UX Specification & Front-End Design Standard**  
> **File Location:** `docs/ui-guidelines.md`  
> **Target Version:** SFPL Milk Reception Application 2.0  
> **Last Updated:** 16 November 2026  
> **Status:** **LOCKED & ENFORCED ACROSS ALL WORKSPACES**

---

## 1. Core Design Philosophy: Minimalist, Fast & Purpose-Built

The Shakarganj Raw Milk Reception platform is an industrial operational application used across dusty field collection routes, regional ZMCC chilling centers, weighbridges, laboratories, and plant silos. The user interface adheres to six core design pillars:

1. **Zero Clutter & Minimalist Surfaces:** Screens are concise, focused, and low-glare. No unnecessary decorative elements, crowded sidebars, or stacked multi-tier button bars.
2. **No Sprawling Long Pages:** Operating queues and record lists use paginated tables (10–25 rows per page), clean summary metric cards, and contextual inspection overlays. Infinite scroll (`InfiniteScrollerLoader`) is only for read-only logs such as the audit log and notifications.
3. **Screen-Size Adaptive Dialogs (Drawers on Mobile, Modals on Desktop):**
   - On mobile/tablet screens ($<1024\text{px}$): Contextual forms and review sheets slide up in bottom **Drawers** (`DrawerContent`) with ergonomic swipe handles and safe-area insets.
   - On desktop screens ($\ge 1024\text{px}$): Dialogs open as centered, focused **Modals** (`Modal` / `DialogContent` from Shadcn), avoiding awkwardly stretched full-height side panels.
4. **Decisions in Drawers/Modals:** Inspection, review, and decision-making ("Accept", "Reject", "Assign Source", "Allocate Silo") always open in a focused Drawer/Modal overlay, preserving the operator's scroll position and queue context.
5. **Pure Sidebar Navigation (Zero In-Page Tab Duplication):** In-page tab bars (`SegmentedTabs`) that duplicate sidebar links are eliminated. All navigation is driven through the collapsible `HierarchicalNavDrawer`, synchronized with URL search params (`?tab=...`), while `PageHeader` dynamically adapts subtitles to the active view.
6. **Optimized, Zero-Waste Data Fetching:** High performance backed by TanStack Query caches, debounced search inputs, `keepPreviousData` smooth transitions, and smart 30-second refetch intervals that automatically pause when tabs are backgrounded.

---

## 2. Component Design Standards

### A. Cards & Surface Elevation
- **Structure:** `bg-card rounded-2xl border border-border p-4 shadow-2xs`. Use `Card` from `@/components/ui/card`.
- **Nested corners:** outer cards `rounded-2xl`, inner items `rounded-xl` or `rounded-lg`, buttons and inputs `rounded-lg`.
- **Subtle Surface Tinting:** Secondary card containers and form groups use `bg-subtle` with `border-border` to distinguish input groups without visual noise.
- **KPI / Stat Cards:** use `StatCard`.
  - Header: sentence case label (`text-sm font-medium text-muted-foreground`) and a muted icon. Colour only for a real warning or problem.
  - Metric: tabular numeral (`text-2xl font-semibold tabular-nums`). Figures wrap and are never cut off.
  - Subtitle: compact description (`text-xs text-muted-foreground`).
- **Minimum text size is 12px.** No `text-[10px]` or `text-[11px]`. Labels are sentence case. Only codes such as vehicle numbers stay in capitals.
- **Colour:** Shakarganj red is the one accent, for the main action, the selected item or a real problem. Neutrals come from tokens, not `slate-*` classes.
- **Interactive List / Queue Cards:**
  - Active / Selected item: `border-primary ring-1 ring-primary bg-primary/5` (never a heavy solid color block).
  - Hover transition: `hover:bg-subtle hover:border-border-strong transition-all duration-150`.

### 2A. Typography: one relative scale (added 16 Nov 2026)
Sizes are `rem`, a percentage of the person's own browser font size, so text grows and shrinks when they change that setting or zoom. The page root is `font-size: 100%`. Never use pixel font sizes (`text-[13px]`): `npm run check:ui-text` fails them. Sizes are the same on every screen width (no `vw` scaling). Pixel values below are at the default 100% (16px).

| Class | Size | Use for |
|---|---|---|
| `text-xs` | 75% (12px) | Captions, table headers, badges, hints, timestamps |
| `text-sm` | 81.25% (13px) | Secondary text, form labels, table cells, buttons |
| `text-base` | 87.5% (14px) | Body text. This is the default when no class is set |
| `text-lg` | 100% (16px) | Card and section titles, dialog titles |
| `text-xl` | 112.5% (18px) | Page titles (one per page) |
| `text-2xl` | 125% (20px) | Large figures: KPI values |
| `text-3xl` | 150% (24px) | Headline figures only, at most one or two per screen |

Rules:
- Use at most three sizes inside one card: title (`text-lg` or `text-sm font-medium`), value, caption (`text-xs`).
- Weight shows importance before size does: `font-semibold` for titles and figures, `font-medium` for labels, normal for body. No `font-bold` on body text, no `font-black`.
- Figures use `tabular-nums`. Codes (vehicle numbers, tokens, seals) use `font-mono`.
- Minimum size is `text-xs`. Phones keep 16px inside inputs (globals.css) because iPhones zoom into smaller inputs.
- Never set a large size to make something "stand out": use colour (red accent) or position instead.

### 2B. Wording: short on screen, details behind the info icon (added 16 Nov 2026)
- Headings and card titles: 1 to 4 words. Labels, table headers, tabs and buttons: 1 to 3 words. Buttons start with a verb ("Save", "Add shop").
- Helper or subtitle lines: about 8 words at most. Anything that explains how or why goes in an `InfoTip` next to the heading or label. No paragraphs on screen.
- Empty states: 2 to 6 words ("No vehicles yet"). Toasts and error popups: one short sentence that says what happened and what to do.
- Sentence case. Keep names as they are: ZMCC, HC, Fat, LR, SNF, TS, @13 TS, Mobile Tester, PHE, MDO, QA.
- No "Please", no exclamation marks, no jargon (Ad-Hoc, Authoritative, Canonical, Telemetry, Payload) and no hype words.
- Enforced by `npm run check:ui-text`: on-screen text over 60 characters and popup text over 90 characters fail the check.

### B. Buttons & Touch Ergonomics
- **Industrial Touch Targets:** All interactive controls (buttons, icon triggers, form inputs) must maintain a strict minimum touch target of `min-h-11` (44px) and `min-w-11` (44px) for reliable operation on mobile devices and touch monitors in the field.
- **Button Variants:**
  - Use `Button` from `@/components/ui/button` with `default`, `outline`, `destructive` or `ghost`. One main action per area; the rest are `outline` or `ghost`.
  - **Success / Accept:** `min-h-11 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors`
  - **Destructive actions** ask first with `confirmAction` from `@/components/ui/confirm-dialog`. Never use the browser's `confirm()`.
- **Button Decluttering Rules:**
  - Do NOT stack redundant buttons (e.g. separate "View", "Details", "Inspect" buttons on every row).
  - Tapping a queue card directly opens the inspection Drawer/Modal.
  - Rejection buttons require a minimum 5-character reason before becoming clickable (`disabled={remarks.trim().length < 5}`).

### C. Responsive Dialog Architecture: Drawers vs. Modals
All forms, parameter entries, and decision dialogs implement responsive dual-mode presentation:

```tsx
// Pattern: Responsive Drawer (Mobile) vs Modal (Desktop)
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Modal, ModalContent } from '@/components/ui/modal';

export function ActionDialog({ isOpen, onClose, title, children }: ActionDialogProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  if (isDesktop) {
    return (
      <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <ModalContent className="max-w-2xl p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-foreground mb-4">{title}</h3>
          {children}
        </ModalContent>
      </Modal>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[90dvh]">
        <div className="p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4 overflow-y-auto">
          <DrawerTitle className="text-lg font-semibold text-foreground">{title}</DrawerTitle>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
```

- **Bottom Sheet Drawer (Mobile `<1024px`):** Slides smoothly from screen bottom, provides drag handle, uses natural thumb zones, and reserves bottom spacing for safe areas.
- **Center Modal (Desktop `≥1024px`):** Centered pop-up dialog with focus trap, backdrop blur (`backdrop-blur-xs`), and `Escape` key dismissal.

---

## 3. Semantic Color Palette & Quality Coding

All colors are mapped to CSS variables in `src/app/globals.css` and applied via Tailwind utility classes. Direct hard-coded hex colors in JSX are forbidden.

| Semantic Purpose | Background Class | Text Class | Border / Badge Class | Operational Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Pass / Accepted** | `bg-emerald-50` | `text-emerald-800` | `border-emerald-200 bg-emerald-100` | Lab test in SOP spec, portion accepted, active silo, vehicle entry approved. |
| **Fail / Rejected** | `bg-rose-50` | `text-rose-800` | `border-rose-200 bg-rose-100` | Adulteration detected, test failed SOP, portion rejected, journey cancelled. |
| **Exception / Warning** | `bg-amber-50` | `text-amber-800` | `border-amber-200 bg-amber-100` | Out-of-spec test requiring manager decision, SLA warning, missing photo. |
| **Contractor Direct** | `bg-amber-50/70`| `text-amber-900` | `border-amber-300` | Third-party direct plant contractor deliveries and allocation tags. |
| **Primary / Corporate** | `bg-primary` | `text-primary` | `border-primary` | SFPL corporate brand, primary submit actions, active navigation indicator. |
| **ZMCC Regional** | `bg-muted` | `text-foreground`| `border-border` | ZMCC chilling centers, regional tanks, bulk tanker dispatches (no violet: brand colours only). |
| **Mobile Tester Field** | `bg-blue-50` | `text-blue-800` | `border-blue-200` | Village shop collection, route tracking, mobile tester operations. |
| **Neutral Surface** | `bg-background` | `text-foreground`| `border-border` | Default page body, subtle dividers, cards, low-glare dark-shift surfaces. |

---

## 4. Pure Sidebar Navigation Standard (Zero In-Page Tab Clutter)

To prevent visual clutter, confusion, and duplicate navigation bars:
1. **No Big-Page Tab Rows:** Screens must not display stacked in-page tab switchers (`SegmentedTabs`) when the sidebar already provides those links.
2. **Dynamic Header Synchronization:** The page title and subtitle dynamically reflect the current URL query state:
   - `/department/weighbridge?tab=FIRST_WEIGHT` $\rightarrow$ Title: *"Weighbridge · First Weight (Gross)"*
   - `/department/weighbridge?tab=SECOND_WEIGHT` $\rightarrow$ Title: *"Weighbridge · Second Weight (Tare)"*
   - `/department/production?tab=READY` $\rightarrow$ Title: *"Production · Ready for Unloading"*
   - `/department/production?tab=UNLOADING` $\rightarrow$ Title: *"Production · Active Unloading"*
   - `/department/qa?tab=WAITING` $\rightarrow$ Title: *"QA Laboratory · Waiting Queue"*
3. **Dynamic Station Delegation Navigation:**
   - When a superior (ZMCC Manager, MPD Head, Super Admin) covers or inspects a subordinate's station (e.g. `/phe`, `/mot`, `/department/weighbridge`, `/department/qa`), the collapsible `HierarchicalNavDrawer` automatically mounts that station's full operational navigation tree.
   - A pinned, high-contrast button **"← Return to [Superior Role] Workspace"** is rendered at the top of the sidebar for single-click exit.

---

## 5. Form Ergonomics & Input Controls

1. **Combobox & Searchable Selects:**
   - Replace long, unsearchable native select dropdowns with searchable `Combobox` (built with Radix `Popover` + `Command` filter).
   - Instant search filtering for hundreds of village shops, routes, HC suppliers, and ERP milk sources.
2. **Monospace & Code Capitalization:**
   - All codes, license plates, token numbers, and seal IDs automatically capitalize: `font-mono uppercase font-bold tracking-wider`.
   - Examples: `LHR-3041`, `WB-101`, `SEAL-98421`, `CONT-001`.
3. **Tabular Numerals for Scientific Figures:**
   - All weights, volumes, temperatures, LR, Fat, and financial metrics use `tabular-nums font-semibold` to prevent layout jitter when live telemetry updates.
4. **Mandatory Justification for Negative Actions:**
   - Any rejection, exception override, hold, or manual penalty requires a minimum 5-character reason before submission is enabled.

---

## 6. Performance & Optimized Data Fetching (TanStack Query)

To guarantee the application never lags, stalls, or over-fetches:

1. **Keep Previous Data (`placeholderData: keepPreviousData`):**
   - When changing pages, switching date bounds, or filtering lists, previous data remains visible while the background request fetches. No blank screens or layout collapses.
2. **Debounced Search (`useDebouncedValue(query, 300)`):**
   - Search inputs debounce network requests by 300ms, preventing server spam on fast typing.
3. **Targeted Invalidation Over Heavy Refetching:**
   - Mutations (`useMutation`) invalidate only their specific query keys (`queryClient.invalidateQueries({ queryKey: [...] })`).
4. **Adaptive Live Board Polling:**
   - Active operational queue boards poll every 30 seconds (`refetchInterval: 30_000`).
   - Automatically pauses when the browser tab is hidden or minimized, conserving client battery and server CPU.

---

## 7. Framer Motion Micro-Animations

Animations are kept professional, subtle, and high-performance:

- **Page Transitions:** `<PageTransition>` gently slides and fades pages on route changes (`y: 6 -> 0, opacity: 0 -> 1, duration: 0.15s`).
- **Drawer / Panel Entrances:** `fadeSlide` preset for smooth, non-jarring appearance.
- **Banners & Feedback Alerts:** Wrapped in `<AnimatePresence>` for clean entry and exit transitions without abrupt layout snapping.
- **Never Use Heavy Animations:** No looping bounces, 3D rotations, or slow sliding carousels in operational data views.

---

## 8. Screen Size Breakpoints (Tailwind Standards)

- **Mobile Phones (`< 640px`):** Single-column layout, bottom drawers, full-width touch cards, hidden secondary table columns.
- **Tablets (`640px – 1023px`):** 2-column KPI grids, condensed data tables with horizontal scroll, bottom drawer dialogs.
- **Desktops (`≥ 1024px`):** Multi-column split views (Queue list on left, test panel on right), centered Modal dialogs, expanded audit tables.

---

*This document defines the immutable UI/UX standards for all existing and future frontend development in the Shakarganj Milk Reception application.*

## 8A. Shared Patterns (added 8 Nov 2026)

- **Fits every screen:** layouts follow available space, not a list of phones. Use `grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))]` and container queries instead of fixed columns. Test with `npm run test:layout`, which covers 280px to 2560px.
- **Lists:** `DataTable` shows cards when narrow and columns when wide. Filters use `DataFilters`.
- **Loading:** `PageLoader` for a page, `SkeletonList`, `SkeletonTable` or `SkeletonStats` for a panel, `ButtonLoader` for a pressed button, `ProgressBarLoader` for uploads and exports. `PulsingLoader` only for something live. `FullScreenLoader` only when the operator must wait.
- **Empty and error:** `EmptyState` and `ErrorState`. Each app section has its own `error.tsx` and `loading.tsx`.
- **Dates and numbers:** `formatDate`, `formatTime`, `formatDateTime` and `formatNumber` from `@/lib/format`.
- **Optimistic updates:** only for low-risk actions such as marking a notification read. Weights, lab results and approvals always wait for the server.
- **Bulk actions:** only for users, master data and notifications. Never for approvals, weights, lab results or dispatches, because each needs its own reason and audit record.
- **Wording:** journeys say Active shops, because a journey is built from the route's active shops. Use Mobile Tester and HC, never MOT or Local Supplier.

## 9. Role-Based Data Visibility & Field-Screen Patterns (added 23 Oct 2026)

- **Net-only operator screens:** weighing screens for MDO / PHE Operator show portion labels and net quantity only. Gross litres, 13 TS litres, LR, SNF and TS appear from ZMCC Manager upwards (dashboards and reports).
- **Names, not codes:** source dropdowns show the source name only. ERP codes appear only for MPD Head, Super Admin, Data Executive (and reporting roles).
- **Ready-cards + Drawer:** list only items that are ready for the user's action; tapping a card opens the entry Drawer (mobile) / modal (desktop). The weighing drawer has WEIGHT / MANUAL modes (manual only when the Super Admin policy allows it, and only in the allowed unit) and one primary action ("Unload to ZMCC tank").
- **No correction clutter below Data Executive:** no correction counts, "n/5" badges, "Locked" labels or correct buttons. Lower roles see a "Request correction" ticket button and the status of their own tickets (Open, Approved, Rejected, Done).
- **Labels:** Mobile Tester and HC only (never "Local Supplier" / "Contractor arrival" / "MOT" / "MC" in visible text; use "Mobile Tester").
