'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function QAHeadDepartmentPage() {
  const router = useRouter();
  const { currentUser: user, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (!canActAs(user.role, 'QA_HEAD')) {
      router.push('/workspace-unavailable');
    }
  }, [loading, user, router]);

  if (loading) {
    return <PageLoader label="Loading AVP-QA Workspace…" className="min-h-[100dvh]" />;
  }

  if (!user) return null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="QA Head"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={() => setIsDrawerOpen(true)}
        menuButtonRef={hamburgerButtonRef}
      />

      <HierarchicalNavDrawer
        currentUser={user}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        triggerButtonRef={hamburgerButtonRef}
      />

      <main className="flex-1 w-full min-w-0 max-w-7xl mx-auto p-3 sm:p-6 lg:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-6">
        <PageTransition>
          <ApprovalInbox
            currentUser={user}
            fixedStage="STAGE_4"
          />
        </PageTransition>
      </main>
    </div>
  );
}
