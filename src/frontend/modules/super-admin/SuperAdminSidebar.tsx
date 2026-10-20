'use client';

import React, { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Truck,
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
  Grid3x3,
  Smartphone,
} from 'lucide-react';
import { User } from '@core/types';
import { Sheet } from '@/components/ui/sheet';
import { NavPanel, formatRoleLabel } from '@/frontend/modules/shared/navigation/NavPanel';
import type { RoleNavSection } from '@/frontend/modules/shared/navigation/roleNavConfig';

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
  { href: '/super-admin/users', label: 'Users', icon: Users },
  { href: '/super-admin/procurement-sources', label: 'Procurement Sources', icon: Truck },
  { href: '/super-admin/silos', label: 'Silos', icon: Database },
  { href: '/super-admin/lab-tests', label: 'Lab Test Master', icon: FlaskConical },
  { href: '/super-admin/test-policies', label: 'Stage Policies & Rules', icon: TestTubes },
  { href: '/super-admin/test-point-policies', label: 'Test Matrix', icon: Grid3x3 },
  { href: '/super-admin/devices', label: 'Phones', icon: Smartphone },
  { href: '/super-admin/qa-warnings', label: 'QA Warnings', icon: AlertTriangle },
  { href: '/super-admin/operations', label: 'Operations', icon: Activity },
  { href: '/super-admin/audit', label: 'Audit & Corrections', icon: History },
  { href: '/super-admin/zmcc-master-data', label: 'ZMCC Master Data', icon: Store },
  { href: '/super-admin/mot-operations', label: 'MOT Operations', icon: Navigation },
  { href: '/super-admin/whatsapp', label: 'WhatsApp Gateway', icon: MessageSquare },
  { href: '/tv-board', label: 'Yard Status Board', icon: Tv },
];

const SECTIONS: RoleNavSection[] = SUPER_ADMIN_NAV_ITEMS.map((item) => ({
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
  const drawerOpen = Boolean(isOpen ?? isMobileOpen);
  const closeHandler = onClose ?? onCloseMobile;

  const isActive = useCallback(
    (href: string) => pathname === href || (href !== '/super-admin' && pathname.startsWith(href)),
    [pathname]
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
          <NavPanel sections={SECTIONS} isActive={isActive} caption={caption} />
        </aside>
      ) : null}

      <Sheet open={drawerOpen} onOpenChange={handleOpenChange} title="Administration navigation">
        <NavPanel
          sections={SECTIONS}
          isActive={isActive}
          caption={caption}
          showClose
          onNavigate={() => handleOpenChange(false)}
        />
      </Sheet>
    </>
  );
};
