'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlantContractorManagerWorkspace } from '@modules/dashboard/PlantContractorManagerWorkspace';
import { PlantContractorTab } from '@modules/dashboard/contractor/contractorManagerTypes';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { ShieldAlert, Building2 } from 'lucide-react';

import { canActAs } from '@/backend/core/roles/hierarchy';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function PlantContractorManagerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser: user, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (!canActAs(user.role, 'CONTRACTOR_MANAGER')) {
      router.push('/workspace-unavailable');
    }
  }, [loading, user, router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const rawTab = searchParams?.get('tab')?.toUpperCase();
  const isApprovals = rawTab === 'APPROVALS' || !rawTab;
  const resolvedTab: PlantContractorTab =
    rawTab === 'LIVE' || rawTab === 'QUALITY' || rawTab === 'RECEIPTS' || rawTab === 'HISTORY'
      ? (rawTab as PlantContractorTab)
      : 'OVERVIEW';

  const subpageTitle = useMemo(() => {
    if (isApprovals) return 'Approval Inbox';
    switch (resolvedTab) {
      case 'LIVE':
        return 'Pipeline';
      case 'QUALITY':
        return 'Quality';
      case 'RECEIPTS':
        return 'Receipts';
      case 'HISTORY':
        return 'History';
      case 'OVERVIEW':
      default:
        return 'Overview';
    }
  }, [isApprovals, resolvedTab]);

  if (loading) {
    return (
      <PageLoader label="Loading manager view…" className="min-h-dvh" />
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col w-full max-w-full overflow-x-clip">
      <Header
        currentUser={user}
        title={subpageTitle}
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

      <main className="flex-1 w-full min-w-0 max-w-[100rem] mx-auto flex flex-col p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-6">
        <PageTransition>

          {isApprovals ? (
            <ApprovalInbox
              currentUser={user}
              fixedStage="STAGE_3"
              sourceType="CONTRACTOR"
              onCountChange={(c) => setPendingCount(c.stage3)}
            />
          ) : (
            <PlantContractorManagerWorkspace
              currentUser={user}
              activeTab={resolvedTab}
              onTabChange={(tab) => {
                router.push(`/contractor/manager?tab=${tab}`);
              }}
            />
          )}
        </PageTransition>
      </main>
    </div>
  );
}

export default function PlantContractorManagerPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading manager view…" className="min-h-dvh" />
      }
    >
      <PlantContractorManagerContent />
    </Suspense>
  );
}
