'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { MpdExecutiveWorkspace } from '@/frontend/modules/mpd/MpdExecutiveWorkspace';
import { RejectedMilkRemarksQueue } from '@/frontend/modules/mpd/RejectedMilkRemarksQueue';
import { MpdSourcesWorkspace } from '@/frontend/modules/mpd/MpdSourcesWorkspace';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { ShieldAlert, LayoutDashboard, Milk } from 'lucide-react';

import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';
import { canActAs } from '@/backend/core/roles/hierarchy';

function HeadOfMpdContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const isAuthorized = React.useMemo(() => {
    if (!currentUser) return false;
    const role = currentUser.role;
    const allowed = [
      'HEAD_OF_MPD',
      'SUPER_ADMIN',
      'SYSTEM_ADMIN',
      'EXECUTIVE_MANAGEMENT',
      'DATA_EXECUTIVE',
      'DATA_ANALYST',
      'FINANCE_ACCOUNTS',
      'ADMIN_HEAD',
      'QA_HEAD',
      'PRODUCTION_HEAD',
      'ZMCC_MANAGER',
    ];
    return allowed.includes(role) || canActAs(role, 'HEAD_OF_MPD');
  }, [currentUser]);

  useEffect(() => {
    if (loading) return;
    if (!currentUser) {
      router.push('/login');
      return;
    }
    if (!isAuthorized) {
      router.push('/workspace-unavailable');
    }
  }, [loading, currentUser, isAuthorized, router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  const rawTab = searchParams?.get('tab')?.toUpperCase();
  const canManageSources = !!currentUser && ['HEAD_OF_MPD', 'SUPER_ADMIN', 'DATA_EXECUTIVE'].includes(currentUser.role);
  const currentTab =
    rawTab === 'COMMAND' ? 'COMMAND' : rawTab === 'SOURCES' && canManageSources ? 'SOURCES' : 'APPROVALS';

  if (loading) {
    return (
      <PageLoader label="Verifying Authorization…" className="min-h-screen" />
    );
  }

  if (!isAuthorized) {
    return null;
  }

  const headerTitle =
    currentTab === 'APPROVALS'
      ? 'Universal Approval Inbox'
      : currentTab === 'SOURCES'
      ? 'Milk Sources & Contractors'
      : 'MPD Head Command Center';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title={headerTitle}
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full">
        <PageTransition>
          {currentTab === 'APPROVALS' ? (
            <div className="space-y-6">
              <ApprovalInbox
                currentUser={currentUser}
                initialStage="ALL"
                onCountChange={(c) => setPendingCount(c.totalPending)}
              />
              {currentUser && ['HEAD_OF_MPD', 'SUPER_ADMIN', 'DATA_EXECUTIVE'].includes(currentUser.role) && (
                <div className="mt-8 border-t border-slate-200 pt-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-3">Rejected Milk Remarks Queue</h3>
                  <RejectedMilkRemarksQueue canWrite={currentUser.role !== 'DATA_EXECUTIVE'} />
                </div>
              )}
            </div>
          ) : currentTab === 'SOURCES' ? (
            <MpdSourcesWorkspace />
          ) : (
            <MpdExecutiveWorkspace currentUser={currentUser} />
          )}
        </PageTransition>
      </main>
    </div>
  );
}

export default function HeadOfMpdPage() {
  return (
    <Suspense
      fallback={
        <PageLoader label="Loading Overview…" className="min-h-screen" />
      }
    >
      <HeadOfMpdContent />
    </Suspense>
  );
}
