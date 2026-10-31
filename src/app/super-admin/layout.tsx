'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SuperAdminSidebar } from '@/frontend/modules/super-admin/SuperAdminSidebar';
import { SuperAdminHeader } from '@/frontend/modules/super-admin/SuperAdminHeader';
import { resolveRoleHome } from '@/lib/role-routing';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { currentUser, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const isAuthorized = React.useMemo(() => {
    if (!currentUser) return false;
    const role = currentUser.role;
    const allowedRoles = [
      'SUPER_ADMIN',
      'SYSTEM_ADMIN',
      'DATA_EXECUTIVE',
      'DATA_ANALYST',
      'EXECUTIVE_MANAGEMENT',
      'ADMIN_HEAD',
      'FINANCE_ACCOUNTS',
      'QA_HEAD',
      'PRODUCTION_HEAD',
      'HEAD_OF_MPD',
    ];
    return allowedRoles.includes(role);
  }, [currentUser]);

  useEffect(() => {
    if (loading) return;
    if (!currentUser) {
      router.replace('/login');
      return;
    }
    if (!isAuthorized) {
      router.replace(resolveRoleHome(currentUser.role));
    }
  }, [loading, currentUser, isAuthorized, router]);

  if (loading) {
    return (
      <PageLoader label="Verifying access…" className="min-h-[100dvh]" />
    );
  }

  if (!isAuthorized || !currentUser) {
    return null;
  }

  return (
    <div className="flex min-h-[100dvh] w-full max-w-full flex-col bg-background text-foreground overflow-x-hidden">
      <SuperAdminHeader
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onMenuClick={() => setIsDrawerOpen(true)}
        menuButtonRef={hamburgerButtonRef}
      />
      <SuperAdminSidebar
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        triggerRef={hamburgerButtonRef}
      />
      <main className="w-full min-w-0 max-w-full flex-1 p-3 sm:p-6 lg:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
