'use client';

import React, { useCallback, useRef, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProductionUnloadingWorkspace, ProductionTab } from '@modules/dashboard/ProductionUnloadingWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function ProductionDepartmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser: user, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (!canActAs(user.role, 'PRODUCTION_RECEPTION_OPERATOR')) {
      router.push('/workspace-unavailable');
    }
  }, [loading, user, router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'READY';
  const resolvedTab: ProductionTab =
    tabParam === 'UNLOADING' || tabParam === 'SILO_ISSUE'
      ? (tabParam as ProductionTab)
      : 'READY';

  if (loading) {
    return (
      <PageLoader label="Loading Production Silo Station…" className="min-h-screen" />
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Silo Unloading"
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
        <ProductionUnloadingWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/production?tab=${tab}`);
          }}
        />
        </PageTransition>
      </main>
    </div>
  );
}

export default function ProductionDepartmentPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading Production Silo Station…" className="min-h-screen" />
      }
    >
      <ProductionDepartmentContent />
    </Suspense>
  );
}
