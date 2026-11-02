import React from 'react';
import { User } from '@core/types';
import { isZmccFieldOfficer } from '@core/roles/hierarchy';
import {
  ClipboardList,
  FlaskConical,
  History,
  Truck,
  Clock,
  Store,
  Users,
  Send,
  MapPin,
  LayoutDashboard,
  ArrowRightLeft,
  Route as RouteIcon,
  Building2,
  Milk,
  ShieldCheck,
  ShieldAlert,
  Scale,
  Tv,
  Receipt,
  PauseCircle,
  Play,
  Database,
  CheckCircle2,
  MessageSquare,
  FileText,
  FileCheck2,
  Network,
  FileSpreadsheet,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';
import { getTeamStationsForRole } from '../delegation/stations';

export interface RoleNavLeaf {
  id: string;
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  isReference?: boolean;
  group?: string;
}

export interface RoleNavSection {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
  children?: RoleNavLeaf[];
}

const MPD_VIEW_LINKS: RoleNavLeaf[] = [
  { id: 'mpd-v-fleet', label: 'Fleet Radar', href: '/command?view=FLEET_RADAR', icon: Truck },
  { id: 'mpd-v-hierarchy', label: 'Subordinate Hierarchy', href: '/command?view=HIERARCHY', icon: Network },
  { id: 'mpd-v-journeys', label: 'MOT Journeys', href: '/command?view=MOT_JOURNEYS', icon: RouteIcon },
  { id: 'mpd-v-reports', label: 'Comprehensive Reports', href: '/command?view=REPORTS', icon: FileSpreadsheet },
  { id: 'mpd-v-sources', label: 'Sources & Silos', href: '/command?view=SOURCES', icon: Building2 },
  { id: 'mpd-v-quality', label: 'Quality Screening', href: '/command?view=QUALITY_FUNNEL', icon: FlaskConical },
  { id: 'mpd-v-loss', label: 'Supply Chain Loss', href: '/command?view=LOSS_DIAGNOSTICS', icon: ArrowRightLeft },
  { id: 'mpd-v-exceptions', label: 'Exception Desk', href: '/command?view=GOVERNANCE', icon: ShieldAlert },
  { id: 'mpd-v-policies', label: 'Testing Policies', href: '/command?view=POLICIES', icon: FileCheck2 },
];

const SOURCE_LINKS: RoleNavLeaf[] = [
  { id: 'src-milk', label: 'Milk sources', href: '/sources', icon: Milk },
  { id: 'src-contractors', label: 'Contractors', href: '/sources?view=CONTRACTORS', icon: Truck },
];

const CORRECTION_LINKS: RoleNavLeaf[] = [
  { id: 'corr-requests', label: 'Requests', href: '/super-admin/corrections?tab=requests', icon: ShieldCheck },
  { id: 'corr-direct', label: 'Direct Edit', href: '/super-admin/corrections?tab=direct_edit', icon: FileCheck2 },
  { id: 'corr-audit', label: 'Correction Audit', href: '/super-admin/corrections?tab=audit', icon: History },
];

const REPORT_GOVERNANCE_LINKS: RoleNavLeaf[] = [
  { id: 'rep-daily', label: 'Daily Quality & Ops', href: '/super-admin/reports?tab=daily', icon: FileSpreadsheet },
  { id: 'rep-hierarchy', label: 'Work for Lower Roles', href: '/super-admin/reports?tab=hierarchy', icon: UserCheck },
  { id: 'rep-warnings', label: 'Warning Limits & Policy', href: '/super-admin/reports?tab=warnings', icon: AlertTriangle },
];

/**
 * Returns the hierarchical navigation structure for a given user role.
 * Preserves strict role authorization and source scoping.
 */
function getBaseRoleNavSections(currentUser: User | null): RoleNavSection[] {
  if (!currentUser) return [];

  const role = currentUser.role || '';

  // 1. PHE Operator and MDO (same station). The MDO also does Stage 1 work:
  //    routes, dispatch to MOT and new shop requests. PHE can only watch Stage 1.
  if (isZmccFieldOfficer(role)) {
    const isMdo = role === 'MDO';
    return [
      {
        id: 'arrivals',
        label: 'Reception',
        icon: ClipboardList,
        children: [
          {
            id: 'mot-arrival',
            label: 'Mobile Tester Arrival',
            href: '/phe?section=arrivals&view=mot-arrival',
            icon: Truck,
          },
          {
            id: 'local-supplier-arrival',
            label: 'HC Intake',
            href: '/phe?section=arrivals&view=local-supplier-arrival',
            icon: Users,
          },
          {
            id: 'inside-zmcc',
            label: 'Inside ZMCC',
            href: '/phe?section=arrivals&view=inside',
            icon: Building2,
          },
          {
            id: 'weighing',
            label: 'Weighing & Tanks',
            href: '/phe?section=weighing',
            icon: Scale,
          },
          ...(!isMdo
            ? [
                {
                  id: 'exit',
                  label: 'Vehicle Exit',
                  href: '/phe?section=exit',
                  icon: Send,
                },
              ]
            : []),
          {
            id: 'history',
            label: 'Arrival History',
            href: '/phe?section=arrivals&view=history',
            icon: History,
          },
        ],
      },
      {
        id: 'suppliers',
        label: 'Suppliers & Shops',
        icon: Store,
        children: [
          {
            id: 'local-suppliers',
            label: 'HC Suppliers',
            href: '/phe?section=suppliers&view=local-suppliers',
            icon: Users,
          },
          {
            id: 'shop-details',
            label: 'Shop Directory',
            href: '/phe?section=suppliers&view=shop-details',
            icon: Store,
            isReference: true,
          },
          ...(isMdo
            ? [
                {
                  id: 'new-shop-requests',
                  label: 'New Shop Requests',
                  href: '/phe?section=suppliers&view=approvals',
                  icon: ShieldCheck,
                },
              ]
            : []),
        ],
      },
      ...(isMdo
        ? [
            {
              id: 'mot',
              label: 'Mobile Tester Operations',
              icon: Truck,
              children: [
                {
                  id: 'dispatch',
                  label: 'Dispatch to Mobile Tester',
                  href: '/phe?section=mot&view=dispatch',
                  icon: Send,
                },
                {
                  id: 'active',
                  label: 'Active & Map',
                  href: '/phe?section=mot&view=active',
                  icon: Truck,
                },
                {
                  id: 'history',
                  label: 'Journey History',
                  href: '/phe?section=mot&view=history',
                  icon: Clock,
                },
                {
                  id: 'map',
                  label: 'Journey Map & Radar',
                  href: '/phe?section=mot&view=map',
                  icon: MapPin,
                },
                {
                  id: 'sms',
                  label: 'WhatsApp Receipts',
                  href: '/phe?section=mot&view=sms',
                  icon: MessageSquare,
                },
                {
                  id: 'fleet',
                  label: 'Fleet & Vehicles',
                  href: '/phe?section=mot&view=vehicles',
                  icon: Truck,
                },
                {
                  id: 'routes',
                  label: 'Routes & Approvals',
                  href: '/phe?section=mot&view=approvals',
                  icon: RouteIcon,
                },
              ],
            },
          ]
        : []),
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 2. ZMCC Lab Attendant
  if (role === 'ZMCC_LAB_ATTENDANT') {
    return [
      {
        id: 'lab',
        label: 'Laboratory',
        icon: FlaskConical,
        children: [
          {
            id: 'queue',
            label: 'Arrivals Queue',
            href: '/zmcc/lab?tab=queue',
            icon: ClipboardList,
          },
          {
            id: 'testing',
            label: 'Testing',
            href: '/zmcc/lab?tab=testing',
            icon: FlaskConical,
          },
          {
            id: 'history',
            label: 'Test History',
            href: '/zmcc/lab?tab=history',
            icon: History,
          },
        ],
      },
      {
        id: 'dispatch',
        label: 'Dispatch',
        icon: Truck,
        children: [
          {
            id: 'new',
            label: 'Dispatch to Plant',
            href: '/zmcc/dispatch?tab=new',
            icon: Truck,
          },
          {
            id: 'recent',
            label: 'Recent Dispatches',
            href: '/zmcc/dispatch?tab=recent',
            icon: Clock,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 3. ZMCC Manager
  if (role === 'ZMCC_MANAGER') {
    return [
      {
        id: 'OVERVIEW',
        label: 'Overview',
        icon: LayoutDashboard,
        href: '/mpd/zmcc-manager?tab=OVERVIEW',
      },
      {
        id: 'APPROVALS',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/mpd/zmcc-manager?tab=APPROVALS',
      },
      {
        id: 'HIERARCHY',
        label: 'Hierarchy Tree',
        icon: Network,
        href: '/mpd/zmcc-manager?tab=HIERARCHY',
      },
      {
        id: 'MOT_JOURNEYS',
        label: 'MOT Fleet & Journeys',
        icon: RouteIcon,
        children: [
          {
            id: 'mot-dispatch',
            label: 'Assign & Dispatch',
            href: '/mpd/zmcc-manager?tab=MOT_JOURNEYS&view=DISPATCH',
            icon: Send,
          },
          {
            id: 'mot-active',
            label: 'Active Fleet Radar',
            href: '/mpd/zmcc-manager?tab=MOT_JOURNEYS&view=ACTIVE',
            icon: Truck,
          },
          {
            id: 'mot-history',
            label: 'Journey History & Audit',
            href: '/mpd/zmcc-manager?tab=MOT_JOURNEYS&view=HISTORY',
            icon: Clock,
          },
        ],
      },
      {
        id: 'PLANT_TRANSIT',
        label: 'Plant Transit',
        icon: Truck,
        children: [
          {
            id: 'pt-in-transit',
            label: 'In-Transit Tankers',
            href: '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=IN_TRANSIT',
            icon: Truck,
          },
          {
            id: 'pt-reconciliation',
            label: 'Transit Reconciliation',
            href: '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=RECONCILIATION',
            icon: ArrowRightLeft,
          },
          {
            id: 'pt-all-dispatches',
            label: 'All Dispatches History',
            href: '/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=ALL_DISPATCHES',
            icon: History,
          },
        ],
      },
      {
        id: 'REPORTS',
        label: 'Comprehensive Reports',
        icon: FileSpreadsheet,
        children: [
          {
            id: 'rep-studio',
            label: 'Dynamic Report Studio',
            href: '/mpd/zmcc-manager?tab=REPORTS&mode=STUDIO',
            icon: Sparkles,
          },
          {
            id: 'rep-routes',
            label: 'Route Collections',
            href: '/mpd/zmcc-manager?tab=REPORTS&view=ROUTE_COLLECTIONS',
            icon: RouteIcon,
          },
          {
            id: 'rep-hc',
            label: 'HC Suppliers',
            href: '/mpd/zmcc-manager?tab=REPORTS&view=HC_SUPPLIERS',
            icon: Users,
          },
          {
            id: 'rep-tanks',
            label: 'Tank Storage',
            href: '/mpd/zmcc-manager?tab=REPORTS&view=TANK_STORAGE',
            icon: Building2,
          },
          {
            id: 'rep-quality-rej',
            label: 'Quality & Rejections',
            href: '/mpd/zmcc-manager?tab=REPORTS&view=QUALITY_REJECTIONS',
            icon: FlaskConical,
          },
        ],
      },
      {
        id: 'MASTER_DATA',
        label: 'Master Data',
        icon: Store,
        children: [
          {
            id: 'md-suppliers',
            label: 'HC Suppliers',
            href: '/mpd/zmcc-manager?tab=MASTER_DATA&view=LOCAL_SUPPLIERS',
            icon: Users,
          },
          {
            id: 'md-routes',
            label: 'Routes',
            href: '/mpd/zmcc-manager?tab=MASTER_DATA&view=ROUTES',
            icon: RouteIcon,
          },
          {
            id: 'md-areas',
            label: 'Areas',
            href: '/mpd/zmcc-manager?tab=MASTER_DATA&view=AREAS',
            icon: MapPin,
          },
          {
            id: 'md-sources',
            label: 'Milk Sources',
            href: '/mpd/zmcc-manager?tab=MASTER_DATA&view=MILK_SOURCES',
            icon: Milk,
          },
          {
            id: 'md-shops',
            label: 'Shops',
            href: '/mpd/zmcc-manager?tab=MASTER_DATA&view=SHOPS',
            icon: Store,
          },
          {
            id: 'md-tanks',
            label: 'Tanks',
            href: '/mpd/zmcc-manager?tab=MASTER_DATA&view=TANKS',
            icon: Building2,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 4. Mobile Tester
  if (role === 'MOT') {
    return [
      {
        id: 'mot',
        label: 'My Active Journey',
        icon: Truck,
        href: '/mot',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 5. Admin Operator (Gate)
  if (role === 'SECURITY_OPERATOR') {
    return [
      {
        id: 'security-gate',
        label: 'Security Gate',
        icon: ShieldCheck,
        children: [
          {
            id: 'waiting-entry',
            label: 'Waiting for Entry',
            href: '/department/security?tab=WAITING_ENTRY',
            icon: Clock,
          },
          {
            id: 'inside-plant',
            label: 'Inside Plant',
            href: '/department/security?tab=INSIDE_PLANT',
            icon: Truck,
          },
          {
            id: 'ready-exit',
            label: 'Ready for Exit',
            href: '/department/security?tab=READY_EXIT',
            icon: CheckCircle2,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 6. QA Lab Attendant
  if (role === 'QA_LAB_ATTENDANT') {
    return [
      {
        id: 'qa-lab',
        label: 'QA Lab',
        icon: FlaskConical,
        children: [
          {
            id: 'waiting',
            label: 'Waiting for Testing',
            href: '/department/qa?tab=WAITING',
            icon: Clock,
          },
          {
            id: 'in-testing',
            label: 'In Testing',
            href: '/department/qa?tab=IN_TESTING',
            icon: FlaskConical,
          },
          {
            id: 'on-hold',
            label: 'On Hold',
            href: '/department/qa?tab=ON_HOLD',
            icon: PauseCircle,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 7. Weighbridge Operator
  if (role === 'WEIGHBRIDGE_OPERATOR') {
    return [
      {
        id: 'weighbridge',
        label: 'Weighbridge Station',
        icon: Scale,
        children: [
          {
            id: 'needs-scale',
            label: 'Needs Scale',
            href: '/department/weighbridge?tab=SCALE_ACTION',
            icon: Scale,
          },
          {
            id: 'at-silo',
            label: 'At Silos',
            href: '/department/weighbridge?tab=AT_SILO',
            icon: Building2,
          },
          {
            id: 'completed',
            label: 'Completed',
            href: '/department/weighbridge?tab=COMPLETED_TODAY',
            icon: CheckCircle2,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 8. Production Reception Operator
  if (role === 'PRODUCTION_RECEPTION_OPERATOR') {
    return [
      {
        id: 'production',
        label: 'Silo Offloading',
        icon: Building2,
        children: [
          {
            id: 'ready',
            label: 'Ready for Unloading',
            href: '/department/production?tab=READY',
            icon: CheckCircle2,
          },
          {
            id: 'unloading',
            label: 'Active Unloading',
            href: '/department/production?tab=UNLOADING',
            icon: Play,
          },
          {
            id: 'silo-issue',
            label: 'Silo Issues',
            href: '/department/production?tab=SILO_ISSUE',
            icon: Database,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 9. Plant Contractor Manager
  if (role === 'CONTRACTOR_MANAGER') {
    return [
      {
        id: 'contractor-mgmt',
        label: 'Contractor',
        icon: Building2,
        children: [
          {
            id: 'approvals',
            label: 'Approval Inbox',
            href: '/contractor/manager?tab=APPROVALS',
            icon: ShieldAlert,
          },
          {
            id: 'overview',
            label: 'Overview',
            href: '/contractor/manager?tab=OVERVIEW',
            icon: LayoutDashboard,
          },
          {
            id: 'live',
            label: 'Pipeline',
            href: '/contractor/manager?tab=LIVE',
            icon: Truck,
          },
          {
            id: 'quality',
            label: 'Quality & Rejections',
            href: '/contractor/manager?tab=QUALITY',
            icon: FlaskConical,
          },
          {
            id: 'receipts',
            label: 'Receipts',
            href: '/contractor/manager?tab=RECEIPTS',
            icon: Receipt,
          },
          {
            id: 'history',
            label: 'History',
            href: '/contractor/manager?tab=HISTORY',
            icon: History,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 10. Plant Contractor Operator
  if (role === 'CONTRACTOR_OPERATOR') {
    return [
      {
        id: 'contractor-dispatch',
        label: 'Dispatch',
        icon: Truck,
        href: '/contractor/dispatch',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 11. Super Admin & Data Executive
  if (role === 'SUPER_ADMIN' || role === 'DATA_EXECUTIVE') {
    return [
      {
        id: 'corrections',
        label: 'Corrections',
        icon: ShieldCheck,
        children: CORRECTION_LINKS,
      },
      {
        id: 'audit-ledger',
        label: 'Audit & Correction Ledger',
        icon: History,
        href: '/super-admin/audit',
      },
      {
        id: 'approvals-inbox',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/approvals',
      },
      {
        id: 'command-center',
        label: 'Command Center',
        icon: LayoutDashboard,
        href: '/command',
      },
      ...(role === 'SUPER_ADMIN'
        ? [
            {
              id: 'admin-center',
              label: 'Admin Center',
              icon: LayoutDashboard,
              href: '/super-admin',
            },
          ]
        : []),
      {
        id: 'reports-governance',
        label: 'Reports & Governance',
        icon: FileSpreadsheet,
        children: REPORT_GOVERNANCE_LINKS,
      },
      {
        id: 'sources-ledger',
        label: 'Sources',
        icon: Milk,
        children: SOURCE_LINKS,
      },
      ...(role === 'SUPER_ADMIN'
        ? [
            {
              id: 'zmccs',
              label: 'ZMCCs',
              icon: Store,
              href: '/super-admin/procurement-sources',
            },
            {
              id: 'zmcc-tanks',
              label: 'ZMCC Tanks',
              icon: Building2,
              href: '/super-admin/zmcc-tanks',
            },
            {
              id: 'weighing-policy',
              label: 'Weighing policy',
              icon: FileCheck2,
              href: '/super-admin/weighing-policy',
            },
          ]
        : []),
      {
        id: 'fleet',
        label: 'Fleet',
        icon: Truck,
        href: '/super-admin/fleet',
      },
      {
        id: 'stage-policies-rules',
        label: 'Lab Policies',
        icon: FlaskConical,
        href: '/super-admin/test-policies',
      },
      {
        id: 'whatsapp-gateway',
        label: 'WhatsApp Gateway',
        icon: MessageSquare,
        href: '/super-admin/whatsapp',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 11. Head of MPD
  if (role === 'HEAD_OF_MPD') {
    return [
      {
        id: 'mpd-approvals',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/approvals',
      },
      {
        id: 'mpd-sources',
        label: 'Sources',
        icon: Milk,
        children: SOURCE_LINKS,
      },
      {
        id: 'mpd-head',
        label: 'Command Center',
        icon: LayoutDashboard,
        children: MPD_VIEW_LINKS,
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 12. Security Manager (Admin Head): own function is approvals; the security gate is a covered station
  if (role === 'ADMIN_HEAD') {
    return [
      {
        id: 'admin-head-approvals',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/approvals',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 13. AVP-QA / QA Head (Stage 4 Exceptions & Lab Supervision)
  if (role === 'QA_HEAD') {
    return [
      {
        id: 'qa-head-station',
        label: 'QA Head',
        icon: ShieldAlert,
        href: '/department/qa-head',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 14. Production Head: own function is approvals; silo/weighbridge are covered stations (Team Stations)
  if (role === 'PRODUCTION_HEAD') {
    return [
      {
        id: 'production-approvals',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/approvals',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 15. Finance & Accounts
  if (role === 'FINANCE_ACCOUNTS') {
    return [
      {
        id: 'finance-approvals',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/approvals',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 16. Senior Executive Management
  if (role === 'EXECUTIVE_MANAGEMENT') {
    return [
      {
        id: 'exec-command',
        label: 'Command Center',
        icon: LayoutDashboard,
        children: MPD_VIEW_LINKS,
      },
      {
        id: 'exec-approvals',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/approvals',
      },
      {
        id: 'tv-board',
        label: 'Yard Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  return [];
}

/**
 * Returns the hierarchical navigation structure for a given user role.
 * Dynamically derives and mounts "Team Stations (Cover Staff)" for authorized superiors (§5.2, §5.4).
 */
export function getRoleNavSections(
  currentUser: User | null,
  currentSourceId?: string | null
): RoleNavSection[] {
  if (!currentUser) return [];

  const baseSections = getBaseRoleNavSections(currentUser);
  const role = currentUser.role || '';

  const teamStations = getTeamStationsForRole(role, currentSourceId);
  if (teamStations.length === 0) {
    return baseSections;
  }

  const teamSection: RoleNavSection = {
    id: 'team-stations',
    label: 'Team Stations',
    icon: Users,
    children: teamStations,
  };

  const sections = [...baseSections];
  const tvBoardIndex = sections.findIndex((s) => s.id === 'tv-board');
  if (tvBoardIndex >= 0) {
    sections.splice(tvBoardIndex, 0, teamSection);
  } else {
    sections.push(teamSection);
  }

  return sections;
}
