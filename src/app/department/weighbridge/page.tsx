'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WeighbridgeWorkspace, WeighbridgeTab } from '@modules/dashboard/WeighbridgeWorkspace';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';
import { can } from '@/backend/modules/access-control/policy';
import { createAccessActor } from '@/backend/modules/access-control/rolePolicies';
import { resolveRoleHome } from '@/lib/role-routing';

const WEIGHBRIDGE_SCOPE = {
  kind: 'DEPARTMENT',
  departmentId: 'Production & Weighbridge',
} as const;

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

  const hasAccess = useMemo(() => {
    if (!user) return false;
    const actor = createAccessActor(user);
    return actor ? can(actor, 'SUBMIT', WEIGHBRIDGE_SCOPE) : false;
  }, [user]);

  useEffect(() => {
    if (loading || hasAccess) return;
    router.replace(user ? resolveRoleHome(user.role) : '/login');
  }, [hasAccess, loading, router, user]);

  if (loading || !hasAccess) {
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
