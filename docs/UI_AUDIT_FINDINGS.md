# UI audit findings (desktop 1366x768, demo DB, ~108 page loads + 4 dialogs)

Codes: TEXT READONLY TABS CARD WORD ERROR EMPTY OVERFLOW SMALL DATA

## ALL ROLES (global)
| Screen | Code | Element / text | File |
|---|---|---|---|
| every page with sidebar | SMALL | Sidebar section buttons 36px high (Reception, Suppliers & Shops, Laboratory, Dispatch, Command Center, Team Stations, History, Master Data, Corrections, MC Operations, Security Gate, QA Lab, Weighbridge, Silo Offloading, Contractor, Approval Inbox 32px) | shared sidebar / roleNavConfig |
| every page | CARD | Floating green "All sent" pill overlaps sidebar bottom-left | sync indicator component |
| /mpd/head?tab=SOURCES as SA | CARD | Dark navy "Covering: Head of MPD · Plant Central / Return to My Work" banner | |

## SUPER_ADMIN (admin.superuser)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /super-admin/users | OVERFLOW | page scrolls horizontally (hscroll) | users/page.tsx |
| /super-admin/users | SMALL/TEXT | table exactly 25 rows, no pager seen; words "Corrections", "MOT" in role labels | |
| /super-admin/corrections (+?tab=requests/direct_edit/audit) | TEXT | "Sole cryptographic amendment authority for Super Administrator. All changes permanently logged to immutable audit ledger." | corrections page |
| /super-admin/corrections | WORD | Title "Correction & Record Amendment Suite", "AUTHORITY LEVEL 1", "PENDING FIELD REQUESTS", "APPLIED CORRECTIONS", "HIGH IMPACT TICKETS" (correction counts), "Refresh Workspace" | |
| /super-admin/corrections?tab=audit | TEXT | "Click “Open Full Audit Explorer” above to inspect the complete multi-entity timeline with deep JSON diff inspe..." (21 words) | |
| /super-admin/corrections?tab=requests | TEXT/EMPTY | "There are no pending correction tickets waiting for your review." | |
| /super-admin/procurement-sources | WORD | "ERP" shown (ok for owner); heading/section words "Corrections" in nav | |
| /super-admin/weighing-policy | TEXT | "When on, MDO and PHE Operator can type each portion's net quantity instead of using the scale weights." + "Litres are converted to kg with the portion density." | weighing-policy/page.tsx |
| /super-admin/test-policies (?tab=catalog) | TEXT | "One unified master catalog to manage tests, stage assignments, compulsory enforcement, photo evidence, and SOP..." | test-policies page |
| /super-admin/test-policies?tab=catalog | OVERFLOW/SMALL | Table clipped inside card (Edit Test button cut at right edge); 25 rows, 121 controls <43px | |
| /super-admin/test-policies | CARD | red/pink tinted stage + "Compulsory" blue badges everywhere (many tinted pills) | |
| /super-admin/devices | TEXT | "Register field phones, give them to users, and see what each phone did." ; word "locked" | devices page |
| /super-admin/whatsapp | TEXT | "Run \"npm run whatsapp:gateway\" to start the background WhatsApp daemon." ; "All 14 active Hasilpur demonstration shops are set to your number:" | whatsapp/page.tsx |
| /super-admin/fleet | WORD/DATA | "MOT" word; rows "Hasilpur Rural Route 01 · 22 Oct 2026, 09:30" (long 9-10 word list rows) | fleet page |
| /super-admin/mot-operations | TEXT | "Physical Assign & Departure", "IMMEDIATE DEPARTURE", "Assign & Dispatch (Begin Journey)", "Assigning User GPS Coordinates", "Location permission was denied. Please allow location in your browser settings." (amber tinted warning) | mot-operations page |
| /super-admin/mot-operations | WORD | "Mobile Tester *" label; no heading in page body until ~10s load (blank for ~8s) | |
| /super-admin/operations | EMPTY | blank (17 chars) for >5s before content renders; no skeleton | operations/page.tsx |
| /super-admin/sop-rules, /super-admin/settings, /super-admin/notification-devices | TEXT | heading "Administration" (generic); 10 controls <43px on sop-rules | |
| /super-admin/lab-tests, /super-admin/master-data, /super-admin/test-point-policies | DATA | silently redirect to other pages (test-policies?tab=catalog, /super-admin) | |
| /whatsapp-gateway | ERROR | "Could not connect to WhatsApp gateway daemon on port 3001." (no next action, no layout) | whatsapp-gateway/page.tsx |
| /notifications/settings | WORD | "Corrections", "Correction" in nav | |

## DATA_EXECUTIVE (data.executive)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /super-admin/audit (nav "Audit & Correction Ledger") | ERROR | "Unauthorized. Super Admin authorization required." | audit/page.tsx + API guard |
| /super-admin/corrections | TEXT | "Sole cryptographic amendment authority for Data Executive . All changes permanently logged..." (stray space before period) | |
| /super-admin/corrections | WORD | nav label "Corrections / Requests / Direct Edit / Correction Audit"; "There are no pending correction tickets waiting for your review." | |
| /data-executive | DATA | redirects to /super-admin/corrections (route has no own screen) | |
| /tv-board | OK | no issue beyond SMALL | |

## EXECUTIVE_MANAGEMENT (executive.management)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /mpd/head?tab=COMMAND | WORD | "No emergency substitute vehicles registered in the last 30 days." | MPD command |
| /mpd/head?tab=APPROVALS | WORD/TEXT | "MOT" in rows; route rows 10-11 words "Route: Proposed Chiniot Bypass Route 1762 (Jhang Bypass → Chiniot Chowk)" | |
| /mpd/head?tab=SOURCES | DATA | shows Approvals inbox instead of Sources (role has no Sources, no redirect/message) | |
| /tv-board | OK | | |

## HEAD_OF_MPD (mpd.head)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /mpd/head?tab=SOURCES | WORD | "ERP Code" column + codes (DEMO-SCN-MS-01) shown to role below owner | MilkSources table |
| /mpd/head?tab=SOURCES | TABS | in-page tab pair "Milk Sources (17) | Contractors (3)" | |
| /mpd/head?tab=SOURCES | TEXT | KPI tiles "MILK SOURCES / ACTIVE SOURCES / ZMCCS / CONTRACTORS" (4 tiles for 17/17/3/3) | |
| /mpd/head?tab=COMMAND (all views) | WORD | "No emergency substitute vehicles registered in the last 30 days." (substitute) | |
| /mpd/head?tab=COMMAND&view=POLICIES | ERROR | red "Unauthorized. Super Admin or Data Executive authorization required." above Lab Policies (nav "Testing Policies" leads here) | |
| ?view=LOSS_DIAGNOSTICS | TEXT | "Shop collection volume vs MC arrival volume received at the ZMCC." / "Inward receipts vs dispatches, adjusted for the change in tank stock." / "Dispatched tanker volume vs volume accepted at Plant Reception." / "Compound variance across all 3 custody transfer points across division." | |
| ?view=QUALITY_FUNNEL | TEXT | "Not tracked yet: MC shop collections do not record rejected milk." | |
| ?view=SOURCES | TEXT/TABS | "4 · 2 close request(s) pending · 9,683.18 L accepted, not received"; chip "All Nodes (6)" 28px | |
| ?view=GOVERNANCE | TEXT/TABS | quoted remarks 15 words; chip "All Overrides (2)" 28px | |
| ?view=FLEET_RADAR | DATA | header "Executive command center" repeats KPIs on every sub-view (same KPI row on 6 views) | |
| /mpd/head?tab=APPROVALS | TABS | segmented "Pending (5) | Audit History" + stage chips "All Stages (5) | S1 Area (3) | S2 ZMCC Reception (2) | S3 Dispatch (0)"; red-tinted breach badges | ApprovalInbox |
| /mpd/head?tab=APPROVALS | WORD | "MOT" ; stage codes "S1/S2/S3" | |
| /tv-board | OK | | |

## ADMIN_HEAD (admin.head)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /department/security | EMPTY | "No vehicles" + "Select a vehicle" on empty queue; no next action | security page |

## QA_HEAD (qa.head)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /department/qa-head | TEXT | "Stage 4 · Plant QA", "1 Pending", "1 Breached", "Pending (1)", "Audit History", row "162h 13m", "Plant Reception: Vehicle LHR-1003 (Portion 1)", "Quality Exception" | |
| /department/qa-head | DATA | wait time "162h 13m" (demo data) | |

## PRODUCTION_HEAD (production.head)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /department/production | TEXT | "Assign unloading bays and record silo receipts for vehicles arriving from weighbridge." | |
| /department/weighbridge | TEXT | "Record first (loaded vehicle) gross weight on Scale 1 and lock operational business date." | |
| /mpd/head?tab=APPROVALS | TABS/WORD | same inbox as MPD; "MOT" | |

## FINANCE_ACCOUNTS (finance.accounts)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /mpd/head?tab=APPROVALS | TABS/WORD | same inbox, "MOT", route rows 10-11 words | |

## ZMCC_MANAGER (zmcc.manager.hasilpur)
| Screen | Code | Element / text | File |
|---|---|---|---|
| ?tab=APPROVALS | TABS | "Pending (4) | Audit History" + stage chips "All Stages | S1 Area | S2 ZMCC Reception | S3 Dispatch" | |
| ?tab=APPROVALS | CARD | red "Review & Decide" buttons on tinted cards, red/green/blue tag pills (S1 Area, S2 ZMCC, "New Route", "Audit only") | |
| ?tab=APPROVALS | DATA | "Submitted by: Retired Bootstrap Admin (Super Admin)" | |
| Approval drawer (Review & Decide) | DATA | "(Required: )" empty value in EXCEPTION SUMMARY | ApprovalDecisionDrawer |
| Approval drawer | TEXT | quote "“LR 25.7 is slightly below 26.00. Milk is fresh and cold (6 C). Requesting manager approval.”" | |
| ?tab=OVERVIEW | TEXT | "Vehicle problem — Unloading pump failed and the tank outlet is blocked. Vehicle is waiting for the manager decision" (19w); "Vehicle problem — Vehicle broke down at the unloading bay. Milk will be taken back to the shop." (18w); "Reason: Tank full — Tank was full after the first portion. The driver took the second portion back." (18w); "Reason: Sent back — Tank was under cleaning. Manager approved sending the milk back to the shop chiller." (18w); 9 long lines total | PlantManagerOverview |
| ?tab=OVERVIEW | WORD | "locked", "MOT"; period chips "Today / Yesterday / Last 7 Days / Last 15 Days / All time" | |
| ?tab=OVERVIEW | DATA | "Accepted intake today —" dash value | |
| ?tab=LIVE | TABS | stage chips "All Active (1) | Gate In | Plant QA | Weighbridge Scale | Silo Unloading | Awaiting Receipt" | |
| ?tab=LIVE | TEXT | "Vehicle reception pipeline (ZMCC Hasilpur)"; "162h 27m" waiting | |
| ?tab=RECONCILIATION | SMALL | 9 controls <43px (Daily / Weekly / Monthly / Refresh / Export Excel) | |
| ?tab=RECONCILIATION | TEXT | "Supply Chain Loss Hierarchy", "Tier 1: MC Route Loss", "Loss @13% TS", "Export Excel" | |
| ?tab=HISTORY&view=PLANT_HISTORY | EMPTY | "Showing 0 of 0 historical transactions / Filtered by Business Date: 2026-10-23 to 2026-10-23" (no data, no next action); stage chips "All stages | In transit | In plant | Completed | Reject..." | |
| ?tab=HISTORY&view=QUALITY_REJECTIONS | WORD/TABS | "MOT"; KPIs "TOTAL LAB SESSIONS / ACCEPTED MILK / REJECTED MILK / PENDING MANAGER REVIEW / REVIEWED EXITED"; chips "All ZMCC Sessions | Needs Manager Review | Rejected" | |
| ?tab=MASTER_DATA&view=LOCAL_SUPPLIERS | TABS/OVERFLOW | filter chips "All statuses | Active | Inactive"; 24-row table; CNIC + phone shown plain | |
| ?tab=MASTER_DATA&view=ROUTES/AREAS/MILK_SOURCES/SHOPS/TANKS | TABS | same "All statuses | Active | Inactive" chip row + "ZMCC Hasilpur (ZMCC-HASILPUR)" selector; headings "Master Data · HC Suppliers" etc. | |
| ?tab=MASTER_DATA&view=ROUTES | DATA | codes "DEMO-SCN-RT-HAS-01" shown in table | |

## PHE_OPERATOR (phe.operator)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /phe?section=arrivals&view=mot-arrival | WORD | "MC journeys (2)", "@13TS: 0 L", "Assigned: 3 · Collected: 0 · Skipped: 0"; row "DEMO-SCN-RT-HAS-01 · Hasilpur Chak Road Route (Scenarios)" | |
| /phe?section=mot&view=dispatch, active, vehicles, approvals | DATA | all four render the identical "MC journeys (2)" list (views not implemented) | phe page |
| /phe?section=suppliers&view=approvals | EMPTY | only header "PHE Shop Station / ZMCC Hasilpur" - blank body | |
| /phe?section=arrivals&view=local-supplier-arrival | EMPTY | "HC arrival / Add supplier / Record HC Arrival" minimal; no list | |
| /phe?section=weighing | TEXT | "DEMO - Waseem Khan Milk Traders - Token DEMO-SCN-TK-HAS-HC-S7A - 1 accepted portion" (13-14w lines x4), "Portion 1: 1100 kg | Portion 2: 1100 kg" | |
| Weigh drawer | TEXT | "Weigh the vehicle 2 times: first before unloading, then after each portion. Each weight must be less than the one before." (22w) | |
| Weigh drawer | DATA | "Portion Total: -" / "Portion 1 net: -" placeholders; "Unload to ZMCC tank" disabled red with no reason shown | |
| /phe?section=exit | TEXT | "Waiting for the ZMCC Manager to approve closing without unloading." ; "Not unloaded - Accepted but not received" | |
| Exit dialog | OK | outcome + reason + remarks, all 44px | |
| /phe?section=arrivals&view=history | WORD | filter chips "All | MC only | HC only | My correction requests"; token column "TK-HAS-MOT-001" | |
| /phe?section=suppliers&view=local-suppliers | WORD/OVERFLOW | 23 rows, filter chips "All statuses | Active | Inactive" | |
| /phe?section=suppliers&view=shop-details | TABS | same chips + route/area selectors | |
| header (all /phe) | WORD | page heading "PHE Station" / "PHE Shop Station" inconsistent across views | |

## MDO (mdo)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /phe?section=exit | ERROR | red "Forbidden." with "No vehicles waiting." (MDO cannot use exit; direct URL shows error) | |
| /phe?section=weighing | TEXT | same 13-14w lines; "MOT" token | |
| /phe?section=mot&view=dispatch | TEXT | "Physical Assign & Departure", "IMMEDIATE DEPARTURE", "Send new route to Zonal Manager", "Assigning User GPS Coordinates", "Location permission was denied. Please allow location in your browser settings." | |
| /phe?section=suppliers&view=local-suppliers | WORD | heading "MDO Shop Station" | |
| sidebar | SMALL | extra nav button "MC Operations" 36px | |

## ZMCC_LAB_ATTENDANT (zmcc.operator)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /zmcc/lab?tab=queue | WORD | "Mobile Tester: Muhammad Tariq (MOT-HAS-001)"; "Session Started", "Resume Testing" x3; "RMR Number: 957329969"; "Supplier Code: ZLS-000081" | |
| /zmcc/lab?tab=testing | EMPTY | "Testing desk / No arrivals waiting" (no action) | |
| Testing session (Resume Testing) | DATA | "ZMCC Intake Token —", "Token: — · Vehicle: —" dashes; "Loading vehicle testing session…" ~8s | |
| Testing session | TEXT | "1 single sample for vehicle", "Separate portions (1)", "Awaiting manager." | |
| /zmcc/lab?tab=history | WORD/TABS | chips "All decisions | Accepted | Rejected | My correction requests"; 18-row table | |
| /zmcc/dispatch?tab=new | TEXT | "MPD / Field Milk Dispatch", "Draft Restored", "Clear Draft", "DISPATCH SUMMARY", "AUTO-SUM", "KG (Measured)", "Standard Net Weight", "WEIGHTED LR @20°C", "WEIGHTED FAT GERBER", "GROSS LITERS" | |
| /zmcc/dispatch?tab=recent | TABS/EMPTY | period chips "Today | Last 7 Days | Last 30 Days | Custom" (36px); "No dispatches found for this period." | |

## MOT (mot.driver)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /mot | WORD | "MOT Operator", "MOBILE TESTER (MOT)", "@mot.driver" (MOT where MC meant) | mot/page.tsx |
| /mot | EMPTY | "No active journey" (no next action) | |

## CONTRACTOR_MANAGER (contractor.manager.alkhair)
| Screen | Code | Element / text | File |
|---|---|---|---|
| all tabs | WORD/TEXT | header "Approval Inbox | Contractor Operations | Direct-to-plant supplier · Milk Procurement" (32px button) | |
| ?tab=APPROVALS | TEXT | "Approval Queue is Clear / No pending approval requests require your review right now." ; "Stage 3 · Dispatch" | |
| ?tab=OVERVIEW | TEXT | badge "Server Source Scoped"; "Milk Procurement: Pipeline Overview"; "Business date: 2026-10-22" | |
| ?tab=LIVE | TABS | "All Active (1) | Security (0) | QA (0) | Scale (1) | Unloading (0) | Receipt Pending (0)" ; 11 controls <43px | |
| ?tab=QUALITY | TEXT | badge "Portion-Wise Authority"; "Passed Plant QA criteria"; 10 controls <43px | |
| ?tab=RECEIPTS | TEXT | badge "Silo Transaction Authority"; "Final Receipts"; "Posted Silo transactions" | |
| ?tab=HISTORY | TEXT | "Historical ledger evaluated by Reporting Date (Final Receipt date for completed receipts; Dispatch date for pe..." (16w) | |

## CONTRACTOR_OPERATOR (contractor.operator.alkhair)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /contractor/dispatch | TEXT | same dispatch form as ZMCC ("MPD / Field Milk Dispatch", "Draft Restored", "Clear Draft", "AUTO-SUM") | |

## SECURITY_OPERATOR (security.gate)
| Screen | Code | Element / text | File |
|---|---|---|---|
| ?tab=WAITING_ENTRY / READY_EXIT | EMPTY | "0 vehicles / No vehicles / Select a vehicle" | |
| ?tab=INSIDE_PLANT | TEXT | columns "TOKEN # VEHICLE # ENTRY TIME PORTIONS CURRENT STAGE"; "1 (8,050 KG)" | |

## QA_LAB_ATTENDANT (qa.chemist)
| Screen | Code | Element / text | File |
|---|---|---|---|
| /department/qa (all tabs) | TABS | stat chips "Waiting 0 | In Testing 1 | On Hold 0" duplicate the sidebar queue links on desktop | QA workspace |
| ?tab=WAITING | TEXT | "Vehicles awaiting sampling and testing at plant reception." ; duplicate empty "No vehicles waiting for QA testing." x2 | |
| ?tab=IN_TESTING | TEXT | "Active testing sessions, seal verification, and portion analysis." ; "PORTION QUALITY METRICS (LIVE PREVIEW)" ; "PLANT LAB OBSERVATIONS (29 ACTIVE TESTS)" ; "Record observations and verification photos for Portion #1." ; "20 / 20 Performed · 0 Marked Omitted · 0 Unresolved" | |
| ?tab=IN_TESTING | WORD | "PORTION-WISE MODE", "Visit #VV-20261016-0003 · Rec #MRN-261016-0003", test codes "LT-000001..LT-000029", "SOP ≥ 28.0", "Take LR Photo*", "Live camera capture required", "Estimated Density", "SNF/Fat Ratio", "Elapsed: 9750m" | |
| ?tab=IN_TESTING | OVERFLOW | 29 tests inline in one ~4.7k-char scroll; no collapse | |
| ?tab=ON_HOLD | TEXT | "Portions on hold pending supervisor or QA decision." ; "Select a vehicle" | |

## WEIGHBRIDGE_OPERATOR (weighbridge.operator)
| Screen | Code | Element / text | File |
|---|---|---|---|
| ?tab=FIRST_WEIGHT | TEXT | "Record first (loaded vehicle) gross weight on Scale 1 and lock operational business date." ; "1 Accepted Portion", "Accepted Qty: 8,400 KG", "Waiting: 12..." | |
| ?tab=SECOND_WEIGHT | TEXT/EMPTY | "Record second (empty / tare) weight on Scale 2 after silo unloading." ; "No vehicles" | |

## PRODUCTION_RECEPTION_OPERATOR (production.operator)
| Screen | Code | Element / text | File |
|---|---|---|---|
| ?tab=READY | TEXT/EMPTY | "Assign unloading bays and record silo receipts for vehicles arriving from weighbridge." ; "No vehicles" | |
| ?tab=UNLOADING | TEXT | "Monitor in-progress tanker offloading and confirm completion before tare weighing." ; "No vehicles are currently unloading." | |
| ?tab=SILO_ISSUE | TEXT | "Inspect active plant silos, view stock levels, and log issues." ; heading "Silos & Stock Issue" | |
| heading | WORD | page title "Silo Unloading" vs tab "Production · Ready for Unloading" mismatch | |

## PUBLIC
| Screen | Code | Element / text | File |
|---|---|---|---|
| /login | WORD | lists every seed account with usernames incl. "Mobile Tester (MOT), Hasilpur / mot.driver" and role headings "DIRECTORATE & GOVERNANCE", "MANAGERS & HEADS" | LoginPage.tsx |
| /station-login | EMPTY | "Who are you?" / "This computer is not set up as a station. Ask the office." | |
| /device-setup | TEXT | "For office staff. Set up this phone so it can send work by itself." ; "Add this ID on the Phones screen in the office." ; "This phone cannot scan QR codes here. Type the key." ; "Step 1. This phone ID" | device-setup/page.tsx |
| /workspace-unavailable | TEXT | "Your role doesn't have an active workspace in this environment. Sign in with an authorized account or contact ..." (20w) | |

## Not found (checked, clean)
READONLY: no "Read-only" text found on any visited screen. NaN/undefined/null/[object: none. "Local Supplier"/"Contractor arrival"/"Direct Supplier"/n/5: none in page text (nav ids still use local-supplier-arrival in URL only). Horizontal page overflow: only /super-admin/users. Tables >25 rows: none (users and test-policies exactly 25, no pager seen).
