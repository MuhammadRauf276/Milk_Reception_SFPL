'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Header } from '@modules/shared/Header';
import { HierarchicalNavDrawer } from '@modules/shared/navigation/HierarchicalNavDrawer';
import { User } from '@core/types';
import { PageLoader } from '@/components/ui/spinner';
import { PageTransition } from '@/components/motion/page-transition';
import { UnifiedStagePoliciesRulesWorkspace } from '@/frontend/modules/super-admin/UnifiedStagePoliciesRulesWorkspace';

export default function QAHeadDepartmentPage() {
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

  if (loading) {
    return <PageLoader />;
  }

  const isEditor = ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'DATA_ANALYST'].includes(user?.role || '');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header
        currentUser={user}
        showMenuButton
        onMenuClick={() => setIsDrawerOpen((prev) => !prev)}
        menuButtonRef={hamburgerButtonRef}
      />
      <HierarchicalNavDrawer
        currentUser={user}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />

      <PageTransition>
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <UnifiedStagePoliciesRulesWorkspace
            currentUser={user}
            defaultTestingPoint="PLANT_QA"
            forceReadOnly={!isEditor}
          />
        </main>
      </PageTransition>
    </div>
  );
}
