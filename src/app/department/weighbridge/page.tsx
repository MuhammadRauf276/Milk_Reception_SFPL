'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WeighbridgeWorkspace, WeighbridgeTab } from '@modules/dashboard/WeighbridgeWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';

function WeighbridgeDepartmentContent() {
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

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'FIRST_WEIGHT';
  const resolvedTab: WeighbridgeTab =
    tabParam === 'SECOND_WEIGHT' ? 'SECOND_WEIGHT' : 'FIRST_WEIGHT';

  const subpageTitle = useMemo(() => {
    if (resolvedTab === 'SECOND_WEIGHT') return 'Second Weight (Tare)';
    return 'First Weight (Gross)';
  }, [resolvedTab]);

  if (loading) {
    return (
      <div className="p-8 text-center text-xs font-bold text-slate-500">
        Loading Weighbridge Workstation...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Weighbridge"
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

      {/* Compact Breadcrumb Header */}
      <div className="bg-white border-b border-[#EAE4D5] px-4 sm:px-6 py-2 shrink-0 shadow-xs flex items-center justify-between">
        <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-xs font-bold text-slate-500">
          <span>Weighbridge</span>
          <span className="text-slate-300">/</span>
          <span>Weighbridge Station</span>
          <span className="text-slate-300">/</span>
          <span className="text-[#1E3A8A] font-black">{subpageTitle}</span>
        </nav>
        <span className="text-[11px] font-mono text-slate-400">
          Gross & Tare Scales
        </span>
      </div>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <WeighbridgeWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/weighbridge?tab=${tab}`);
          }}
        />
      </main>
    </div>
  );
}

export default function WeighbridgeDepartmentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FDFBF9] text-xs font-bold text-slate-400">
          Loading Weighbridge Workstation...
        </div>
      }
    >
      <WeighbridgeDepartmentContent />
    </Suspense>
  );
}
