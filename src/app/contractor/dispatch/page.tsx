'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { DynamicDispatchForm } from '@modules/forms/DynamicDispatchForm';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';

import { canActAs } from '@/backend/core/roles/hierarchy';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function ContractorDispatchContent() {
  const router = useRouter();
  const { currentUser, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!currentUser) {
      router.push('/login');
      return;
    }
    if (!canActAs(currentUser.role, 'CONTRACTOR_OPERATOR')) {
      router.push('/workspace-unavailable');
      return;
    }

    const isSystemScope =
      currentUser.role === 'SUPER_ADMIN' ||
      currentUser.role === 'DATA_EXECUTIVE' ||
      currentUser.role === 'HEAD_OF_MPD' ||
      currentUser.role === 'EXECUTIVE_MANAGEMENT';

    if (!isSystemScope) {
      if (
        !currentUser.procurement_source_id ||
        !currentUser.procurement_source ||
        currentUser.procurement_source.is_active === false ||
        currentUser.procurement_source.source_type !== 'CONTRACTOR'
      ) {
        router.push('/workspace-unavailable');
      }
    }
  }, [loading, currentUser, router]);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  if (loading) {
    return (
      <PageLoader label="Loading Contractor Dispatch Station…" className="min-h-screen" />
    );
  }

  if (!currentUser) {
    return null;
  }

  const assignedSourceName =
    currentUser.procurement_source?.name ||
    'Contractor Source';

  return (
    <div className="w-full max-w-full flex flex-col min-h-[100dvh] bg-background text-foreground overflow-x-hidden">
      <Header
        currentUser={currentUser}
        sourceName={assignedSourceName}
        title="Contractor Dispatch to Plant"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      {/* Accessible Hierarchical Navigation Drawer */}
      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      {/* Main Responsive Area */}
      <div className="flex-1 flex flex-col w-full min-w-0">
        <main className="flex-1 w-full min-w-0 max-w-full p-3 sm:p-6 lg:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4">
          <PageTransition>
            <Suspense fallback={<PageLoader label="Loading dispatch form…" />}>
              <div className="max-w-7xl mx-auto w-full">
                <DynamicDispatchForm currentUser={currentUser} sourceType="CONTRACTOR" />
              </div>
            </Suspense>
          </PageTransition>
        </main>
      </div>
    </div>
  );
}

export default function ContractorDispatchPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading Contractor Dispatch Station…" className="min-h-screen" />}>
      <ContractorDispatchContent />
    </Suspense>
  );
}
