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

function PlantContractorManagerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (err) {
        console.error('Failed to load user', err);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

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
        return 'Quality & Rejections';
      case 'RECEIPTS':
        return 'Receipts & Reconciliation';
      case 'HISTORY':
        return 'History & Reports';
      case 'OVERVIEW':
      default:
        return 'Overview';
    }
  }, [isApprovals, resolvedTab]);

  if (loading) {
    return (
      <PageLoader label="Loading Plant Contractor Manager Station…" className="min-h-screen" />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
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

      <main className="flex-1 overflow-y-auto w-full max-w-full flex flex-col p-3 sm:p-6 space-y-6">
        <PageTransition>
          {/* Top-Level Mode Tabs */}
          <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-xl border border-border shadow-2xs">
            <button
              type="button"
              onClick={() => router.push('/contractor/manager?tab=APPROVALS')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                isApprovals
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Approval Inbox</span>
              {pendingCount !== null && pendingCount > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    isApprovals ? 'bg-white text-amber-700' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => router.push('/contractor/manager?tab=OVERVIEW')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                !isApprovals
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Contractor Operations</span>
            </button>
          </div>

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
        <PageLoader label="Loading Plant Contractor Manager Station…" className="min-h-screen" />
      }
    >
      <PlantContractorManagerContent />
    </Suspense>
  );
}
