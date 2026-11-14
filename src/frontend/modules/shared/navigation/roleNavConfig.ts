import React from 'react';
import { User } from '@core/types';
import { isZmccFieldOfficer } from '@core/roles/hierarchy';
import {
  Factory,
  Activity,
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
  FileCheck2,
  Network,
  FileSpreadsheet,
  BarChart3,
  AlertTriangle,
  FilePenLine,
} from 'lucide-react';
import { requestableEntities } from '@/lib/recordEditor';
import { getTeamStationsForRole } from '../delegation/stations';
import { DATA_EXECUTIVE_NAV_ITEMS, SUPER_ADMIN_NAV_ITEMS, toSection } from './adminNav';
import { canSeeTestPolicies, isTestPolicyPath } from '@/lib/test-policy-access';

/** The sidebar item for raising a correction request. */
export const REQUEST_CORRECTION_NAV_ID = 'request-correction';

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
  { id: 'mpd-v-fleet', label: 'Live fleet', href: '/command?view=FLEET_RADAR', icon: Truck },
  { id: 'mpd-v-hierarchy', label: 'Routes and shops', href: '/command?view=HIERARCHY&sub=ROUTES', icon: Network },
  { id: 'mpd-v-hierarchy-hc', label: 'HC suppliers', href: '/command?view=HIERARCHY&sub=HC_SUPPLIERS', icon: Users },
  { id: 'mpd-v-journeys', label: 'Mobile Tester journeys', href: '/command?view=MOT_JOURNEYS', icon: RouteIcon },
  { id: 'mpd-v-reports', label: 'Report builder', href: '/command?view=REPORTS&report=BUILDER', icon: FileSpreadsheet },
  { id: 'mpd-v-rep-routes', label: 'Route collections', href: '/command?view=REPORTS&report=ROUTE_COLLECTIONS', icon: RouteIcon },
  { id: 'mpd-v-rep-hc', label: 'HC supplier milk', href: '/command?view=REPORTS&report=HC_SUPPLIERS', icon: Users },
  { id: 'mpd-v-rep-tanks', label: 'Tank storage', href: '/command?view=REPORTS&report=TANK_STORAGE', icon: Building2 },
  { id: 'mpd-v-sources', label: 'Sources & Silos', href: '/command?view=SOURCES', icon: Building2 },
  { id: 'mpd-v-quality', label: 'Quality Screening', href: '/command?view=QUALITY_FUNNEL', icon: FlaskConical },
  { id: 'mpd-v-loss', label: 'Supply Chain Loss', href: '/command?view=LOSS_DIAGNOSTICS', icon: ArrowRightLeft },
  { id: 'mpd-v-exceptions', label: 'Exception Desk', href: '/command?view=GOVERNANCE', icon: ShieldAlert },
  { id: 'mpd-v-policies', label: 'Testing Policies', href: '/command?view=POLICIES', icon: FileCheck2 },
];

const SEVEN_DAY_VEHICLE_LINKS: RoleNavLeaf[] = [
  { id: 'vehicles-7d-cards', label: 'Vehicle Cards', href: '/executive/live-vehicles', icon: Truck },
  { id: 'vehicles-7d-report', label: 'Report Table', href: '/executive/live-vehicles?view=REPORT', icon: FileSpreadsheet },
];

const SOURCE_LINKS: RoleNavLeaf[] = [
  { id: 'src-milk', label: 'Milk sources', href: '/sources', icon: Milk },
  { id: 'src-contractors', label: 'Contractors', href: '/sources?view=CONTRACTORS', icon: Truck },
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
            id: 'weigh-milk',
            label: 'Weigh Milk',
            href: '/phe?section=weighing&view=weigh',
            icon: Scale,
          },
          {
            id: 'done-unloaded',
            label: 'Done / Unloaded',
            href: '/phe?section=weighing&view=done',
            icon: CheckCircle2,
          },
          {
            id: 'phe-my-requests',
            label: 'My Submitted Requests',
            href: '/my-requests',
            icon: Send,
          },
          ...(!isMdo
            ? ([
                {
                  id: 'exit',
                  label: 'Vehicle Exit',
                  href: '/phe?section=exit',
                  icon: Send,
                },
              ] as RoleNavLeaf[])
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
            ? ([
                {
                  id: 'new-shop-requests',
                  label: 'New Shop Requests',
                  href: '/phe?section=suppliers&view=approvals',
                  icon: ShieldCheck,
                },
              ] as RoleNavLeaf[])
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
          ] as RoleNavSection[]
        : []),
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
          {
            id: 'hc-receipts',
            label: 'HC Receipts',
            href: '/zmcc/lab?tab=receipts',
            icon: Receipt,
          },
          {
            id: 'requests',
            label: 'My Sent Requests',
            href: '/zmcc/lab?tab=requests',
            icon: Send,
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
        children: [
          {
            id: 'hier-routes',
            label: 'Routes & Points',
            href: '/mpd/zmcc-manager?tab=HIERARCHY&view=ROUTES',
            icon: RouteIcon,
          },
          {
            id: 'hier-hc',
            label: 'Direct HC Suppliers',
            href: '/mpd/zmcc-manager?tab=HIERARCHY&view=HC_SUPPLIERS',
            icon: Users,
          },
        ],
      },
      {
        id: 'MOT_JOURNEYS',
        label: 'Mobile Tester fleet',
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
        label: 'Reports',
        icon: FileSpreadsheet,
        children: [
          {
            id: 'rep-studio',
            label: 'Report builder',
            href: '/mpd/zmcc-manager?tab=REPORTS&mode=STUDIO',
            icon: BarChart3,
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
        id: 'mot-send-request',
        label: 'Send Request',
        icon: AlertTriangle,
        href: '/mot?request=vehicle',
      },
      {
        id: 'mot-my-requests',
        label: 'My Submitted Requests',
        icon: Send,
        href: '/my-requests',
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
        id: 'sec-my-requests',
        label: 'My Submitted Requests',
        icon: Send,
        href: '/my-requests',
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
          {
            id: 'qa-my-requests',
            label: 'My Sent Requests',
            href: '/department/qa?tab=REQUESTS',
            icon: Send,
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
        id: 'wb-my-requests',
        label: 'My Submitted Requests',
        icon: Send,
        href: '/my-requests',
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
        id: 'prod-my-requests',
        label: 'My Submitted Requests',
        icon: Send,
        href: '/my-requests',
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
        id: 'contractor-my-requests',
        label: 'My Sent Requests',
        icon: Send,
        href: '/my-requests',
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
    const items = role === 'DATA_EXECUTIVE' ? DATA_EXECUTIVE_NAV_ITEMS : SUPER_ADMIN_NAV_ITEMS;
    return items.filter((item) => canSeeTestPolicies(role) || !isTestPolicyPath(item.href)).map(toSection);
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
        id: 'qa-head-my-requests',
        label: 'My Submitted Requests',
        icon: Send,
        href: '/my-requests',
      },
      {
        id: 'qa-head-live-vehicles',
        label: 'Vehicles',
        icon: Truck,
        children: SEVEN_DAY_VEHICLE_LINKS,
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
        id: 'production-head-hub',
        label: 'Production',
        icon: Factory,
        href: '/department/production-head',
        children: [
          {
            id: 'prod-overview',
            label: 'Live Stations',
            href: '/department/production-head?tab=OVERVIEW',
            icon: Activity,
          },
          {
            id: 'prod-silos',
            label: 'Plant Silos',
            href: '/department/production-head?tab=SILOS',
            icon: Database,
          },
          {
            id: 'prod-history',
            label: 'Team history',
            href: '/department/production-head?tab=HISTORY',
            icon: History,
          },
        ],
      },
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
        children: MPD_VIEW_LINKS.filter((l) => l.href !== '/command?view=POLICIES'),
      },
      {
        id: 'exec-live-vehicles',
        label: 'Vehicles',
        icon: Truck,
        children: SEVEN_DAY_VEHICLE_LINKS,
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

/** Roles that enter records get "Request correction" in the sidebar, above the Yard Board when there is one. */
function withRequestCorrection(sections: RoleNavSection[], role: string): RoleNavSection[] {
  if (sections.length === 0 || requestableEntities(role).length === 0) return sections;
  const item: RoleNavSection = { id: REQUEST_CORRECTION_NAV_ID, label: 'Request correction', icon: FilePenLine, href: '/request-correction' };
  const at = sections.findIndex((x) => x.id === 'tv-board');
  return at >= 0 ? [...sections.slice(0, at), item, ...sections.slice(at)] : [...sections, item];
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

  const role = currentUser.role || '';
  const baseSections = withRequestCorrection(getBaseRoleNavSections(currentUser), role);

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
