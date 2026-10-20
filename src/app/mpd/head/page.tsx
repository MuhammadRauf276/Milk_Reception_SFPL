'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { MpdExecutiveWorkspace } from '@/frontend/modules/mpd/MpdExecutiveWorkspace';
import { RejectedMilkRemarksQueue } from '@/frontend/modules/mpd/RejectedMilkRemarksQueue';
import { ApprovalInbox } from '@/frontend/modules/approvals/ApprovalInbox';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { ShieldAlert, LayoutDashboard } from 'lucide-react';

function HeadOfMpdContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (res.ok && data.user) {
          const role = data.user.role;
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
          if (allowed.includes(role)) {
            setCurrentUser(data.user);
            setIsAuthorized(true);
          } else {
            router.push('/workspace-unavailable');
          }
        } else {
          router.push('/login');
        }
      } catch (_err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  const rawTab = searchParams?.get('tab')?.toUpperCase();
  const isApprovals = rawTab === 'APPROVALS' || !rawTab;

  if (loading) {
    return (
      <PageLoader label="Verifying Authorization…" className="min-h-screen" />
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title={isApprovals ? 'Universal Approval Inbox' : 'MPD Head Command Center'}
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
          {/* Top-Level Mode Tabs */}
          <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-xl border border-border shadow-2xs mb-6">
            <button
              type="button"
              onClick={() => router.push('/mpd/head?tab=APPROVALS')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                isApprovals
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Universal Approval Inbox</span>
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
              onClick={() => router.push('/mpd/head?tab=COMMAND')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                !isApprovals
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Fleet Radar & Command Center</span>
            </button>
          </div>

          {isApprovals ? (
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
