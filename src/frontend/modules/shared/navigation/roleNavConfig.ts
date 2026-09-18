import React from 'react';
import { User } from '@core/types';
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
  Phone,
  LayoutDashboard,
  ArrowRightLeft,
  Route as RouteIcon,
  Building2,
  Milk,
  ShieldCheck,
  Scale,
  Factory,
  Tv,
  Receipt,
  PauseCircle,
  Play,
  Database,
  CheckCircle2,
} from 'lucide-react';

export interface RoleNavLeaf {
  id: string;
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  isReference?: boolean;
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
export function getRoleNavSections(currentUser: User | null): RoleNavSection[] {
  if (!currentUser) return [];

  const role = currentUser.role || '';

  // 1. PHE Operator
  if (role === 'PHE_OPERATOR') {
    return [
      {
        id: 'arrivals',
        label: 'Arrivals & Tokens',
        icon: ClipboardList,
        children: [
          {
            id: 'mot-arrival',
            label: 'Record MOT Arrival',
            href: '/phe?section=arrivals&view=mot-arrival',
            icon: Truck,
          },
          {
            id: 'local-supplier-arrival',
            label: 'Record Local Supplier Arrival',
            href: '/phe?section=arrivals&view=local-supplier-arrival',
            icon: Users,
          },
          {
            id: 'inside',
            label: 'Vehicles Inside ZMCC',
            href: '/phe?section=arrivals&view=inside',
            icon: Clock,
          },
          {
            id: 'history',
            label: 'Arrival History & Corrections',
            href: '/phe?section=arrivals&view=history',
            icon: History,
          },
        ],
      },
      {
        id: 'suppliers',
        label: 'Local Suppliers / Shop Details',
        icon: Store,
        children: [
          {
            id: 'local-suppliers',
            label: 'Local Suppliers',
            href: '/phe?section=suppliers&view=local-suppliers',
            icon: Users,
          },
          {
            id: 'shop-details',
            label: 'Shop Details (Reference)',
            href: '/phe?section=suppliers&view=shop-details',
            icon: Store,
            isReference: true,
          },
        ],
      },
      {
        id: 'mot',
        label: 'MOT Dispatch & Journeys',
        icon: Truck,
        children: [
          {
            id: 'dispatch',
            label: 'Assign & Dispatch',
            href: '/phe?section=mot&view=dispatch',
            icon: Send,
          },
          {
            id: 'active',
            label: 'Active Journeys',
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
            label: 'Live Journey Map',
            href: '/phe?section=mot&view=map',
            icon: MapPin,
          },
          {
            id: 'sms',
            label: 'SMS Outbox',
            href: '/phe?section=mot&view=sms',
            icon: Phone,
          },
        ],
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
        id: 'LIVE',
        label: 'Live Operations',
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
            id: 'arrival_corr',
            label: 'Arrival Corrections',
            href: '/mpd/zmcc-manager?tab=HISTORY&view=ARRIVAL_CORRECTIONS',
            icon: ClipboardList,
          },
          {
            id: 'lab_corr',
            label: 'Lab Corrections',
            href: '/mpd/zmcc-manager?tab=HISTORY&view=LAB_CORRECTIONS',
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
            label: 'Local Suppliers',
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
    ];
  }

  // 4. MOT Driver
  if (role === 'MOT') {
    return [
      {
        id: 'mot',
        label: 'MOT Driver',
        icon: Truck,
        children: [
          {
            id: 'journey',
            label: 'My Journey',
            href: '/mot',
            icon: Truck,
          },
        ],
      },
    ];
  }

  // 5. Security Operator
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
        icon: Factory,
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
            id: 'overview',
            label: 'Overview',
            href: '/contractor/manager?tab=OVERVIEW',
            icon: LayoutDashboard,
          },
          {
            id: 'live',
            label: 'Live Pipeline',
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
    ];
  }

  // 10. Super Admin
  if (role === 'SUPER_ADMIN') {
    return [
      {
        id: 'admin-center',
        label: 'Admin Control Center',
        icon: LayoutDashboard,
        href: '/super-admin',
      },
      {
        id: 'lab-tests',
        label: 'Lab Tests',
        icon: FlaskConical,
        href: '/super-admin/lab-tests',
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
        id: 'mpd-head',
        label: 'Head of MPD Station',
        icon: LayoutDashboard,
        href: '/mpd/head',
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
        href: '/department/security-manager',
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
