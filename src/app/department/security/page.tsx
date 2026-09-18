'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SecurityGatewayWorkspace, SecurityTab } from '@modules/dashboard/SecurityGatewayWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';

function SecurityDepartmentContent() {
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

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'WAITING_ENTRY';
  const resolvedTab: SecurityTab =
    tabParam === 'INSIDE_PLANT' || tabParam === 'READY_EXIT'
      ? (tabParam as SecurityTab)
      : 'WAITING_ENTRY';

  const subpageTitle = useMemo(() => {
    if (resolvedTab === 'INSIDE_PLANT') return 'Inside Plant';
    if (resolvedTab === 'READY_EXIT') return 'Ready for Exit';
    return 'Waiting for Entry';
  }, [resolvedTab]);

  if (loading) {
    return (
      <div className="p-8 text-center text-xs font-bold text-slate-500">
        Loading Security Gate...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Security Gate"
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
          <span>Security Gate</span>
          <span className="text-slate-300">/</span>
          <span>Security Gate</span>
          <span className="text-slate-300">/</span>
          <span className="text-[#1E3A8A] font-black">{subpageTitle}</span>
        </nav>
        <span className="text-[11px] font-mono text-slate-400">
          Plant Gateway
        </span>
      </div>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <SecurityGatewayWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/security?tab=${tab}`);
          }}
        />
      </main>
    </div>
  );
}

export default function SecurityDepartmentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading Security Gate...</div>}>
      <SecurityDepartmentContent />
    </Suspense>
  );
}
