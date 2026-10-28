# UI audit re-check (desktop 1366x768, mobile 390x844 spot checks, demo DB)

## Verified fixed
- Sidebar blocked/covered: no page content covers sidebar (only Next dev "N" badge, dev-only; modal dim overlay is normal)
- Sidebar section buttons / Approval Inbox buttons: no <44px sidebar controls found on desktop
- "All sent" pill overlapping sidebar: gone
- "Read-only": none found on any screen
- Legacy words (Local Supplier, Contractor arrival, Substitute, Direct Supplier, n/5, Locked counters): none in page text; "Substitute" gone from MPD command
- MPD Head Sources: in-page tab pair and 4 KPI tiles gone; ERP code column gone for non-owner
- MPD command sub-views: no Unauthorized error on Testing Policies; header KPI repeat gone
- SA /super-admin/corrections: title/"Authority level 1"/long sentence removed; correction counts gone
- DE /super-admin/audit: no Unauthorized; /data-executive lands on Corrections
- SA /super-admin/users: desktop horizontal scroll gone; 25-row table ok
- SA sop-rules/test-policies tables: no clipping, controls >=44
- /super-admin/operations, /mot-operations: no blank load, headings present
- PHE/MDO /phe?section=mot views: distinct screens (dispatch/active/history/vehicles/approvals), in-page tab bar hidden >=1024px, visible at 390px
- MC journey map (MDO via View Map) renders; route trail + stats ok
- MDO /phe?section=exit: no "Forbidden" (exit link absent from MDO sidebar, direct URL renders)
- PHE exit dialog: outcome + reason + remarks, all 44px, short labels
- PHE weigh drawer: controls 44px
- ZMCC manager master data: "All statuses" chip rows gone; routes code column gone
- ZMCC manager tab bar: hidden on desktop
- Approval drawer: "(Required: )" empty value gone; Approve/Reject 44px
- Admin Head security: "Return to My Work" duplicate present but ok
- /whatsapp-gateway: now "Gateway offline" + Retry (was raw error text)
- /station-login, /workspace-unavailable: short copy plus action
- /tv-board: clean
- Mobile 390: tab bars visible (MPD command views, MC Ops, Zonal lab, QA stat chips), no page overflow except Users

## Still wrong
| Screen | Code | Exact text/element | Likely file |
|---|---|---|---|
| /super-admin/users @390 | OVERFLOW | page wider than viewport (innerWidth expands to 1192) | users/page.tsx |
| /super-admin/fleet | TEXT | 13 long list rows "#J-HAS-20261023-01 Hasilpur Rural Route 01 · 23 Oct 2026, 08:00" (9-10 words); word "MOT" | fleet/page.tsx |
| /super-admin/fleet | WORD | "MOT" in text | fleet/page.tsx |
| /super-admin/corrections?tab=direct_edit | TEXT | stage buttons "Stage 1: Field MC Shop Collections, RMR Notes, LR & Fat" (+3 more, 8-9 words) | corrections page |
| /super-admin/qa-warnings | TEXT | headings "QA Warnings & Supplier Escalation Foundation", "Derived Monthly Active Warnings per Supplier" | qa-warnings/page.tsx |
| /super-admin/whatsapp | SMALL | "Connect WhatsApp" 40px, "Reload Logs" 16px | whatsapp/page.tsx |
| /super-admin/whatsapp | TEXT/CARD | labels "Target Dairy Shop / Recipients", "Active Test Shops (8) 03176826604 (Your Number)", "Single Selected Shop Specific Dairy Unit"; tinted green card | whatsapp/page.tsx |
| /super-admin/weighing-policy | TEXT | label "Units allowed for manual entry" (5 words) | weighing-policy/page.tsx |
| /super-admin/devices | WORD | word "locked" | devices/page.tsx |
| /super-admin/mot-operations?view=DISPATCH (+ MDO /phe?section=mot&view=dispatch) | TEXT/CARD | "Location permission was denied. Please allow location in your browser settings." long sentence; amber tint card + red tint | mot-operations page / MDO dispatch view |
| /super-admin/mot-operations?view=ACTIVE_JOURNEYS,PROFILES | WORD | "MOT" word | mot-operations page |
| /super-admin/mot-operations?view=JOURNEY_MAP | EMPTY/TEXT | "Please select a journey from the Active Journeys or Journey History list" (no action button) | mot-operations map view |
| /super-admin/mot-operations?view=JOURNEY_HISTORY | TABS | filter chips "All / Collecting / Completed / Cancelled" 36px-ish chip row | mot-operations history |
| /super-admin/zmcc-master-data?view=ROUTES as DE | ERROR | "An unexpected error occurred while fetching routes." | zmcc-master-data API role guard |
| /super-admin/procurement-sources as DE | ERROR | "Unauthorized" text + filter chips "All types / ZMCC / Contractor" | procurement-sources page, API guard |
| /super-admin/test-policies, /mpd/head?tab=COMMAND&view=POLICIES | TABS | stage chips "All Tests / 1. MC Shop / 2. ZMCC MC / 3. ZMCC HC / 4. Dispatch / 5. Plant QA" + "All Status/Active/Inactive" | test-policies page |
| /mpd/head?tab=COMMAND (FLEET_RADAR + SOURCES tab) | SMALL | vehicle chips "Vehicle LES-1001" 30px (9 controls); chips "All Fleet / Plant Tankers / MC Vehicles" | MPD fleet panel |
| /mpd/head?tab=COMMAND&view=FLEET_RADAR | TEXT | headings "Inter-Facility In-Transit Tankers (ZMCC -> Plant)", "Active MC Field Routes (Village Shops -> ZMCC)" | MPD fleet panel |
| /mpd/head?tab=COMMAND&view=SOURCES | TEXT | "Left unloaded (30d): 4 · 2 pending · 9,683.18 L not received"; labels "LR / Fat / SNF / TS", "Plant QA (Fat / LR)" | MPD sources view |
| /mpd/head?tab=COMMAND&view=GOVERNANCE | TEXT | quoted remarks (13-15 words) not behind (i) | MPD governance view |
| /mpd/head?tab=COMMAND&view=LOSS_DIAGNOSTICS | TEXT | headings "ZMCC Chilling & Storage Loss", "Total Cumulative Supply Chain Loss" | MPD loss view |
| /mpd/head?tab=APPROVALS (all approver roles) | WORD | "Session #86 · Portion 1 (MOT)" (MOT where MC meant) | ApprovalQueueList / approvalInboxShared |
| /mpd/head?tab=APPROVALS | TEXT | "Route: Proposed Chiniot Bypass Route 1762 (Jhang Bypass -> Chiniot Chowk)"; "Why it was rejected: ..." 15+ words | ApprovalDetailBody |
| /mpd/head?tab=APPROVALS | TABS | segmented "Pending (5) | History" + stage chips "All Stages / Area / ZMCC / Dispatch" | ApprovalInbox |
| Approval drawer | TEXT | quoted remark "LR 25.7 is slightly below 26.00..." 18 words | ApprovalDecisionDrawer |
| /department/qa-head | TABS | segmented "Pending (1) | History"; "163h 3m" wait | qa-head page |
| /department/security?tab=WAITING_ENTRY, READY_EXIT | EMPTY | "No vehicles / Select a vehicle" no action | security page |
| /department/security, production, weighbridge as Admin/Production Head | TEXT | "<- Return to Admin Head/Production Head" (4 words) plus duplicate "Return to My Work" | department layouts |
| /department/production (all tabs) | TEXT/WORD | heading "Production · Ready for Unloading", "Production · Silos & Stock Issue" vs page title "Silo Unloading" | production page |
| /department/weighbridge | TEXT | "Weighbridge · First Weight (Gross)", "Weighbridge · Second Weight (Tare)" | weighbridge page |
| /department/weighbridge?tab=SECOND_WEIGHT, production READY/UNLOADING | EMPTY | "No vehicles" / "No vehicles are currently unloading." no action | weighbridge/production pages |
| /department/qa?tab=WAITING | EMPTY | "No vehicles waiting for QA testing." shown twice | qa page |
| /department/qa?tab=WAITING,IN_TESTING,ON_HOLD | TEXT | heading "QA Laboratory · In Testing Sessions"/"Waiting Queue"/"On Hold Queue" | qa page |
| /department/qa?tab=IN_TESTING | TEXT/CARD | "PHYSICAL RECEIVED SEAL (CHEMIST CHECK) *", "PORTION QUALITY METRICS (LIVE PREVIEW)", "PLANT LAB OBSERVATIONS (29 ACTIVE TESTS)", "Mandatory Test Accountability: 20/20 Performed · 0 Marked Omitted · 0 ..."; 4 tinted card colours | qa IN_TESTING component |
| /department/qa (all) @desktop | TABS | stat chips "Waiting 0 | In Testing 1 | On Hold 0" duplicate sidebar queue links | qa page |
| /mpd/zmcc-manager?tab=OVERVIEW | TEXT | 9-14 long lines: "Vehicle problem — Unloading pump failed and the tank outlet is blocked...", "Reason: Tank full — Tank was full after the first portion...", "Partly received · accepted not received 1,300 kg / 1,264.1 L" | PlantManagerOverview |
| /mpd/zmcc-manager?tab=OVERVIEW | WORD | "locked", "MOT"; heading "Recent Dispatches (0 Total Logs)" | PlantManagerOverview |
| /mpd/zmcc-manager?tab=LIVE | TABS | stage chips "All Active (1) | Gate In | Plant QA | Weighbridge Scale | Silo Unloading | Awaiting Receipt"; heading "Vehicle reception pipeline (ZMCC Hasilpur)" | ZM live view |
| /mpd/zmcc-manager?tab=RECONCILIATION | SMALL/TABS | "All on Page" 28px, "Completed Receipts/Receipt Pending/Quantity Differences" 30px, chips Daily/Weekly/Monthly | ZM reconciliation |
| /mpd/zmcc-manager?tab=HISTORY&view=PLANT_HISTORY | EMPTY/TEXT | "Showing 0 of 0 historical transactions Filtered by Business Date..." no action; headings "History & Reports · Plant History", "Historical Dispatch & Milestone Archive: ZMCC Hasilpur" | ZM plant history |
| /mpd/zmcc-manager?tab=HISTORY&view=QUALITY_REJECTIONS | TEXT/WORD/TABS | headings "History & Reports · Quality & Rejections Review", "Quality Analysis & Rejections Governance: ZMCC Hasilpur"; 6 filter chips; rows "BWP-7202 HC Token: TK-HAS-HC-005 Supplier: DEMO - ..." long; "MOT" | ZM quality history |
| /mpd/zmcc-manager?tab=MASTER_DATA (all views) | TEXT | heading "Master Data · HC Suppliers/Routes/Areas/Milk Sources/Shops/Tanks" (4 words) | ZM master data |
| /phe?section=weighing (PHE+MDO) | TEXT | cards "DEMO - Waseem Khan Milk Traders - Token DEMO-SCN-TK-HAS-HC-S7A - 1 accepted portion" (13-14 words x4); "Done in the last 24 hours" | PHE weighing list |
| /phe?section=weighing | WORD | "TK-HAS-MOT-003" token display (MOT) | PHE weighing list |
| PHE weigh drawer | TEXT | "Weigh the vehicle 2 times: first before unloading, then after each portion. Each weight must be less than the one before." (22 words, not in InfoTip) | PHE weigh drawer |
| PHE weigh drawer | DATA | "Portion 1 net: -" placeholder; disabled "Unload to ZMCC tank" / "Save values only" with no reason | PHE weigh drawer |
| /phe?section=exit | TEXT | "Waiting for the ZMCC Manager to approve closing without unloading." (10 words) x2; "Not unloaded - Accepted but not received" | PHE exit list |
| /phe?section=arrivals&view=local-supplier-arrival | EMPTY | page = "HC arrival / Add supplier / Record HC Arrival" only, no list or guidance | PHE HC intake view |
| /phe?section=arrivals&view=history | WORD/TABS | token "TK-HAS-MOT-001"; chips "All / MC only / HC only"; headings differ "PHE Station" vs "PHE Shop Station" | PHE history |
| PHE all /phe views | TEXT | page heading "PHE Station" vs "PHE Shop Station" (suppliers views) inconsistent; sidebar chip "MDO (Milk Development Officer)" 4 words | phe page |
| /zmcc/lab?tab=history | WORD | "MOT" in rows | zmcc lab history |
| /zmcc/lab testing session | DATA | "ZMCC Intake Token —", "Token: — · Vehicle: —" dashes (HC session #96/#104) | ZMCC testing session |
| /zmcc/lab testing session | SMALL | "View details" 40px, "Enter Tests & Decide" 40px (4 words), "Close" 40px | ZMCC testing session |
| ZMCC portion decision dialog | SMALL/DATA | "Take photo" 38px, close 40px, "Vehicle: — · Token: —" | ZMCC decision dialog |
| /zmcc/lab?tab=testing | EMPTY | "No arrivals waiting" (264 chars, no action) | zmcc lab page |
| /zmcc/dispatch?tab=recent | SMALL/TABS | "Today / Last 7 Days / Last 30 Days / Custom" 36px; "Raw Milk Dispatch Note No." label (5 words) | zmcc dispatch |
| /zmcc/dispatch?tab=new, /contractor/dispatch | CARD/TEXT | label "Raw Milk Dispatch Note No."; tinted bg rgb(250,251,252) cards | dispatch form |
| /mot (MOT role) | WORD | "MOT Operator", "MOBILE TESTER (MOT)", "@mot.driver" | mot/page.tsx |
| /contractor/manager?tab=OVERVIEW | SMALL | "Previous" 36px | contractor manager |
| /contractor/manager?tab=LIVE,QUALITY,RECEIPTS | SMALL/TABS | chips 38px: "All Active (1) | Security (0) | QA (0) | Scale (1) | Unloading (0) | Receipt Pending (0)", "All (1 portions) | Accepted | Rejected | Hold | Pending", "All | Final Receipt | Receipt Pending | Before Receipt" | contractor manager |
| /contractor/manager (QUALITY/RECEIPTS/HISTORY) | TEXT | subtitle "Milk Procurement: Quality & rejections / Receipts & Reconciliation / History & Operational Reports" | contractor manager |
| /contractor/manager @390 | SMALL | tab buttons "Approval Inbox", "Operations" 32px | contractor manager nav |
| /login | WORD/TEXT | lists every seed account incl. "mot.driver", "Plant Contractor Manager (Al Khair)", long names ("ZMCC Lab Attendant (Kabirwala) zmcc.operator.kabirwala") | LoginPage.tsx |
| /device-setup | CARD | red-tinted element rgb(213,21,28) + lab tint card | device-setup page |
| all roles (dev only) | CARD | Next.js dev "N" badge covers sidebar bottom-left user chip | dev overlay (ignore in prod) |
