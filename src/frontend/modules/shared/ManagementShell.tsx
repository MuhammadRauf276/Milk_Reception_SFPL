'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

interface ManagementShellProps {
  title: string;
  allowedRoles: readonly string[];
  children: (user: User) => React.ReactNode;
}

/**
 * Role-neutral shell for shared management tools (/approvals, /command, /sources).
 * These routes are not stations, so no "Covering" banner is ever shown here.
 */
export function ManagementShell({ title, allowedRoles, children }: ManagementShellProps) {
  const router = useRouter();
  const { currentUser, loadingUser } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const isAuthorized = !!currentUser && allowedRoles.includes(currentUser.role);

  useEffect(() => {
    if (loadingUser) return;
    if (!currentUser) {
      router.push('/login');
      return;
    }
    if (!isAuthorized) router.push('/workspace-unavailable');
  }, [loadingUser, currentUser, isAuthorized, router]);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  if (loadingUser) return <PageLoader label="Verifying Authorization…" className="min-h-[100dvh]" />;
  if (!currentUser || !isAuthorized) return null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title={title}
        showBranding={true}
        showMenuButton={true}
        onMenuClick={() => setIsDrawerOpen(true)}
        menuButtonRef={hamburgerButtonRef}
      />
      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />
      <main className="flex-1 w-full min-w-0 max-w-full p-3 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <PageTransition>{children(currentUser)}</PageTransition>
      </main>
    </div>
  );
}
