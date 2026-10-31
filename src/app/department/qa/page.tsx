'use client';

import React, { useCallback, useRef, Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { QALaboratoryWorkspace, QATab } from '@modules/dashboard/QALaboratoryWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function QADepartmentContent() {
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
    if (!canActAs(user.role, 'QA_LAB_ATTENDANT')) {
      router.push('/workspace-unavailable');
    }
  }, [loading, user, router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'WAITING';
  const resolvedTab: QATab =
    tabParam === 'IN_TESTING' || tabParam === 'ON_HOLD'
      ? (tabParam as QATab)
      : 'WAITING';

  if (loading) {
    return (
      <PageLoader label="Loading QA Laboratory…" className="min-h-[100dvh]" />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="QA Laboratory"
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
        <QALaboratoryWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/qa?tab=${tab}`);
          }}
        />
        </PageTransition>
      </main>
    </div>
  );
}

export default function QADepartmentPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading QA Laboratory…" className="min-h-[100dvh]" />
      }
    >
      <QADepartmentContent />
    </Suspense>
  );
}
