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
        label: 'Milk Reception & Intake',
        icon: ClipboardList,
        children: [
          {
            id: 'mot-arrival',
            label: 'MC Tanker Arrival',
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
            id: 'weighing',
            label: 'Weighing & Tanks',
            href: '/phe?section=weighing',
            icon: Scale,
          },
          {
            id: 'exit',
            label: 'Vehicle Exit',
            href: '/phe?section=exit',
            icon: Send,
          },
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
              label: 'MC Operations',
              icon: Truck,
              children: [
                {
                  id: 'dispatch',
                  label: 'Dispatch to MC',
                  href: '/phe?section=mot&view=dispatch',
                  icon: Send,
                },
                {
                  id: 'active',
                  label: 'Active Journeys & Map',
                  href: '/phe?section=mot&view=active',
                  icon: Truck,
                },
                {
                  id: 'history',
                  label: 'Journey History & Receipts',
                  href: '/phe?section=mot&view=history',
                  icon: Clock,
                },
                {
                  id: 'fleet',
                  label: 'Fleet',
                  href: '/phe?section=mot&view=vehicles',
                  icon: Truck,
                },
                {
                  id: 'routes',
                  label: 'Routes & Planning',
                  href: '/phe?section=mot&view=approvals',
                  icon: RouteIcon,
                },
              ],
            },
          ]
        : []),
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'Yard Status Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 3. ZMCC Manager
  if (role === 'ZMCC_MANAGER') {
    return [
      {
        id: 'APPROVALS',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/mpd/zmcc-manager?tab=APPROVALS',
      },
      {
        id: 'OVERVIEW',
        label: 'Overview',
        icon: LayoutDashboard,
        href: '/mpd/zmcc-manager?tab=OVERVIEW',
      },
      {
        id: 'LIVE',
        label: 'Operations',
        icon: Truck,
        href: '/mpd/zmcc-manager?tab=LIVE',
      },
      {
        id: 'RECONCILIATION',
        label: 'Reconciliation',
        icon: ArrowRightLeft,
        href: '/mpd/zmcc-manager?tab=RECONCILIATION',
      },
      {
        id: 'HISTORY',
        label: 'History & Reports',
        icon: History,
        children: [
          {
            id: 'plant',
            label: 'Plant History',
            href: '/mpd/zmcc-manager?tab=HISTORY&view=PLANT_HISTORY',
            icon: History,
          },
          {
            id: 'quality_rej',
            label: 'Quality & Rejections Review',
            href: '/mpd/zmcc-manager?tab=HISTORY&view=QUALITY_REJECTIONS',
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
        label: 'Yard Status Board',
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
        label: 'Yard Status Board',
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
        label: 'Gate Entry & Exit',
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
        label: 'Yard Status Board',
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
        label: 'QA Testing Laboratory',
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
        label: 'Yard Status Board',
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
            id: 'first-weight',
            label: 'First Weight (Gross)',
            href: '/department/weighbridge?tab=FIRST_WEIGHT',
            icon: Scale,
          },
          {
            id: 'second-weight',
            label: 'Second Weight (Tare)',
            href: '/department/weighbridge?tab=SECOND_WEIGHT',
            icon: CheckCircle2,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'Silo Offloading Station',
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
            label: 'Silo Issues / History',
            href: '/department/production?tab=SILO_ISSUE',
            icon: Database,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'Plant Contractor Station',
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
            label: 'Receipts & Reconciliation',
            href: '/contractor/manager?tab=RECEIPTS',
            icon: Receipt,
          },
          {
            id: 'history',
            label: 'History & Reports',
            href: '/contractor/manager?tab=HISTORY',
            icon: History,
          },
        ],
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'Contractor Dispatch',
        icon: Truck,
        href: '/contractor/dispatch',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'Correction Governance Desk',
        icon: ShieldCheck,
        href: '/super-admin/corrections',
      },
      {
        id: 'direct-corrections',
        label: 'Direct Record Corrections',
        icon: FileCheck2,
        href: '/super-admin/corrections?tab=direct_edit',
      },
      {
        id: 'audit-ledger',
        label: 'Audit & Correction Ledger',
        icon: History,
        href: '/super-admin/audit',
      },
      ...(role === 'SUPER_ADMIN'
        ? [
            {
              id: 'admin-center',
              label: 'Admin Control Center',
              icon: LayoutDashboard,
              href: '/super-admin',
            },
          ]
        : []),
      {
        id: 'sources-ledger',
        label: 'Milk Sources & Contractors',
        icon: Milk,
        href: '/mpd/head?tab=SOURCES',
      },
      {
        id: 'fleet',
        label: 'Fleet',
        icon: Truck,
        href: '/super-admin/fleet',
      },
      {
        id: 'stage-policies-rules',
        label: 'Lab Tests & Stage Policies',
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
        label: 'Yard Status Board',
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
        href: '/mpd/head?tab=APPROVALS',
      },
      {
        id: 'mpd-sources',
        label: 'Milk Sources & Contractors',
        icon: Milk,
        href: '/mpd/head?tab=SOURCES',
      },
      {
        id: 'mpd-head',
        label: 'Command Center',
        icon: LayoutDashboard,
        href: '/mpd/head?tab=COMMAND',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 12. Security Manager (Admin Head)
  if (role === 'ADMIN_HEAD') {
    return [
      {
        id: 'security-mgmt',
        label: 'Security Manager Station',
        icon: ShieldCheck,
        href: '/department/security',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'AVP-QA Executive Station',
        icon: ShieldAlert,
        href: '/department/qa-head',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
        icon: Tv,
        href: '/tv-board',
      },
    ];
  }

  // 14. Production Head (Silo Offloading & Weighbridge Operations)
  if (role === 'PRODUCTION_HEAD') {
    return [
      {
        id: 'production-station',
        label: 'Production Reception & Silos',
        icon: Database,
        href: '/department/production',
      },
      {
        id: 'weighbridge-station',
        label: 'Weighbridge Operations',
        icon: Scale,
        href: '/department/weighbridge',
      },
      {
        id: 'production-approvals',
        label: 'Approval Inbox',
        icon: ShieldAlert,
        href: '/mpd/head?tab=APPROVALS',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        href: '/mpd/head?tab=APPROVALS',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
        label: 'Executive Command Center',
        icon: LayoutDashboard,
        href: '/mpd/head?tab=COMMAND',
      },
      {
        id: 'exec-approvals',
        label: 'Universal Approval Inbox',
        icon: ShieldAlert,
        href: '/mpd/head?tab=APPROVALS',
      },
      {
        id: 'tv-board',
        label: 'Yard Status Board',
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
    label: 'Team Stations (Cover Staff)',
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
