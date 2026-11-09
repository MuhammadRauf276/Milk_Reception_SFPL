'use client';

import React, { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Users,
} from 'lucide-react';
import { User } from '@core/types';
import { Sheet } from '@/components/ui/sheet';
import { NavPanel, formatRoleLabel } from '@/frontend/modules/shared/navigation/NavPanel';
import type { RoleNavSection } from '@/frontend/modules/shared/navigation/roleNavConfig';
import { DATA_EXECUTIVE_NAV_ITEMS, SUPER_ADMIN_NAV_ITEMS, toSection } from '@/frontend/modules/shared/navigation/adminNav';
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

    const tvBoardIndex = baseSections.findIndex((s) => s.id === 'tv-board');
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
        if (!curVal && leafPath === '/super-admin/reports' && (val === 'daily' || (key === 'section' && val === 'MOT'))) return;
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
