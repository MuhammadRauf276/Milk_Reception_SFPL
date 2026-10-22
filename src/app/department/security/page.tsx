'use client';

import React, { useCallback, useRef, Suspense, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SecurityGatewayWorkspace, SecurityTab } from '@modules/dashboard/SecurityGatewayWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { can } from '@/backend/modules/access-control/policy';
import { createAccessActor } from '@/backend/modules/access-control/rolePolicies';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { resolveRoleHome } from '@/lib/role-routing';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

const SECURITY_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Security' } as const;

function SecurityDepartmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser: user, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'WAITING_ENTRY';
  const resolvedTab: SecurityTab =
    tabParam === 'INSIDE_PLANT' || tabParam === 'READY_EXIT'
      ? (tabParam as SecurityTab)
      : 'WAITING_ENTRY';

  const hasAccess = useMemo(() => {
    if (!user) return false;
    if (canActAs(user.role, 'SECURITY_OPERATOR')) return true;
    const actor = createAccessActor(user);
    return actor ? can(actor, 'VIEW', SECURITY_SCOPE) : false;
  }, [user]);

  useEffect(() => {
    if (loading || hasAccess) return;
    router.replace(user ? resolveRoleHome(user.role) : '/login');
  }, [hasAccess, loading, router, user]);

  if (loading || !hasAccess) {
    return (
      <PageLoader label="Loading Gate Entry & Exit…" className="min-h-screen" />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Gate Entry & Exit"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={user}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <PageTransition>
        <SecurityGatewayWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/security?tab=${tab}`);
          }}
        />
        </PageTransition>
      </main>
    </div>
  );
}

export default function SecurityDepartmentPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading Gate Entry & Exit…" className="min-h-screen" />
      }
    >
      <SecurityDepartmentContent />
    </Suspense>
  );
}
