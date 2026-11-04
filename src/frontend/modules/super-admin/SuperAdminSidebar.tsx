'use client';

import React, { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Truck,
  Milk,
  Database,
  FlaskConical,
  AlertTriangle,
  Activity,
  History,
  Store,
  Navigation,
  Tv,
  TestTubes,
  MessageSquare,
  ShieldCheck,
  FileCheck2,
  Smartphone,
  Scale,
  FileSpreadsheet,
  Building2,
} from 'lucide-react';
import { User } from '@core/types';
import { Sheet } from '@/components/ui/sheet';
import { NavPanel, formatRoleLabel } from '@/frontend/modules/shared/navigation/NavPanel';
import type { RoleNavSection } from '@/frontend/modules/shared/navigation/roleNavConfig';
import { canSeeTestPolicies, isTestPolicyPath } from '@/lib/test-policy-access';
import { getTeamStationsForRole } from '@/frontend/modules/shared/delegation/stations';

export interface SuperAdminSidebarProps {
  currentUser?: User | null;
  isOpen?: boolean;
  isMobileOpen?: boolean;
  onClose?: () => void;
  onCloseMobile?: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  /** Show the persistent sidebar on desktop (lg+). Defaults to true. */
  persistent?: boolean;
}

type AdminNavItem = {
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
  { href: '/super-admin/reports?tab=daily', label: 'Daily Quality & Ops' },
  { href: '/super-admin/reports?tab=hierarchy', label: 'Work for Lower Roles' },
  { href: '/super-admin/reports?tab=warnings', label: 'Warning Limits & Policy' },
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
    label: 'Reports & Governance',
    icon: FileSpreadsheet,
    children: REPORTS_GOVERNANCE_CHILDREN,
  },
  { href: '/super-admin/devices', label: 'Phones', icon: Smartphone },
  { href: '/super-admin/operations', label: 'Operations', icon: Activity },
  { href: '/super-admin/audit', label: 'Audit', icon: History },
  { href: '/super-admin/procurement-sources', label: 'ZMCCs', icon: Store },
  { href: '/super-admin/zmcc-master-data', label: 'Master Data', icon: Store, children: MASTER_DATA_CHILDREN },
  { href: '/super-admin/mot-operations', label: 'Mobile Tester Operations', icon: Navigation, children: MC_OPS_CHILDREN },
  { href: '/super-admin/fleet', label: 'Fleet', icon: Truck },
  { href: '/super-admin/whatsapp', label: 'WhatsApp Gateway', icon: MessageSquare },
  { href: '/tv-board', label: 'Yard Status Board', icon: Tv },
];

export const DATA_EXECUTIVE_NAV_ITEMS: AdminNavItem[] = [
  { href: '/super-admin/corrections', label: 'Corrections', icon: ShieldCheck, children: CORRECTION_CHILDREN },
  { href: '/super-admin/audit', label: 'Audit', icon: History },
  { href: '/super-admin/test-policies', label: 'Lab Policies', icon: FlaskConical },
  {
    href: '/super-admin/reports',
    label: 'Reports & Governance',
    icon: FileSpreadsheet,
    children: REPORTS_GOVERNANCE_CHILDREN,
  },
  { href: '/super-admin/zmcc-master-data', label: 'Master Data', icon: Store, children: MASTER_DATA_CHILDREN },
  { href: '/super-admin/zmcc-tanks', label: 'ZMCC Tanks', icon: Building2 },
  { href: '/super-admin/mot-operations', label: 'Mobile Tester Operations', icon: Navigation, children: MC_OPS_CHILDREN },
  { href: '/super-admin/fleet', label: 'Fleet', icon: Truck },
  { href: '/sources', label: 'Sources', icon: Milk, children: SOURCES_CHILDREN_OWNER },
  { href: '/approvals', label: 'Approval Inbox', icon: ShieldCheck },
  { href: '/command', label: 'Command Center', icon: Activity },
  { href: '/tv-board', label: 'Yard Status Board', icon: Tv },
];

function toSection(item: AdminNavItem): RoleNavSection {
  return item.children
    ? {
        id: item.href,
        label: item.label,
        icon: item.icon,
        children: item.children.map((c) => ({ id: c.href, label: c.label, href: c.href })),
      }
    : { id: item.href, label: item.label, icon: item.icon, href: item.href };
}


export const SuperAdminSidebar: React.FC<SuperAdminSidebarProps> = ({
  currentUser,
  isOpen,
  isMobileOpen,
  onClose,
  onCloseMobile,
  triggerRef,
  persistent = true,
}) => {
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const currentSourceId =
    searchParams?.get('zmccId') || searchParams?.get('zmcc_id') || searchParams?.get('sourceId');
  const drawerOpen = Boolean(isOpen ?? isMobileOpen);
  const closeHandler = onClose ?? onCloseMobile;

  const sections = useMemo<RoleNavSection[]>(() => {
    const role = currentUser?.role;
    const isDataExec = role === 'DATA_EXECUTIVE';
    const items = (isDataExec ? DATA_EXECUTIVE_NAV_ITEMS : SUPER_ADMIN_NAV_ITEMS).filter((item) => canSeeTestPolicies(role) || !isTestPolicyPath(item.href));
    const baseSections: RoleNavSection[] = items.map(toSection);

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

    const tvBoardIndex = baseSections.findIndex((s) => s.id === '/tv-board');
    if (tvBoardIndex >= 0) {
      const next = [...baseSections];
      next.splice(tvBoardIndex, 0, teamSection);
      return next;
    }
    return [...baseSections, teamSection];
  }, [currentUser?.role, currentSourceId]);

  const isActive = useCallback(
    (href: string) => {
      const [leafPath, leafQueryStr] = href.split('?');
      if (pathname !== leafPath) {
        if (href === '/super-admin') return pathname === '/super-admin';
        return (
          pathname.startsWith(href) &&
          !href.startsWith('/zmcc') &&
          !href.startsWith('/phe') &&
          !href.startsWith('/mot') &&
          !href.startsWith('/department') &&
          !href.startsWith('/contractor')
        );
      }
      if (!leafQueryStr) {
        if (href === '/super-admin/corrections') {
          const tab = searchParams?.get('tab');
          return !tab || tab === 'requests' || tab === 'PENDING';
        }
        if (href === '/sources') return !searchParams?.get('view');
        return true;
      }
      const leafParams = new URLSearchParams(leafQueryStr);
      let allMatch = true;
      leafParams.forEach((val, key) => {
        if (key === 'zmccId' || key === 'zmcc_id' || key === 'sourceId') return;
        const curVal = searchParams?.get(key);
        if (!curVal && leafPath === '/super-admin/corrections' && val === 'requests') return;
        if (!curVal && leafPath === '/super-admin/reports' && val === 'daily') return;
        if (!curVal && key === 'view' && /LOCAL_SUPPLIERS|DISPATCH/.test(val)) return;
        if (curVal !== val) allMatch = false;
      });
      return allMatch;
    },
    [pathname, searchParams]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      closeHandler?.();
      setTimeout(() => triggerRef?.current?.focus(), 0);
    },
    [closeHandler, triggerRef]
  );

  const caption = currentUser?.role ? formatRoleLabel(currentUser.role) : 'Administration';

  return (
    <>
      {persistent ? (
        <aside
          data-app-sidebar
          className="fixed inset-y-0 left-0 z-sidebar hidden w-(--sidebar-width) border-r bg-card lg:block"
        >
          <NavPanel sections={sections} isActive={isActive} caption={caption} />
        </aside>
      ) : null}

      <Sheet open={drawerOpen} onOpenChange={handleOpenChange} title="Administration navigation">
        <NavPanel
          sections={sections}
          isActive={isActive}
          caption={caption}
          showClose
          onNavigate={() => handleOpenChange(false)}
        />
      </Sheet>
    </>
  );
};
