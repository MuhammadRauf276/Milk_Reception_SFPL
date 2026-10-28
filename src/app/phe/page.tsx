'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { ZmccMasterDataWorkspace, MasterDataTab } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { MotOperationsWorkspace, MotWorkspaceTab } from '@/frontend/modules/mot/MotOperationsWorkspace';
import { ZmccArrivalsWorkspace, MainTab as ArrivalsTab } from '@/frontend/modules/zmcc/arrivals/ZmccArrivalsWorkspace';
import { ZmccWeighingWorkspace } from '@/frontend/modules/zmcc/weighing/ZmccWeighingWorkspace';
import { ZmccExitWorkspace } from '@/frontend/modules/zmcc/exit/ZmccExitWorkspace';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { canActAs } from '@core/roles/hierarchy';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function PheContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser, loadingUser: loading } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!currentUser) {
      router.push('/login');
      return;
    }
    const isAuthorized = canActAs(currentUser.role, 'PHE_OPERATOR') || canActAs(currentUser.role, 'MDO');
    const isSystemScope =
      currentUser.role === 'SUPER_ADMIN' ||
      currentUser.role === 'DATA_EXECUTIVE' ||
      currentUser.role === 'HEAD_OF_MPD' ||
      currentUser.role === 'EXECUTIVE_MANAGEMENT';

    if (
      !isAuthorized ||
      (!isSystemScope &&
        (!currentUser.procurement_source_id ||
          !currentUser.procurement_source ||
          currentUser.procurement_source.is_active === false ||
          currentUser.procurement_source.source_type !== 'ZMCC'))
    ) {
      router.push('/workspace-unavailable');
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

  // Canonical query parameters
  const rawSection = searchParams?.get('section') || 'arrivals';
  const canDoMot = Boolean(
    currentUser?.role && (canActAs(currentUser.role, 'MDO') || canActAs(currentUser.role, 'PHE_OPERATOR'))
  );
  const isMdoOnly = currentUser?.role === 'MDO';
  const section =
    rawSection === 'suppliers' || (rawSection === 'mot' && canDoMot) || rawSection === 'weighing' || rawSection === 'exit'
      ? rawSection
      : 'arrivals';

  const rawView = searchParams?.get('view') || '';
  const zmccIdParam = searchParams?.get('zmccId') || searchParams?.get('zmcc_id') || searchParams?.get('sourceId') || '';

  const { resolvedArrivalsTab, resolvedMasterDataTab, resolvedMotTab } = useMemo(() => {
    if (section === 'suppliers') {
      const isShop = rawView === 'shop-details';
      const isApprovals = rawView === 'approvals';
      return {
        resolvedArrivalsTab: 'MC_ARRIVAL' as ArrivalsTab,
        resolvedMasterDataTab: (isApprovals ? 'APPROVALS' : isShop ? 'SHOPS' : 'LOCAL_SUPPLIERS') as MasterDataTab,
        resolvedMotTab: 'DISPATCH' as MotWorkspaceTab,
      };
    }

    if (section === 'mot') {
      let motTab: MotWorkspaceTab = 'DISPATCH';
      if (rawView === 'active') {
        motTab = 'ACTIVE_JOURNEYS';
      } else if (rawView === 'history') {
        motTab = 'JOURNEY_HISTORY';
      } else if (rawView === 'map') {
        motTab = 'JOURNEY_MAP';
      } else if (rawView === 'sms') {
        motTab = 'SMS_OUTBOX';
      } else if (rawView === 'approvals') {
        motTab = 'APPROVALS';
      } else if (rawView === 'profiles') {
        motTab = 'PROFILES';
      } else if (rawView === 'vehicles') {
        motTab = 'VEHICLES';
      }
      return {
        resolvedArrivalsTab: 'MC_ARRIVAL' as ArrivalsTab,
        resolvedMasterDataTab: 'LOCAL_SUPPLIERS' as MasterDataTab,
        resolvedMotTab: motTab,
      };
    }

    // Default: arrivals
    let arrTab: ArrivalsTab = 'MC_ARRIVAL';
    if (rawView === 'hc-arrival' || rawView === 'local-supplier-arrival') {
      arrTab = 'HC_ARRIVAL';
    } else if (rawView === 'inside') {
      arrTab = 'INSIDE_ZMCC';
    } else if (rawView === 'history') {
      arrTab = 'HISTORY';
    }
    return {
      resolvedArrivalsTab: arrTab,
      resolvedMasterDataTab: 'LOCAL_SUPPLIERS' as MasterDataTab,
      resolvedMotTab: 'DISPATCH' as MotWorkspaceTab,
    };
  }, [section, rawView]);

  if (loading) {
    return (
      <PageLoader label="Loading PHE Station…" className="min-h-screen" />
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header with Accessible Hamburger Trigger */}
      <Header
        currentUser={currentUser}
        title={currentUser.role === 'MDO' ? 'MDO Station' : 'PHE Station'}
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      {/* Hierarchical Navigation Drawer for ALL viewports */}
      <HierarchicalNavDrawer
        currentUser={currentUser}
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        triggerButtonRef={hamburgerButtonRef}
      />

      {/* Main Full-Width Responsive Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Center Content Pane with Full Canvas Width */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full space-y-4">
          <PageTransition>
            {section === 'arrivals' && (
              <ZmccArrivalsWorkspace
                currentUser={currentUser}
                activeTab={resolvedArrivalsTab}
                hideTabBar={false}
                onTabChange={(tab) => {
                  const map: Record<string, string> = {
                    MC_ARRIVAL: 'mot-arrival', // view ids stay as in roleNavConfig (nav highlight)
                    HC_ARRIVAL: 'local-supplier-arrival',
                    INSIDE_ZMCC: 'inside',
                    HISTORY: 'history',
                  };
                  const extra = zmccIdParam ? `&zmccId=${encodeURIComponent(zmccIdParam)}` : '';
                  router.push(`/phe?section=arrivals&view=${map[tab] || 'mot-arrival'}${extra}`);
                }}
              />
            )}

            {section === 'weighing' && <ZmccWeighingWorkspace />}

            {section === 'exit' && !isMdoOnly && <ZmccExitWorkspace />}
            {section === 'exit' && isMdoOnly && (
              <div className="bg-card border border-border rounded-xl p-6 text-center space-y-3">
                <p className="text-sm font-semibold text-foreground">Vehicle exit is done by the PHE Operator.</p>
                <button
                  type="button"
                  onClick={() => router.push('/phe?section=arrivals&view=history')}
                  className="min-h-11 px-4 rounded-xl bg-primary text-white text-xs font-semibold"
                >
                  Arrival history
                </button>
              </div>
            )}

            {section === 'suppliers' && (
              <ZmccMasterDataWorkspace
                currentUser={currentUser}
                activeTab={resolvedMasterDataTab}
                hideTabBar={false}
                onTabChange={(tab) => {
                  const map: Record<string, string> = {
                    LOCAL_SUPPLIERS: 'local-suppliers',
                    SHOPS: 'shop-details',
                    APPROVALS: 'approvals',
                  };
                  const extra = zmccIdParam ? `&zmccId=${encodeURIComponent(zmccIdParam)}` : '';
                  router.push(`/phe?section=suppliers&view=${map[tab] || 'local-suppliers'}${extra}`);
                }}
              />
            )}

            {section === 'mot' && (
              <MotOperationsWorkspace
                currentUser={currentUser}
                activeTab={resolvedMotTab}
                hideTabBar={false}
                onTabChange={(tab) => {
                  const map: Record<string, string> = {
                    DISPATCH: 'dispatch',
                    ACTIVE_JOURNEYS: 'active',
                    JOURNEY_HISTORY: 'history',
                    JOURNEY_MAP: 'map',
                    SMS_OUTBOX: 'sms',
                    APPROVALS: 'approvals',
                    PROFILES: 'profiles',
                    VEHICLES: 'vehicles',
                  };
                  const extra = zmccIdParam ? `&zmccId=${encodeURIComponent(zmccIdParam)}` : '';
                  router.push(`/phe?section=mot&view=${map[tab] || 'dispatch'}${extra}`);
                }}
              />
            )}
          </PageTransition>
        </main>
      </div>
    </div>
  );
}

export default function PhePage() {
  return (
    <Suspense fallback={<PageLoader label="Loading PHE Station…" className="min-h-screen" />}>
      <PheContent />
    </Suspense>
  );
}
