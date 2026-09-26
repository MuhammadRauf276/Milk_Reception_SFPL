'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlantContractorManagerWorkspace } from '@modules/dashboard/PlantContractorManagerWorkspace';
import { PlantContractorTab } from '@modules/dashboard/contractor/contractorManagerTypes';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';

function PlantContractorManagerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
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

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'OVERVIEW';
  const resolvedTab: PlantContractorTab =
    tabParam === 'LIVE' || tabParam === 'QUALITY' || tabParam === 'RECEIPTS' || tabParam === 'HISTORY'
      ? (tabParam as PlantContractorTab)
      : 'OVERVIEW';

  const subpageTitle = useMemo(() => {
    switch (resolvedTab) {
      case 'LIVE':
        return 'Live Pipeline';
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
  }, [resolvedTab]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading Plant Contractor Manager Station...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Plant Contractor"
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

      <main className="flex-1 overflow-y-auto w-full max-w-full flex flex-col">
        <PlantContractorManagerWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/contractor/manager?tab=${tab}`);
          }}
        />
      </main>
    </div>
  );
}

export default function PlantContractorManagerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FDFBF9] text-xs font-bold text-slate-400">
          Loading Plant Contractor Manager Station...
        </div>
      }
    >
      <PlantContractorManagerContent />
    </Suspense>
  );
}
