# Milk Procurement Management System Refactor Plan

Status: approved direction, implementation pending  
Project location: existing `MilkReceptionApp` repository  
Technology direction: Next.js and TypeScript remain in use

## 1. Purpose

### Test execution timing

Implementation tasks may add or update test cases, but routine unit, integration, end-to-end, and full regression suites are deferred until all requested project tasks are complete or the product owner explicitly asks to run tests. Deferred test execution must be recorded as pending. A phase gate is not considered finally verified until its required deferred checks have passed.

This plan reorganizes the existing application into a maintainable management system without creating a second project or performing a full rewrite. Work will happen incrementally in this repository. Each completed slice must preserve existing behavior, add authorization and tests where needed, and leave the application in a deployable state.

The refactor has four main goals:

1. Make authority, visibility, and correction rights match the organization hierarchy.
2. Isolate business rules from pages, route handlers, Prisma, and UI components.
3. Give managers and heads reliable operational views without granting unnecessary write access.
4. Make future features safer by using stable module boundaries, explicit contracts, audit history, and meaningful tests.

## 2. Confirmed organization hierarchy

```text
Super Admin
|-- Senior Executive Management
|-- Data Executive
|-- MPD Head
|   |-- ZMCC Manager
|   |   |-- PHE Operator
|   |   |-- ZMCC Lab Attendant
|   |   `-- MOT
|   `-- Contractor Manager
|       `-- Contractor Operator
|-- Admin Head
|   `-- Security Operator
|-- QA Head
|   `-- QA Manager
|       `-- Lab Attendant QA
|-- Production Head
|   |-- Weighbridge Operator
|   `-- Production Reception Operator
`-- Finance and Accounts
```

Confirmed rules:

- Super Admin has complete authority throughout the application for legitimate business actions.
- A head can view the work of roles below that head in the same branch.
- A manager can view and manage only the people, locations, and records within that manager's assigned scope.
- Seeing a record does not automatically grant permission to create, edit, approve, cancel, or financially post it.
- Cross-department access must be granted through an explicit capability, not inferred from a high-sounding role name.
- Every privileged change must record the actor, date and time, reason, old value, new value, and affected business record.

This hierarchy describes organizational responsibility. The application must implement it through capabilities and data scope rather than scattered role-name checks.

## 3. Current-state assessment

### 3.1 What is already good

- The application covers a substantial end-to-end flow: MOT collection, ZMCC arrival and laboratory processing, tank stock, dispatch, plant gate, weighbridge, QA, production reception, and reporting.
- Prisma models and migrations represent many real factory concepts rather than a generic CRUD application.
- MOT journey summaries already preserve total gross liters, total liters at 13% total solids, weighted test values, and shop counts.
- The ZMCC arrival workspace already shows an MOT journey summary during reception.
- The ZMCC Manager workspace already has useful sections for overview, live operations, reconciliation, history, reports, and master data.
- Dispatch-to-plant reconciliation already compares gross and 13TS quantities at later stages of the flow.
- Paper references are partly separated from internal system identities.
- The existing unit suite provides a useful baseline and currently passes.

### 3.2 Main architectural problems

- Route handlers frequently call Prisma directly and combine authentication, validation, business decisions, persistence, and response formatting.
- Business calculations and backend types are imported into UI areas, creating coupling between presentation and infrastructure.
- Authorization is implemented through repeated role checks, and different pages and APIs sometimes disagree about who is allowed.
- Some workspaces and services are too large and contain several reasons to change.
- Important workflows lack a single application service and a single transaction boundary.
- Derived values and correction effects are not governed consistently across all modules.
- Current high-level role routing sends some users to screens whose APIs do not authorize them.
- The unfinished commercial-supplier work is present in the schema without a completed migration and should not be mixed into the architectural refactor.

### 3.3 Current management-view gaps

#### ZMCC Manager

The current workspace is the closest to the requested operational view. It still needs a stable read model that applies the manager's source scope consistently and combines arrival, lab, tank, dispatch, exception, and correction information without UI-side joining.

#### MPD Head

The current MPD Head page mainly exposes milk-test policy management. It does not yet provide the required branch-wide management view or a complete MOT-to-ZMCC comparison.

#### Admin Head

The current security-management route provides a base for subordinate management. It needs an Admin Head dashboard that includes security activity and a restricted vehicle-status view.

#### TV board

The existing TV board is designed as a privacy-conscious yard display. For the Admin Head requirement, its read model must explicitly return only vehicles currently inside the plant and their normalized current stage. Sensitive supplier, quantity, quality, commercial, and payment information must not be included in the response.

## 4. Required management views

### 4.1 ZMCC Manager view

The ZMCC Manager sees only the assigned ZMCC/source and the work of PHE Operators, ZMCC Lab Attendants, and MOT personnel in that scope.

The workspace should contain:

- vehicles expected, arrived, waiting, under test, accepted, rejected, unloaded, and dispatched;
- the vehicle's current stage and the responsible station;
- raw milk token and relevant system identifiers;
- MOT journey totals and the corresponding ZMCC result;
- accepted and rejected quantities recorded by the ZMCC laboratory process;
- tank stock and dispatch readiness;
- open exceptions, correction requests, and overdue work;
- recent actions by subordinate roles;
- source-scoped history and reports.

The manager may correct eligible operational mistakes according to the approved field and record-lifecycle rules. Higher-impact changes are submitted to the MPD Head. Closed or financially posted records require an adjustment or Super Admin action according to the correction policy. Gain/loss percentage does not itself grant permission to edit an authoritative quantity or laboratory result.

### 4.2 MPD Head view

The MPD Head sees all ZMCC Managers, Contractor Managers, and their subordinate operations in the MPD branch. The view must support filtering by date, source/ZMCC, route, MOT, vehicle, status, and exception state.

The central MOT-to-ZMCC comparison should expose at least:

| Field | Meaning |
|---|---|
| Journey and vehicle | The physical movement being reconciled |
| MOT and source/ZMCC | Responsible person and receiving location |
| Shop count | Number of shop collections included in the journey |
| MOT gross liters | Physical liters reported from accepted shop collections |
| MOT liters at 13TS | Commercial-equivalent quantity calculated from shop collections |
| ZMCC measured gross liters | Quantity measured when the vehicle is processed at ZMCC |
| ZMCC liters at 13TS | Quantity derived from the final approved ZMCC test inputs |
| ZMCC accepted quantity | Quantity accepted into ZMCC stock |
| ZMCC rejected quantity | Quantity rejected through the ZMCC decision |
| Gross variance | ZMCC measured gross liters minus MOT gross liters |
| 13TS variance | ZMCC final 13TS liters minus MOT 13TS liters |
| Exception state | Within target, outside target, pending test, rejected, or unresolved |
| Record state | Draft, submitted, approved, closed, corrected, or adjusted |

Gross liters remain the physical quantity truth. Liters at 13TS remain the normalized commercial and gain/loss quantity. Both comparisons must be shown; one must not overwrite the other.

The read model must use stored journey and lab results as its sources. The UI must not recalculate authoritative totals independently.

### 4.3 Complete gain/loss reporting

Gain/loss is an operational and financial performance measurement. It is separate from correction authority. The report contains three related views.

#### A. Area gain/loss: MOT shop collection to ZMCC

This shows the movement for which the MOT and ZMCC operation are responsible:

```text
area signed variance = ZMCC measured quantity - MOT shop collection quantity
area loss quantity   = max(MOT shop collection quantity - ZMCC measured quantity, 0)
area gain quantity   = max(ZMCC measured quantity - MOT shop collection quantity, 0)
area loss percent    = area loss quantity / MOT shop collection quantity * 100
```

The calculation is performed separately for gross liters and liters at 13TS. ZMCC accepted and rejected quantities remain visible as disposition information. Rejected milk must not be disguised as transport loss: arrival measurement variance and rejection disposition are separate facts.

ZMCC Manager sees this report for the assigned ZMCC, areas, MOT journeys, and staff. MPD Head and Finance can see the consolidated MPD result and drill down through ZMCC, area, route, MOT, journey, vehicle, and shop.

#### B. Route gain/loss: ZMCC dispatch to plant receipt

This shows the second physical movement:

```text
route signed variance = plant received quantity - ZMCC dispatched quantity
route loss quantity   = max(ZMCC dispatched quantity - plant received quantity, 0)
route gain quantity   = max(plant received quantity - ZMCC dispatched quantity, 0)
route loss percent    = route loss quantity / ZMCC dispatched quantity * 100
```

The calculation is performed separately for gross liters and liters at 13TS. ZMCC Manager sees routes dispatched from the assigned ZMCC. MPD Head and Finance see all MPD routes and their consolidated result. Responsibility remains with the MPD movement until the plant records receipt; the report must not assign this result to a plant contractor merely because the destination is the plant.

#### C. Complete MPD month-to-date result

Finance and MPD Head need the whole MPD month-to-date result from MOT shop collection through plant receipt. Because milk may remain in ZMCC tanks across a day or month boundary, raw shop totals must not be compared directly with plant receipts without a stock bridge.

The MTD mass balance must start from the MPD-owned origin quantity, including MOT shop collections and any separately identified direct MPD procurement source that Finance includes in the report scope. Plant-contractor-owned quantities are excluded from this MPD KPI. The scope and exclusions must be visible on the report.

The MTD mass balance must include:

```text
MPD quantity available = opening ZMCC stock + MPD origin quantities collected/procured
MPD quantity accounted = plant receipts + closing ZMCC stock
                       + approved rejection/disposal/transfer quantities
unexplained loss       = max(MPD quantity available - MPD quantity accounted, 0)
unexplained gain       = max(MPD quantity accounted - MPD quantity available, 0)
MTD loss percent       = unexplained loss / MPD quantity available * 100
```

The complete report must reconcile its total into area variance, ZMCC rejection/disposal, ZMCC stock/handling variance, route variance, and unresolved items. It must show **total loss before offsetting gains**, **total gain**, and **net variance** separately so gains cannot silently hide problem routes or areas.

Finance's initial MTD target is **loss below 1.5%**. The official commercial KPI uses liters at 13TS because payment and commercial gain/loss use normalized milk solids. Gross-liter MTD loss remains visible beside it as the physical-volume KPI. A value below 1.5% is within target; 1.5% or more is a target breach requiring investigation. Only Super Admin can activate an increase or decrease to this target. Every change requires a reason, effective date, version, and audit record. Changing the target does not grant permission to change operational data.

The report must show finalized values, pending/unmatched movements, opening stock, closing stock, rejection/disposal, and the selected period. Pending movements are not silently treated as loss. Historical reports retain the target version and calculation version used at the time.

#### Gain/loss visibility

| Role | Visibility |
|---|---|
| ZMCC Manager | Assigned ZMCC area and route gain/loss, individual MOT/journey/vehicle detail, and assigned-source MTD contribution |
| MPD Head | All MPD area and route results, full MTD result, exceptions, trends, and drill-down |
| Finance and Accounts | Consolidated complete MPD MTD result plus reconciliation drill-down required to verify the number |
| Super Admin | All reports, configurations, versions, and audit history |

### 4.4 Admin Head view

The Admin Head sees Security Operators and records within the administration/security branch. The operational dashboard should show:

- active security staff and relevant duty/activity status;
- vehicles currently inside the plant;
- each vehicle's normalized current stage;
- timestamps needed to identify waiting or delayed vehicles;
- security exceptions that require Admin Head attention.

The vehicle-stage projection must not reveal milk quantities, lab values, supplier financial details, payment data, rates, or internal correction discussions.

### 4.5 Laboratory test and final-decision governance

#### Required separation of responsibilities

The laboratory result, system evaluation, attendant recommendation, and final business decision are different facts and must be stored separately.

| Stage | ZMCC | Plant |
|---|---|---|
| Perform tests and record observed values | ZMCC Lab Attendant | QA Lab Attendant |
| Evaluate values against frozen min/max/options | System | System |
| Submit recommendation | ZMCC Lab Attendant | QA Lab Attendant |
| Make final accept/reject decision | ZMCC Manager | QA Manager |
| View/escalate governance matters | MPD Head | QA Head |
| Exceptional full-authority action | Super Admin, with reason and audit | Super Admin, with reason and audit |

An attendant never changes the min/max rule while testing and does not make the final accept/reject decision. The attendant completes the evidence and recommends `ACCEPT`, `REJECT`, or `HOLD`. The manager reviews that evidence and records the final decision.

The system evaluation behaves as follows:

- `PASS`: all required release tests satisfy their frozen rule versions. The attendant may recommend acceptance; the manager still makes the final decision.
- `OUT_OF_SPEC`: at least one required release test fails. The system recommends rejection and sends the case to the manager. It does not silently turn the recommendation into a final decision.
- `WARNING`: a monitoring limit was exceeded but no release rule failed. It remains visible and does not by itself reject milk.
- `NO_ACTIVE_RULE` or `RULE_CONFIGURATION_ERROR`: final acceptance is blocked. A manager cannot bypass missing or invalid quality configuration.
- A manager accepting an out-of-spec exception must record the failed tests, reason, evidence, and decision timestamp. Tests later classified as non-overridable hard stops cannot be exception-accepted.

At ZMCC, tank receipt/stock entry and Local Supplier RMR issuance happen only after the ZMCC Manager's final acceptance. At the plant, movement to weighbridge/unloading happens only after the QA Manager's final acceptance. A rejected decision records the responsible actor and reason and follows the physical exit/disposition workflow.

Both managers need a live decision queue with waiting time and alerts. In-spec `PASS` recommendations may support a controlled batch-approval action, but every session still stores its own manager, timestamp, final decision, and policy snapshot. `OUT_OF_SPEC`, warning, hold, and rejection recommendations require individual review.

After a final decision, changing test evidence or the decision uses correction governance. The original observations, system outcome, attendant recommendation, manager decision, and all later corrections remain visible. Physical events that already occurred are never fabricated or reversed by merely changing a status.

#### Official laboratory rule snapshot

The following active database rules were observed and confirmed as official on 2026-09-21. Future changes use a new effective-dated version and do not rewrite the rule applied to a historical session.

| Testing point | Test | Current release/monitoring rule |
|---|---|---|
| ZMCC MOT, Local Supplier, and legacy Contractor | Temperature | Release: 0 to 10 degrees C |
| ZMCC MOT, Local Supplier, and legacy Contractor | Acidity | Release: 0.10% to 0.16% |
| ZMCC MOT, Local Supplier, and legacy Contractor | LR at 20 C | Release: 26 to 32 |
| ZMCC MOT, Local Supplier, and legacy Contractor | Fat | Release: 3.5% to 5.5% |
| ZMCC MOT, Local Supplier, and legacy Contractor | Clot on Boiling | Release: NEGATIVE |
| Plant QA | Temperature | Release: 0 to 10 degrees C |
| Plant QA | Acidity | Release: 0.10% to 0.16% |
| Plant QA | LR at 20 C | Release: 26 to 32 |
| Plant QA | Fat | Release: 3.5% to 5.5% |
| Plant QA | Clot on Boiling | Release: NEGATIVE |
| Plant QA | Organoleptic Smell | Release: OK |
| Plant QA | Organoleptic Taste | Release: OK |
| Plant QA | BR Value | Monitoring: 39 to 42; neutral consequence |

The database inspection also found these implementation gaps:

- Active ZMCC test assignments currently contain only LR and Fat for MOT and legacy Contractor sessions.
- No active Local Supplier ZMCC policy assignment appeared, although Local Supplier release rules exist.
- Temperature, Acidity, and Clot-on-Boiling rules cannot protect a session when those tests are not assigned to it.
- Plant QA builds assignments from active master-test scope, while ZMCC uses `MilkTestPolicyAssignment`; these are inconsistent policy sources.
- Current attendants can finalize normal in-spec acceptance and manual rejection. Managers receive only out-of-spec exception cases, which conflicts with the confirmed final-decision ownership.
- The ZMCC exception route currently excludes Super Admin for a pending exception, and the Plant QA manager-decision route allows only QA Manager. This conflicts with Super Admin's confirmed full authority.
- The QA Head rule endpoint can create rules, while the Super Admin rule endpoint is read-only. Policy governance must be unified.

The current official tests are release or monitoring tests as shown above. No current test has yet been separately classified as a non-overridable hard stop. Any future antibiotic, adulteration, contamination, or other safety test must declare whether it is a hard stop before activation.

#### Laboratory policy authority

Laboratory configuration authority is intentionally split:

| Configuration | Primary role | Rule |
|---|---|---|
| Numeric min/max, categorical passing option, quality consequence, and hard-stop classification | QA Head | Can directly create and activate a new effective rule version with a mandatory reason |
| Add/update test definition, testing-point and source applicability assignment, required/display settings, activate/deactivate test | Data Executive (data-correction role) | Can directly maintain catalog and assignment metadata with a mandatory reason |
| All laboratory configuration above | Super Admin | Has complete authority and may act whenever needed |

QA Head does not add, rename, activate, deactivate, or reassign test definitions. Data Executive does not decide or alter laboratory acceptance limits. Super Admin can perform either responsibility. Every change is audited and versioned. ZMCC Manager, QA Manager, attendants, MPD Head, and other roles may read the rules relevant to their work but cannot change laboratory configuration while processing a vehicle.

#### Extensible laboratory catalog and testing points

A test definition and its use at a testing point must remain separate:

- The test catalog defines stable code, name, result type, unit, allowed categorical options, and active status.
- A testing-point assignment defines where the test is used, whether it is required, its display order, applicable milk/source type, and effective dates.
- A rule version defines min/max or passing option, release/monitoring/informational category, consequence, effective dates, author, and reason.
- A session snapshot freezes the assigned test and rule version used for that actual test.

The business testing points are:

| Business point | Current code mapping | Purpose |
|---|---|---|
| MOT shop collection | `MOT_SHOP` | Tests performed by MOT while collecting at a shop |
| ZMCC intake | `ZMCC_LAB_MOT` and `ZMCC_LAB_LOCAL_SUPPLIER` | Tests for a vehicle or direct supplier entering ZMCC; source applicability may differ |
| ZMCC dispatch | `DISPATCH` | Tests before milk leaves ZMCC for the plant |
| Plant intake QA | `PLANT_QA` | Tests when the dispatched vehicle reaches the plant |

The target model should represent the physical testing point separately from optional source applicability. This avoids copying the same rule merely because ZMCC intake came from MOT or a Local Supplier, while still allowing a test to apply only to a selected source type when required.

Adding a future test follows this sequence:

1. Data Executive or Super Admin creates the test definition.
2. Data Executive or Super Admin assigns it to one or more testing points and optional source types.
3. QA Head or Super Admin defines its numeric/categorical acceptance rule, consequence, and effective date.
4. The system validates that required tests have one valid active rule before activation.
5. New sessions use the new version; sessions already started keep their frozen snapshot.
6. Deactivation stops future assignment but preserves all historical results.

### 4.6 MOT journey map and location tracking

MOT location tracking runs only for the MOT's own active `COLLECTING` journey while the MOT application is open and location permission is enabled. It stops when the journey ends or is cancelled, the user signs out, or the application is no longer active enough for the browser to supply location. The system must never track an MOT outside an active assigned journey.

The journey map must show:

- assignment/dispatch start point and time;
- first location reported by the MOT device;
- chronological route trail;
- planned shop stops and actual collection/check-in positions;
- visited, skipped, pending, and unplanned stops;
- duration at a stop where reliable points are available;
- latest reported position, accuracy, and last-sync time;
- final MOT device point;
- ZMCC arrival/end point and time;
- gaps where location permission, GPS, connectivity, or the open application was unavailable.

Location points are append-only evidence. A user may flag an inaccurate point but cannot drag, replace, or delete the original trail. The server stores device time, server-received time, accuracy, source, journey, and idempotency identity. Implausible jumps, stale points, duplicate identities, invalid coordinates, and points outside the journey time window are rejected or flagged.

Offline points are queued on the MOT device and synchronized when connectivity returns. A visible tracking indicator must tell the MOT when tracking is active, the last point time, GPS accuracy, unsynced point count, and permission/error state. The UI must clearly explain that closing or backgrounding the browser may stop foreground web tracking.

Map visibility follows hierarchy and scope:

| Role | Location visibility |
|---|---|
| MOT | Own active and authorized historical journeys |
| PHE Operator | Journeys for the assigned ZMCC needed for arrival duty |
| ZMCC Manager | Journeys belonging to the assigned ZMCC |
| MPD Head | All MPD MOT journeys |
| Super Admin | All journey maps and location audit information |

Finance, unrelated departments, and public/TV-board views do not receive detailed MOT coordinates.

The current implementation already stores journey start, first/final MOT GPS, timestamped GPS trail points, planned stops, collection coordinates, and a ZMCC arrival endpoint. It captures one browser position approximately every 60 seconds, supports offline queuing, and validates journey ownership and timestamps on upload.

Current gaps to address:

- The manager display is a schematic coordinate projection without geographic basemap or road context.
- It fetches a snapshot and requires manual refresh rather than subscribing or polling as a live map.
- MPD Head and MOT are not included in the current map read authorization.
- The first periodic point may not be captured until approximately 60 seconds after the page becomes active.
- Foreground browser timers and GPS may be suspended when the phone locks or the application is backgrounded.
- Planned/visited shop stops exist, but automatic unplanned-stop/dwell detection is not implemented.
- Retention, export, and privacy-access audit rules for detailed GPS history still require implementation.

#### Selected map technology

Use **MapLibre GL JS** as the browser map renderer and **PMTiles** as the offline vector-map archive format. Both are suitable for TypeScript and allow the application to avoid a paid per-request map SDK. MapLibre renders the GPS trail and map data; it does not improve GPS hardware accuracy. Accuracy continues to come from the device and is stored on each point.

Use OpenStreetMap-derived data with visible attribution, but do not bulk-download or build offline packs from the public `tile.openstreetmap.org` service. Its usage policy prohibits offline downloads. Generate or obtain a permitted vector dataset, produce controlled PMTiles packs, and host those packs and all required style, glyph, and sprite assets through the factory system.

Do not package all zoom levels for all of Pakistan on every device. Prepare manageable packs by assigned ZMCC/route region and approved zoom range. The application downloads the required pack while online, verifies its version/checksum, and keeps it for offline journeys. The schematic map remains as a fallback when a device lacks a usable map pack.

#### Offline-first MOT application

The MOT web application must become an installable Progressive Web App (PWA). A device must connect once for installation, authentication, initial assignment download, and offline-map preparation. After this preparation, the installed MOT application can reopen without internet using a cached application shell.

Offline storage includes only the data required for the assigned MOT user and current work:

- application shell, JavaScript, CSS, icons, and offline page;
- previously authorized MOT identity/device session with a bounded offline-validity policy;
- assigned current journey, route, shops, test definitions/rules, and paper-reference requirements;
- route-area PMTiles pack, map style, glyphs, and sprites;
- draft and completed shop collections waiting to synchronize;
- GPS trail points waiting to synchronize;
- client-generated idempotency IDs and device event timestamps.

Offline work follows these rules:

- GPS capture continues without internet when device location services are available and the application remains open.
- The UI always shows `ONLINE`, `OFFLINE`, `SYNCING`, `SYNC ERROR`, or `OFFLINE AUTH EXPIRED`.
- Every offline write enters an append-only outbox before the UI reports it locally saved.
- Synchronization preserves the device event time and separately records server receipt time.
- Server validation, journey ownership, rule snapshot, duplicates, and chronology are rechecked during synchronization.
- Conflicts remain visible and require a defined resolution; they are never silently discarded.
- Administrative, manager, laboratory-manager approval, and financial actions are unavailable offline unless a later task explicitly designs a safe workflow for them.
- Passwords and unrestricted server sessions are not stored for offline login.
- A lost/revoked device is blocked at the next connection, and locally cached business data must have a protected removal process.

The existing IndexedDB queues for collections and GPS points are useful foundations, but they do not make the application itself available offline. The project currently has no web manifest, service worker, cached application shell, or offline map pack. Those elements must be implemented and tested together.

### 4.7 Shop and Local Supplier identity requirements

Phone number and CNIC are mandatory when creating a Shop owner record or Local Supplier. They remain mandatory while the record is active.

Current implementation status:

- `ZmccShop.phone_number` and `ZmccShop.cnic` are already non-null database fields, and the shop backend requires and validates both.
- `ZmccLocalSupplier.phone` and `ZmccLocalSupplier.cnic` are currently nullable, and the backend permits creating or updating a Local Supplier without them. This conflicts with the confirmed rule.

Target validation and privacy rules:

- Validate on the server for online requests and again when an offline request synchronizes.
- Accept supported Pakistani mobile formats at input, normalize the stored phone value to one canonical format, and keep formatting as a display concern.
- Accept a 13-digit CNIC with or without hyphens, normalize it consistently, and display it in the standard formatted form.
- Do not assume phone or CNIC is globally unique at the Shop row because one owner may legitimately operate more than one shop. Duplicate-identity policy should be based on the owner/business model rather than an accidental database constraint.
- Mask CNIC and phone in lists, logs, notifications, exports, and screens that do not require the complete value.
- Restrict full CNIC access to explicit capabilities and audit sensitive master-data changes.
- Never include a complete CNIC in a push notification, TV board, URL, or general-purpose audit message.

For Local Supplier rollout, require phone and CNIC for all new records immediately at the API level. Inventory existing rows with missing values, mark them incomplete, correct them through an audited workflow, and only then apply non-null database constraints. An incomplete Local Supplier must not be newly activated or used for a new arrival after the enforcement date.

### 4.8 Complete PWA and role-based notifications

The full management system should be installable as one Progressive Web App for all roles. Each role receives its normal scoped workspace after login. MOT receives the strongest offline operational workflow because field collection and GPS must continue without connectivity. Other roles receive the cached application shell, an offline status page, previously downloaded safe summaries where appropriate, and online-only controls for actions that require current server state.

A service worker caches versioned application assets and opens the installed application when the network is unavailable. IndexedDB stores permitted offline data and outbox records. Installing the application and preparing role data requires an initial online connection. Offline access does not bypass authentication, authorization, source scope, or record lifecycle.

#### Notification model

Notifications are generated from committed business events, not from page components. A transactionally reliable notification outbox prevents an alert from being sent for a transaction that later rolls back.

Each notification records:

- event type, priority, recipient user/role/scope, and related business record;
- deduplication key and event timestamp;
- safe title/body and authenticated deep link;
- channel and delivery attempts;
- queued, provider-accepted, failed, expired, opened, and read states;
- retry schedule and final failure reason.

`Provider accepted` must not be presented as proof that a person read the notification. Opening/read acknowledgement is recorded separately.

Users may configure optional alerts, quiet hours, and instant-versus-digest delivery. Mandatory operational or security alerts defined for a role cannot be disabled. Lock-screen notification text contains minimal information; sensitive quantity, quality, supplier, CNIC, financial, and correction details appear only after authenticated application access.

Initial role notification requirements include:

| Role | Examples of relevant notifications |
|---|---|
| Super Admin | Critical system/configuration failures, unresolved high-impact escalation, security events, and target/rule changes |
| Senior Executive Management | Approved high-level operational summaries and exceptional KPI breaches |
| Data Executive | Master-data correction requests, incomplete/duplicate records, failed imports, and synchronization conflicts |
| MPD Head | MTD loss target breach, cross-ZMCC exceptions, unresolved gain/loss, and escalated corrections |
| ZMCC Manager | Lab final-decision queue, OUT_OF_SPEC cases, delayed MOT journeys, GPS gaps, arrivals, dispatch exceptions, and correction requests |
| Contractor Manager | Assigned contractor-operation exceptions and pending decisions |
| Admin Head | Security exceptions, delayed in-plant vehicles, and gate incidents |
| QA Head | Missing/invalid lab rules, rule changes, hard-stop events, and escalated quality exceptions |
| QA Manager | Plant final-decision queue, OUT_OF_SPEC results, holds, and delayed QA cases |
| Production Head | Accepted vehicles awaiting production, unloading exceptions, and silo/production delays |
| Finance and Accounts | MTD loss status/breach, settlement readiness, posting exceptions, and financial adjustments |
| Operators/attendants | New assignments, vehicle arrival/readiness, returned work, approved/rejected correction requests, and urgent task changes |
| MOT | Journey assignment/change/cancellation, synchronization result, correction request, and route-related instruction |

Web push can notify an installed PWA while it is not open when the device has internet, the browser/platform supports push, permission is granted, and the subscription remains valid. Server-originated push cannot arrive while the device has no internet. It is queued according to event expiry and delivered or refreshed when connectivity returns. The in-app notification center remains the authoritative history.

Each signed-in device has its own revocable push subscription. Logout, password/security reset, account deactivation, role/scope change, or device removal revokes or refreshes affected subscriptions. Notification payloads and deep links are re-authorized when opened; possession of a notification never grants access to its record.

One offline user profile may be active in an installed application/device profile at a time. A shared phone can change users only through an online logout/user-switch operation that synchronizes or explicitly resolves pending work, revokes the previous push subscription, and removes the previous user's protected cached data. One user may register multiple devices, and each device can be named, reviewed, and revoked independently.

The current project has no service worker, push subscription model, VAPID configuration, notification event catalog, or push-delivery worker. Existing SMS/outbox code is not a substitute for Web Push and must not mark a notification delivered without calling a real provider.

## 5. Canonical paper and system references

Paper references must remain distinct from immutable system identities.

| Term | Business meaning | Current/target rule |
|---|---|---|
| Shop RMR (Raw Milk Receipt) | Receipt MOT gives a shop as proof that milk was collected and accepted from that shop | Linked to a shop collection; the collection number remains the immutable system identity |
| Local Supplier RMR | Receipt given to a supplier delivering directly to ZMCC when the milk is accepted | Issued by the ZMCC Lab Attendant only after acceptance and linked to the accepted arrival/lab outcome; uses a separate annual number series from Shop RMR |
| Raw Milk Token | Paper token PHE gives to every incoming vehicle/delivery at ZMCC according to duty | Required at arrival; unique according to the approved ZMCC token series rule |
| Raw Milk Dispatch Note | The only dispatch paper reference used for a vehicle sent from ZMCC toward the plant | Keep this distinct from the Raw Milk Token and Plant Gate Token; do not introduce a separate Dispatch Milk Token |
| Plant Gate Token | Plant-entry identity assigned to the vehicle visit | Separate plant-side system/paper reference |
| System identifiers | Collection number, ZMCC token, visit number, reception number, and database IDs | Immutable and never replaced by handwritten paper numbers |

Shop RMR and Local Supplier RMR use separate series. Each RMR record must store structured numbering fields rather than relying only on a formatted string: `document_year`, `series_code`, `book_number`, and `receipt_number`. Book numbering resets for each calendar year. The database uniqueness rule must include the RMR type/series, issuing source, year, book number, and receipt number. The printed representation may be formatted from these fields, but the fields remain independently searchable and auditable.

The current local-supplier `rmr_number` field is optional and captured too early to enforce the confirmed acceptance rule reliably. A focused database design and migration will be required before this workflow is implemented.

## 5.1 Partial acceptance and rejection

One vehicle/session may contain both accepted and rejected quantities only when the physical milk can actually be separated, such as identified tanker compartments or separately handled lots/containers. Each allocation must record its compartment or lot, measured quantity, lab result, decision, and reason.

The following invariant must hold within the approved rounding tolerance:

```text
accepted quantity + rejected quantity = total measured quantity
```

A homogeneous tanker with no physically separable compartments must not receive an arbitrary partial split. It receives a whole-arrival decision unless an authorized physical handling event proves how the accepted and rejected quantities were separated.

## 6. Correction and calculation governance

### 6.1 Record lifecycle

All important operational records should use an explicit lifecycle:

```text
Draft -> Submitted -> Approved/Accepted -> Closed/Posted
             |               |
             `-> Correction Request
```

- Operators may edit their own draft records within their scope.
- After submission, operators request a correction and provide a reason.
- Managers may correct approved low- or medium-impact fields in their scope when policy allows it.
- High-impact corrections require the branch head.
- Super Admin may perform any legitimate correction, including exceptional corrections at any time, but the original value and audit trail remain preserved.
- Closed, settled, or financially posted transactions should normally be changed through an adjustment, reversal, or superseding version rather than destructive overwriting.

### 6.2 Impact classification

Correction rules must classify fields by consequence:

- Low impact: notes and non-authoritative display metadata.
- Medium impact: operational facts that do not change stock, quality acceptance, supplier payable, or financial posting.
- High impact: quantity, LR, fat, SNF, TS, acceptance/rejection, source, supplier, rate, stock movement, dispatch, or any value used by settlement and accounting.

The exact field matrix will live with the relevant domain module and be exercised by authorization tests.

### 6.3 Derived calculations

- Users correct authoritative inputs; they do not type over a derived total.
- The application recalculates all affected downstream values with one approved formula implementation.
- Formula versions and rounding rules are recorded when a historical result must remain reproducible.
- A correction records its downstream effects on 13TS, stock, variance, payable, settlement, and reporting as applicable.
- Recalculation must occur inside a transaction or a reliable queued process with an explicit failure state.

### 6.4 Gain/loss target and investigation

The Finance target of MTD loss below 1.5% measures performance. It does not determine who may correct data. Correction authority continues to depend on the field's impact, the record lifecycle, the actor's role, and data scope.

- ZMCC Manager investigates area and route exceptions for the assigned source and records the cause and evidence.
- MPD Head reviews cross-source patterns, unresolved exceptions, and the complete MPD result.
- Finance verifies the consolidated MTD reconciliation and its financial impact.
- Super Admin controls exceptional administrative action and audited target configuration.
- Quantity, quality, stock, and posted financial values remain high-impact fields even when the resulting loss is below 1.5%.

The 1.5% target is effective-dated and versioned. Finance and MPD Head may recommend a change, but only Super Admin can activate it. Changing it never changes historical results or silently reclassifies an already closed reporting period.

### 6.5 Locking policy

Different events apply different locks:

- ZMCC acceptance locks direct operator editing. Later changes use the correction workflow.
- Daily close applies an operational lock. Reopening requires the authorized manager or head and a reason.
- Settlement generation freezes the financial inputs for that settlement draft. An unposted settlement must be voided and regenerated after an approved correction.
- Finance posting is the hard financial lock. Posted values are never overwritten; a correction creates a linked adjustment or reversal.
- Payment marks the posted liability as settled. Later adjustments flow through a new payable/recovery entry and retain their link to the original transaction.

Therefore, **Finance posting** is the event that makes a record financially locked. Earlier events progressively restrict editing, while payment controls how a later adjustment is settled.

## 7. Target architecture

The project should become a feature-first modular monolith. Next.js remains the delivery framework; it does not define the business architecture.

```text
src/
|-- app/                         # Next.js pages and thin route handlers
|-- modules/
|   |-- access-control/
|   |   |-- domain/
|   |   |-- application/
|   |   |-- infrastructure/
|   |   `-- presentation/
|   |-- management-reporting/
|   |-- mot-reconciliation/
|   |-- zmcc-reception/
|   |-- paper-references/
|   |-- correction-governance/
|   |-- dispatch/
|   |-- plant-reception/
|   `-- ...
|-- shared/
|   |-- domain/                 # Small stable value objects and errors
|   |-- application/            # Shared ports and transaction contracts
|   |-- infrastructure/         # Prisma, clock, IDs, queue, logging adapters
|   `-- presentation/           # Reusable UI primitives only
`-- generated/                  # Generated Prisma/client artifacts
```

Each feature may use these layers when they add value:

- `domain`: business concepts, invariants, policies, and pure calculations;
- `application`: use cases, commands, queries, authorization requirements, and ports;
- `infrastructure`: Prisma repositories and external adapters;
- `presentation`: route/controller mapping and feature UI.

Small features do not need empty folders merely to imitate a pattern. The dependency direction is the important rule.

### 7.1 Dependency rules

- Domain code imports neither Next.js nor Prisma.
- Application services depend on interfaces, not Prisma clients or React components.
- Route handlers authenticate, validate, call one application use case, and map the result to HTTP.
- UI components call typed feature APIs and never import server repositories.
- Business formulas have one implementation and one versioned rounding policy.
- Modules exchange IDs and deliberate contracts, not each other's database models.
- Read-only dashboards use dedicated query/read-model services. They do not reuse write services merely to assemble a screen.

### 7.2 Authorization design

Authorization decisions require all three inputs:

```text
can(actor, capability, resourceScope)
```

- `actor`: authenticated user and organizational assignment;
- `capability`: view, create, submit, correct, approve, close, post, administer, and similar actions;
- `resourceScope`: department, ZMCC/source, route, supplier, or specific record ownership.

The server is authoritative. Navigation and buttons reflect server capabilities but never replace server checks. Super Admin receives all defined capabilities while still using normal validation, transactional, and audit mechanisms.

## 8. Refactor strategy

The work must be incremental in the existing directory:

1. Capture current behavior with focused characterization tests.
2. Introduce shared access-control and audit contracts.
3. Build dedicated management read models before changing dashboard UI.
4. Implement one vertical business slice at a time.
5. Move rules out of routes and components only when that slice has tests.
6. Keep compatibility adapters temporarily where existing screens depend on old shapes.
7. Remove old paths only after callers have migrated and checks pass.

Do not combine broad file movement, business-rule changes, database changes, and UI redesign in one task. A task should have one reviewable reason to change.

## 9. Quality gates

Every completed slice must meet the checks relevant to it:

- authorization cases for allowed role, denied role, correct scope, wrong scope, and Super Admin;
- domain tests for formulas and invariants;
- application tests for lifecycle and correction behavior;
- repository/integration tests when a transaction, uniqueness rule, or concurrency rule matters;
- API contract tests for management read models;
- TypeScript typecheck, lint, and existing unit tests;
- no sensitive fields in the Admin Head vehicle-stage response;
- no lost original values after a correction;
- no UI-only enforcement of a business or permission rule.

## 10. Resolved product decisions

1. The ZMCC Lab Attendant issues the Local Supplier RMR after milk acceptance.
2. Local Supplier RMR uses a separate series from Shop RMR. RMR book numbering resets annually, and the year is stored as structured database data.
3. The dispatch paper is named `Raw Milk Dispatch Note`; there is no separate Dispatch Milk Token.
4. A session may contain accepted and rejected quantities when those quantities belong to identifiable, physically separable compartments or lots.
5. Gain/loss reporting separates area, route, and complete MPD MTD results. Finance's initial MTD target is loss below 1.5%; this is a performance target and not edit authority.
6. Finance posting creates the hard financial lock. Acceptance, daily close, and settlement generation apply earlier operational/freeze controls as described in section 6.5.
7. ZMCC Lab Attendant and QA Lab Attendant record tests and submit recommendations; ZMCC Manager and QA Manager respectively record the final accept/reject decisions.
8. Only Super Admin activates changes to the MTD loss target, with version, effective date, reason, and audit history.
9. Current laboratory limits are official. QA Head manages quality limits/rules; Data Executive manages test catalog/assignment metadata; Super Admin can manage both. All changes are directly effective according to their effective date and remain versioned and audited.
10. MOT GPS tracking is limited to the assigned active journey while the application is open and location permission is enabled.
11. The MOT application uses MapLibre GL JS with controlled PMTiles offline packs and becomes an installable offline-first PWA after one online preparation.
12. Phone number and CNIC are mandatory for new Shop and Local Supplier records; existing incomplete Local Suppliers require staged correction before a non-null migration.
13. The complete application is one installable role-aware PWA with scoped push and in-app notifications; only explicitly safe operations are available offline.
