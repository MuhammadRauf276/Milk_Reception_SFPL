'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { QALaboratoryWorkspace, QATab } from '@modules/dashboard/QALaboratoryWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';

function QADepartmentContent() {
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

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'WAITING';
  const resolvedTab: QATab =
    tabParam === 'IN_TESTING' || tabParam === 'ON_HOLD'
      ? (tabParam as QATab)
      : 'WAITING';

  const subpageTitle = useMemo(() => {
    if (resolvedTab === 'IN_TESTING') return 'In Testing';
    if (resolvedTab === 'ON_HOLD') return 'On Hold';
    return 'Waiting for Testing';
  }, [resolvedTab]);

  if (loading) {
    return (
      <div className="p-8 text-center text-xs font-bold text-slate-500">
        Loading QA Laboratory...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="QA Laboratory"
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
          <span>QA Laboratory</span>
          <span className="text-slate-300">/</span>
          <span>QA Testing Laboratory</span>
          <span className="text-slate-300">/</span>
          <span className="text-[#1E3A8A] font-black">{subpageTitle}</span>
        </nav>
        <span className="text-[11px] font-mono text-slate-400">
          Plant QA Workstation
        </span>
      </div>

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <QALaboratoryWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/qa?tab=${tab}`);
          }}
        />
      </main>
    </div>
  );
}

export default function QADepartmentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FDFBF9] text-xs font-bold text-slate-400">
          Loading QA Laboratory...
        </div>
      }
    >
      <QADepartmentContent />
    </Suspense>
  );
}
