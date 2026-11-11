import type React from 'react';
import {
  LayoutDashboard,
  Users,
  Truck,
  Milk,
  Database,
  FlaskConical,
  Activity,
  History,
  Store,
  Navigation,
  Tv,
  MessageSquare,
  ShieldCheck,
  Smartphone,
  Scale,
  FileSpreadsheet,
  Building2,
  Camera,
} from 'lucide-react';
import type { RoleNavSection } from './roleNavConfig';

/** The one menu for Super Admin and Data Executive, on every screen they visit. */
export type AdminNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { href: string; label: string }[];
};

const SOURCES_CHILDREN_OWNER = [
  { href: '/sources', label: 'Milk sources' },
  { href: '/sources?view=CONTRACTORS', label: 'Contractors' },
];

const CORRECTION_CHILDREN = [
  { href: '/super-admin/corrections?tab=requests', label: 'Requests' },
  { href: '/super-admin/corrections?tab=direct_edit', label: 'Direct edit' },
  { href: '/super-admin/corrections?tab=audit', label: 'Correction audit' },
];

const MASTER_DATA_CHILDREN = [
  { href: '/super-admin/zmcc-master-data?view=LOCAL_SUPPLIERS', label: 'HC Suppliers' },
  { href: '/super-admin/zmcc-master-data?view=ROUTES', label: 'Routes' },
  { href: '/super-admin/zmcc-master-data?view=AREAS', label: 'Areas' },
  { href: '/super-admin/zmcc-master-data?view=MILK_SOURCES', label: 'Milk Sources' },
  { href: '/super-admin/zmcc-master-data?view=SHOPS', label: 'Shops' },
  { href: '/super-admin/zmcc-master-data?view=CHILLER_OWNERSHIP', label: 'Chillers' },
  { href: '/super-admin/zmcc-master-data?view=TANKS', label: 'Tanks' },
  { href: '/super-admin/zmcc-master-data?view=APPROVALS', label: 'Approvals' },
];

const MC_OPS_CHILDREN = [
  { href: '/super-admin/mot-operations?view=DISPATCH', label: 'Dispatch' },
  { href: '/super-admin/mot-operations?view=ACTIVE_JOURNEYS', label: 'Active' },
  { href: '/super-admin/mot-operations?view=JOURNEY_HISTORY', label: 'History' },
  { href: '/super-admin/mot-operations?view=JOURNEY_MAP', label: 'Map' },
  { href: '/super-admin/mot-operations?view=SMS_OUTBOX', label: 'Receipts' },
  { href: '/super-admin/mot-operations?view=PROFILES', label: 'Testers' },
  { href: '/super-admin/mot-operations?view=APPROVALS', label: 'Approvals' },
];

const REPORTS_GOVERNANCE_CHILDREN = [
  { href: '/super-admin/reports?tab=daily&section=MOT', label: 'Daily: Mobile Tester' },
  { href: '/super-admin/reports?tab=daily&section=ZMCC', label: 'Daily: ZMCC lab' },
  { href: '/super-admin/reports?tab=daily&section=PLANT_QA', label: 'Daily: Plant QA' },
  { href: '/super-admin/reports?tab=daily&section=EXCEPTIONS', label: 'Daily: exceptions' },
  { href: '/super-admin/reports?tab=hierarchy', label: 'Senior actions' },
  { href: '/super-admin/reports?tab=warnings', label: 'Warning limits' },
];

export const SUPER_ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/super-admin/corrections', label: 'Corrections', icon: ShieldCheck, children: CORRECTION_CHILDREN },
  { href: '/super-admin/users', label: 'Users', icon: Users },
  { href: '/sources', label: 'Sources', icon: Milk, children: SOURCES_CHILDREN_OWNER },
  { href: '/approvals', label: 'Approval Inbox', icon: ShieldCheck },
  { href: '/command', label: 'Command Center', icon: Activity },
  { href: '/super-admin/silos', label: 'Silos', icon: Database },
  { href: '/super-admin/zmcc-tanks', label: 'ZMCC Tanks', icon: Building2 },
  { href: '/super-admin/weighing-policy', label: 'Weighing Policy', icon: Scale },
  { href: '/super-admin/test-policies', label: 'Lab Policies', icon: FlaskConical },
  {
    href: '/super-admin/reports',
    label: 'Reports',
    icon: FileSpreadsheet,
    children: REPORTS_GOVERNANCE_CHILDREN,
  },
  { href: '/super-admin/devices', label: 'Phones', icon: Smartphone },
  { href: '/super-admin/operations', label: 'Operations', icon: Activity },
  { href: '/super-admin/audit', label: 'Audit', icon: History },
  { href: '/super-admin/photos', label: 'Photo register', icon: Camera },
  { href: '/super-admin/procurement-sources', label: 'ZMCCs', icon: Store },
  { href: '/super-admin/zmcc-master-data', label: 'Master Data', icon: Store, children: MASTER_DATA_CHILDREN },
  { href: '/super-admin/mot-operations', label: 'Mobile Testers', icon: Navigation, children: MC_OPS_CHILDREN },
  { href: '/super-admin/fleet', label: 'Fleet', icon: Truck },
  { href: '/super-admin/whatsapp', label: 'WhatsApp Gateway', icon: MessageSquare },
  { href: '/tv-board', label: 'Yard Board', icon: Tv },
];

export const DATA_EXECUTIVE_NAV_ITEMS: AdminNavItem[] = [
  { href: '/super-admin/corrections', label: 'Corrections', icon: ShieldCheck, children: CORRECTION_CHILDREN.filter((c) => !c.href.includes('direct_edit')) },
  { href: '/super-admin/audit', label: 'Audit', icon: History },
  { href: '/super-admin/photos', label: 'Photo register', icon: Camera },
  { href: '/super-admin/test-policies', label: 'Lab Policies', icon: FlaskConical },
  {
    href: '/super-admin/reports',
    label: 'Reports',
    icon: FileSpreadsheet,
    children: REPORTS_GOVERNANCE_CHILDREN,
  },
  { href: '/super-admin/zmcc-master-data', label: 'Master Data', icon: Store, children: MASTER_DATA_CHILDREN },
  { href: '/super-admin/zmcc-tanks', label: 'ZMCC Tanks', icon: Building2 },
  { href: '/super-admin/mot-operations', label: 'Mobile Testers', icon: Navigation, children: MC_OPS_CHILDREN },
  { href: '/super-admin/fleet', label: 'Fleet', icon: Truck },
  { href: '/sources', label: 'Sources', icon: Milk, children: SOURCES_CHILDREN_OWNER },
  { href: '/approvals', label: 'Approval Inbox', icon: ShieldCheck },
  { href: '/command', label: 'Command Center', icon: Activity },
  { href: '/tv-board', label: 'Yard Board', icon: Tv },
];

export function toSection(item: AdminNavItem): RoleNavSection {
  return item.children
    ? {
        id: item.href === '/tv-board' ? 'tv-board' : item.href,
        label: item.label,
        icon: item.icon,
        children: item.children.map((c) => ({ id: c.href, label: c.label, href: c.href })),
      }
    : { id: item.href === '/tv-board' ? 'tv-board' : item.href, label: item.label, icon: item.icon, href: item.href };
}
