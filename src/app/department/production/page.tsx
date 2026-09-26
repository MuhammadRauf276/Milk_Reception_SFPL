'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProductionUnloadingWorkspace, ProductionTab } from '@modules/dashboard/ProductionUnloadingWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';

function ProductionDepartmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          const roleStr = data.user?.role as string;
          const allowedRoles = ['PRODUCTION_RECEPTION_OPERATOR', 'PRODUCTION_HEAD', 'SUPER_ADMIN'];
          if (data.user && allowedRoles.includes(roleStr)) {
            setUser(data.user);
            setIsAuthorized(true);
          } else {
            router.push('/login');
          }
        } else {
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load user', err);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [router]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const tabParam = searchParams?.get('tab')?.toUpperCase() || 'READY';
  const resolvedTab: ProductionTab =
    tabParam === 'UNLOADING' || tabParam === 'SILO_ISSUE'
      ? (tabParam as ProductionTab)
      : 'READY';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading Production Workstation...
      </div>
    );
  }

  if (!isAuthorized || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={user}
        title="Production"
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

      <main className="flex-1 p-4 sm:p-6 overflow-y-auto w-full max-w-full">
        <ProductionUnloadingWorkspace
          currentUser={user}
          activeTab={resolvedTab}
          onTabChange={(tab) => {
            router.push(`/department/production?tab=${tab}`);
          }}
        />
      </main>
    </div>
  );
}

export default function ProductionDepartmentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#FDFBF9] text-xs font-bold text-slate-400">
          Loading Production Workstation...
        </div>
      }
    >
      <ProductionDepartmentContent />
    </Suspense>
  );
}
