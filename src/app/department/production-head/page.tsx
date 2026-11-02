'use client';

import React, { useCallback, useRef, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { ProductionHeadWorkspace, ProductionHeadTab } from '@/frontend/modules/dashboard/production/ProductionHeadWorkspace';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { canViewPlant13TsLiters } from '@/lib/role-visibility';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function ProductionHeadContent() {
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
    if (!canActAs(user.role, 'PRODUCTION_HEAD') && !canViewPlant13TsLiters(user.role)) {
      router.push('/workspace-unavailable');
    }
  }, [loading, user, router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'OVERVIEW';
  const resolvedTab: ProductionHeadTab =
    tabParam === 'HISTORY' || tabParam === 'SILOS'
      ? (tabParam as ProductionHeadTab)
      : 'OVERVIEW';

  const headerTitle =
    resolvedTab === 'SILOS'
      ? 'Plant Silos'
      : resolvedTab === 'HISTORY'
      ? 'Staff History'
      : 'Production';

  if (loading) {
    return (
      <PageLoader label="Loading Production Command Center…" className="min-h-[100dvh]" />
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title={headerTitle}
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

      <main className="flex-1 w-full min-w-0 max-w-full p-3 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <PageTransition>
          <ProductionHeadWorkspace
            currentUser={user}
            activeTab={resolvedTab}
            onTabChange={(tab) => {
              router.push(`/department/production-head?tab=${tab}`);
            }}
          />
        </PageTransition>
      </main>
    </div>
  );
}

export default function ProductionHeadPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading Production Command Center…" className="min-h-[100dvh]" />
      }
    >
      <ProductionHeadContent />
    </Suspense>
  );
}
