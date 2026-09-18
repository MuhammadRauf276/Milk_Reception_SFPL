'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { ZmccMasterDataWorkspace, MasterDataTab } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { MotOperationsWorkspace, MotWorkspaceTab } from '@/frontend/modules/mot/MotOperationsWorkspace';
import { ZmccArrivalsWorkspace, MainTab as ArrivalsTab } from '@/frontend/modules/zmcc/arrivals/ZmccArrivalsWorkspace';

function PheContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (!data.user) {
            router.push('/login');
            return;
          }
          const user = data.user;
          if (
            user.role !== 'PHE_OPERATOR' ||
            user.is_active === false ||
            !user.procurement_source_id ||
            !user.procurement_source ||
            user.procurement_source.is_active === false ||
            user.procurement_source.source_type !== 'ZMCC'
          ) {
            router.push('/workspace-unavailable');
            return;
          }
          setCurrentUser(user);
        } else {
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load PHE user', err);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [router]);

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
  const section = rawSection === 'suppliers' || rawSection === 'mot' ? rawSection : 'arrivals';

  const rawView = searchParams?.get('view') || '';

  const { resolvedArrivalsTab, resolvedMasterDataTab, resolvedMotTab, sectionTitle, viewTitle } = useMemo(() => {
    if (section === 'suppliers') {
      const isShop = rawView === 'shop-details';
      return {
        resolvedArrivalsTab: 'MOT_ARRIVAL' as ArrivalsTab,
        resolvedMasterDataTab: (isShop ? 'SHOPS' : 'LOCAL_SUPPLIERS') as MasterDataTab,
        resolvedMotTab: 'DISPATCH' as MotWorkspaceTab,
        sectionTitle: 'Local Suppliers / Shop Details',
        viewTitle: isShop ? 'Shop Details (Reference)' : 'Local Suppliers',
      };
    }

    if (section === 'mot') {
      let motTab: MotWorkspaceTab = 'DISPATCH';
      let title = 'Assign & Dispatch';
      if (rawView === 'active') {
        motTab = 'ACTIVE_JOURNEYS';
        title = 'Active Journeys';
      } else if (rawView === 'history') {
        motTab = 'JOURNEY_HISTORY';
        title = 'Journey History';
      } else if (rawView === 'map') {
        motTab = 'JOURNEY_MAP';
        title = 'Live Journey Map';
      } else if (rawView === 'sms') {
        motTab = 'SMS_OUTBOX';
        title = 'SMS Outbox';
      }
      return {
        resolvedArrivalsTab: 'MOT_ARRIVAL' as ArrivalsTab,
        resolvedMasterDataTab: 'LOCAL_SUPPLIERS' as MasterDataTab,
        resolvedMotTab: motTab,
        sectionTitle: 'MOT Dispatch & Journeys',
        viewTitle: title,
      };
    }

    // Default: arrivals
    let arrTab: ArrivalsTab = 'MOT_ARRIVAL';
    let title = 'Record MOT Arrival';
    if (rawView === 'local-supplier-arrival') {
      arrTab = 'LOCAL_SUPPLIER_ARRIVAL';
      title = 'Record Local Supplier Arrival';
    } else if (rawView === 'inside') {
      arrTab = 'INSIDE_ZMCC';
      title = 'Vehicles Inside ZMCC';
    } else if (rawView === 'history') {
      arrTab = 'HISTORY';
      title = 'Arrival History & Corrections';
    }
    return {
      resolvedArrivalsTab: arrTab,
      resolvedMasterDataTab: 'LOCAL_SUPPLIERS' as MasterDataTab,
      resolvedMotTab: 'DISPATCH' as MotWorkspaceTab,
      sectionTitle: 'Arrivals & Tokens',
      viewTitle: title,
    };
  }, [section, rawView]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading PHE Station...
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Header with Accessible Hamburger Trigger */}
      <Header
        currentUser={currentUser}
        title="PHE Station"
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
        {/* Compact Breadcrumb Header */}
        <div className="bg-white border-b border-[#EAE4D5] px-4 sm:px-6 py-2 shrink-0 shadow-xs flex items-center justify-between">
          <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-xs font-bold text-slate-500">
            <span>PHE Station</span>
            <span className="text-slate-300">/</span>
            <span className="hidden sm:inline">{sectionTitle}</span>
            <span className="hidden sm:inline text-slate-300">/</span>
            <span className="text-[#1E3A8A] font-black">{viewTitle}</span>
          </nav>
          <span className="text-[11px] font-mono text-slate-400">
            {currentUser.procurement_source?.name || 'ZMCC'}
          </span>
        </div>

        {/* Center Content Pane with Full Canvas Width */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full space-y-4">
          {section === 'arrivals' && (
            <ZmccArrivalsWorkspace
              currentUser={currentUser}
              activeTab={resolvedArrivalsTab}
              hideTabBar={true}
              onTabChange={(tab) => {
                const map: Record<string, string> = {
                  MOT_ARRIVAL: 'mot-arrival',
                  LOCAL_SUPPLIER_ARRIVAL: 'local-supplier-arrival',
                  INSIDE_ZMCC: 'inside',
                  HISTORY: 'history',
                };
                router.push(`/phe?section=arrivals&view=${map[tab] || 'mot-arrival'}`);
              }}
            />
          )}

          {section === 'suppliers' && (
            <ZmccMasterDataWorkspace
              currentUser={currentUser}
              activeTab={resolvedMasterDataTab}
              hideTabBar={true}
              onTabChange={(tab) => {
                const map: Record<string, string> = {
                  LOCAL_SUPPLIERS: 'local-suppliers',
                  SHOPS: 'shop-details',
                };
                router.push(`/phe?section=suppliers&view=${map[tab] || 'local-suppliers'}`);
              }}
            />
          )}

          {section === 'mot' && (
            <MotOperationsWorkspace
              currentUser={currentUser}
              activeTab={resolvedMotTab}
              hideTabBar={true}
              onTabChange={(tab) => {
                const map: Record<string, string> = {
                  DISPATCH: 'dispatch',
                  ACTIVE_JOURNEYS: 'active',
                  JOURNEY_HISTORY: 'history',
                  JOURNEY_MAP: 'map',
                  SMS_OUTBOX: 'sms',
                };
                router.push(`/phe?section=mot&view=${map[tab] || 'dispatch'}`);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function PhePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">Loading PHE Station...</div>}>
      <PheContent />
    </Suspense>
  );
}
