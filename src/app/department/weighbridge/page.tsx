'use client';

import React, { useCallback, useRef, Suspense, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WeighbridgeWorkspace, WeighbridgeTab } from '@modules/dashboard/WeighbridgeWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { can } from '@/backend/modules/access-control/policy';
import { createAccessActor } from '@/backend/modules/access-control/rolePolicies';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

const WEIGHBRIDGE_SCOPE = {
  kind: 'DEPARTMENT',
  departmentId: 'Production & Weighbridge',
} as const;

function WeighbridgeDepartmentContent() {
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

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'FIRST_WEIGHT';
  const resolvedTab: WeighbridgeTab =
    tabParam === 'SECOND_WEIGHT' ? 'SECOND_WEIGHT' : 'FIRST_WEIGHT';

  const hasAccess = useMemo(() => {
    if (!user) return false;
    if (canActAs(user.role, 'WEIGHBRIDGE_OPERATOR')) return true;
    const actor = createAccessActor(user);
    return actor ? can(actor, 'SUBMIT', WEIGHBRIDGE_SCOPE) : false;
  }, [user]);

  useEffect(() => {
    if (loading || hasAccess) return;
    router.replace(user ? '/workspace-unavailable' : '/login');
  }, [hasAccess, loading, router, user]);

  if (loading || !hasAccess) {
    return (
      <PageLoader label="Loading Weighbridge Workstation…" className="min-h-screen" />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Weighbridge"
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
        <WeighbridgeWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/weighbridge?tab=${tab}`);
          }}
        />
        </PageTransition>
      </main>
    </div>
  );
}

export default function WeighbridgeDepartmentPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading Weighbridge Workstation…" className="min-h-screen" />
      }
    >
      <WeighbridgeDepartmentContent />
    </Suspense>
  );
}
