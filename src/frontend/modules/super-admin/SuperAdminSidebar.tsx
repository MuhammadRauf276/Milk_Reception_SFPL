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
} from 'lucide-react';
import { User } from '@core/types';
import { Sheet } from '@/components/ui/sheet';
import { NavPanel, formatRoleLabel } from '@/frontend/modules/shared/navigation/NavPanel';
import type { RoleNavSection } from '@/frontend/modules/shared/navigation/roleNavConfig';
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

export const SUPER_ADMIN_NAV_ITEMS = [
  { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/super-admin/corrections', label: 'Correction Governance Desk', icon: ShieldCheck },
  { href: '/super-admin/corrections?tab=direct_edit', label: 'Direct Record Corrections', icon: FileCheck2 },
  { href: '/super-admin/users', label: 'Users', icon: Users },
  { href: '/super-admin/procurement-sources', label: 'Procurement Sources', icon: Truck },
  { href: '/mpd/head?tab=SOURCES', label: 'Milk Sources & Contractors', icon: Milk },
  { href: '/super-admin/silos', label: 'Silos', icon: Database },
  { href: '/super-admin/weighing-policy', label: 'ZMCC Weighing', icon: Scale },
  { href: '/super-admin/test-policies', label: 'Lab Tests & Stage Policies', icon: FlaskConical },
  { href: '/super-admin/devices', label: 'Phones', icon: Smartphone },
  { href: '/super-admin/qa-warnings', label: 'QA Warnings', icon: AlertTriangle },
  { href: '/super-admin/operations', label: 'Operations', icon: Activity },
  { href: '/super-admin/audit', label: 'Audit & Corrections', icon: History },
  { href: '/super-admin/zmcc-master-data', label: 'ZMCC Master Data', icon: Store },
  { href: '/super-admin/mot-operations', label: 'MC Operations', icon: Navigation },
  { href: '/super-admin/fleet', label: 'Fleet', icon: Truck },
  { href: '/super-admin/whatsapp', label: 'WhatsApp Gateway', icon: MessageSquare },
  { href: '/tv-board', label: 'Yard Status Board', icon: Tv },
];

export const DATA_EXECUTIVE_NAV_ITEMS = [
  { href: '/super-admin/corrections', label: 'Correction Governance Desk', icon: ShieldCheck },
  { href: '/super-admin/corrections?tab=direct_edit', label: 'Direct Record Corrections', icon: FileCheck2 },
  { href: '/super-admin/audit', label: 'Audit & Corrections Ledger', icon: History },
  { href: '/super-admin/test-policies', label: 'Lab Tests & Stage Policies', icon: FlaskConical },
  { href: '/super-admin/zmcc-master-data', label: 'ZMCC Master Data', icon: Store },
  { href: '/super-admin/mot-operations', label: 'MC Operations', icon: Navigation },
  { href: '/super-admin/fleet', label: 'Fleet', icon: Truck },
  { href: '/super-admin/procurement-sources', label: 'Procurement Sources', icon: Truck },
  { href: '/mpd/head?tab=SOURCES', label: 'Milk Sources & Contractors', icon: Milk },
  { href: '/tv-board', label: 'Yard Status Board', icon: Tv },
];

const BASE_SECTIONS: RoleNavSection[] = SUPER_ADMIN_NAV_ITEMS.map((item) => ({
  id: item.href,
  label: item.label,
  icon: item.icon,
  href: item.href,
}));

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
    const items = isDataExec ? DATA_EXECUTIVE_NAV_ITEMS : SUPER_ADMIN_NAV_ITEMS;
    const baseSections: RoleNavSection[] = items.map((item) => ({
      id: item.href,
      label: item.label,
      icon: item.icon,
      href: item.href,
    }));

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
        return true;
      }
      const leafParams = new URLSearchParams(leafQueryStr);
      let allMatch = true;
      leafParams.forEach((val, key) => {
        if (key === 'zmccId' || key === 'zmcc_id' || key === 'sourceId') return;
        const curVal = searchParams?.get(key);
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
