'use client';

import React, { useMemo, useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { User } from '@core/types';
import { Sheet } from '@/components/ui/sheet';
import { resolveRoleHome } from '@/lib/role-routing';
import { LayoutDashboard } from 'lucide-react';
import { resolveDelegationContext } from '../delegation/stations';
import { getRoleNavSections, RoleNavSection } from './roleNavConfig';
import { NavPanel, formatRoleLabel } from './NavPanel';

interface HierarchicalNavDrawerProps {
  currentUser: User | null;
  isOpen: boolean;
  onClose: () => void;
  triggerButtonRef?: React.RefObject<HTMLButtonElement | null>;
  /** @deprecated Links navigate directly; kept for API compatibility. */
  onNavigate?: (href: string) => void;
  /** Show the persistent sidebar on desktop (lg+). Defaults to true. */
  persistent?: boolean;
}

export const HierarchicalNavDrawer: React.FC<HierarchicalNavDrawerProps> = ({
  currentUser,
  isOpen,
  onClose,
  triggerButtonRef,
  persistent = true,
}) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const zmccId = searchParams?.get('zmccId') || searchParams?.get('zmcc_id') || searchParams?.get('sourceId');

  const delegationContext = useMemo(
    () => resolveDelegationContext(currentUser, pathname, searchParams),
    [currentUser, pathname, searchParams]
  );

  const sections = useMemo<RoleNavSection[]>(() => {
    if (!currentUser) return [];

    if (delegationContext.isDelegated && delegationContext.actingAs) {
      // Station-aware mode: render the active station's full operational navigation
      const stationSections = getRoleNavSections({ ...currentUser, role: delegationContext.actingAs }, zmccId);
      // The delegation banner already offers 'Return to My Work'.
      return stationSections;
    }

    const roleSections = getRoleNavSections(currentUser, zmccId);
    if (roleSections.length > 0) return roleSections;
    // Roles without a curated tree still get a way back to their home workspace.
    return [{ id: 'home', label: 'Home', icon: LayoutDashboard, href: resolveRoleHome(currentUser.role) }];
  }, [currentUser, zmccId, delegationContext]);

  // Determine if a leaf is currently active based on current path and search params
  const isLeafActive = useCallback(
    (leafHref: string) => {
      const [leafPath, leafQueryStr] = leafHref.split('?');
      if (pathname !== leafPath) return false;

      const leafParams = new URLSearchParams(leafQueryStr || '');
      // A plain leaf (no view) is not active while a sibling view of the same page is open.
      if (leafPath === '/sources' && !leafParams.get('view') && searchParams?.get('view')) return false;

      // Check each leaf query parameter against current search params
      let allMatch = true;
      leafParams.forEach((val, key) => {
        // Source selection params (zmccId, sourceId) should not affect active tab matching
        if (key === 'zmccId' || key === 'zmcc_id' || key === 'sourceId') {
          return;
        }
        const curVal = searchParams?.get(key);
        if (!curVal) {
          // Check default fallback if query parameter omitted in URL
          if (leafPath === '/phe' && key === 'section' && val === 'arrivals') {
            // default section
          } else if (leafPath === '/phe' && key === 'view' && val === 'mot-arrival' && (!searchParams?.get('section') || searchParams?.get('section') === 'arrivals')) {
            // default view for arrivals
          } else if (leafPath === '/phe' && key === 'view' && val === 'dispatch' && searchParams?.get('section') === 'mot') {
            // default view for mot
          } else if (leafPath === '/phe' && key === 'view' && val === 'local-suppliers' && searchParams?.get('section') === 'suppliers') {
            // default view for suppliers
          } else if (leafPath === '/zmcc/lab' && key === 'tab' && val === 'queue') {
            // default tab
          } else if (leafPath === '/zmcc/dispatch' && key === 'tab' && val === 'new') {
            // default tab
          } else if (leafPath === '/department/security' && key === 'tab' && val === 'WAITING_ENTRY') {
            // default tab
          } else if (leafPath === '/department/qa' && key === 'tab' && val === 'WAITING') {
            // default tab
          } else if (leafPath === '/department/qa-head' && key === 'tab' && val === 'EXCEPTIONS') {
            // default tab
          } else if (leafPath === '/department/weighbridge' && key === 'tab' && val === 'FIRST_WEIGHT') {
            // default tab
          } else if (leafPath === '/department/production' && key === 'tab' && val === 'READY') {
            // default tab
          } else if (leafPath === '/contractor/manager' && key === 'tab' && (val === 'APPROVALS' || val === 'OVERVIEW')) {
            // default tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'tab' && val === 'OVERVIEW') {
            // default tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'view' && val === 'ACTIVE' && searchParams?.get('tab') === 'MOT_JOURNEYS') {
            // default view for mot journeys tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'view' && val === 'IN_TRANSIT' && searchParams?.get('tab') === 'PLANT_TRANSIT') {
            // default view for plant transit tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'mode' && val === 'STUDIO' && searchParams?.get('tab') === 'REPORTS') {
            // default view for reports tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'view' && val === 'PLANT_HISTORY') {
            // default view for history tab
          } else if (leafPath === '/mpd/zmcc-manager' && key === 'view' && val === 'LOCAL_SUPPLIERS' && (!searchParams?.get('tab') || searchParams?.get('tab') === 'MASTER_DATA')) {
            // default view for master data tab
          } else if (leafPath === '/super-admin/corrections' && key === 'tab' && val === 'requests') {
            // default tab
          } else if (leafPath === '/command' && key === 'view' && val === 'FLEET_RADAR') {
            // default view
          } else {
            allMatch = false;
          }
        } else if (curVal.toLowerCase() !== val.toLowerCase()) {
          allMatch = false;
        }
      });

      return allMatch;
    },
    [pathname, searchParams]
  );

  // Direct section match (for sections without children)
  const isSectionActive = useCallback(
    (section: RoleNavSection) => {
      if (!section.href) return false;
      return isLeafActive(section.href);
    },
    [isLeafActive]
  );

  const isActive = useCallback(
    (href: string) => {
      const section = sections.find((s) => s.href === href && !s.children?.length);
      return section ? isSectionActive(section) : isLeafActive(href);
    },
    [sections, isSectionActive, isLeafActive]
  );

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    onClose();
    setTimeout(() => triggerButtonRef?.current?.focus(), 0);
  };

  if (!currentUser) return null;

  const caption = delegationContext.isDelegated
    ? `${delegationContext.subordinateRoleLabel} (Team Station)`
    : formatRoleLabel(currentUser.role);
  const footer = (
    <div className="min-w-0 text-xs">
      <p className="truncate font-medium text-foreground">{currentUser.name || 'Operator'}</p>
      {currentUser.username ? <p className="truncate text-muted-foreground">@{currentUser.username}</p> : null}
    </div>
  );

  return (
    <>
      {persistent ? (
        <aside
          data-app-sidebar
          className="fixed inset-y-0 left-0 z-sidebar hidden w-(--sidebar-width) border-r bg-card lg:block"
        >
          <NavPanel
            sections={sections}
            isActive={isActive}
            caption={caption}
            footer={footer}
            defaultExpanded={['team-stations', 'HISTORY', 'MASTER_DATA', 'MOT_JOURNEYS', 'PLANT_TRANSIT', 'REPORTS', 'arrivals', 'suppliers', 'mot']}
          />
        </aside>
      ) : null}

      <Sheet open={isOpen} onOpenChange={handleOpenChange} title="Navigation">
        <NavPanel
          sections={sections}
          isActive={isActive}
          caption={caption}
          footer={footer}
          defaultExpanded={['team-stations', 'HISTORY', 'MASTER_DATA', 'MOT_JOURNEYS', 'PLANT_TRANSIT', 'REPORTS', 'arrivals', 'suppliers', 'mot']}
          showClose
          onNavigate={() => handleOpenChange(false)}
        />
      </Sheet>
    </>
  );
};
