'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { MpdExecutiveWorkspace } from '@/frontend/modules/mpd/MpdExecutiveWorkspace';

function HeadOfMpdContent() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#FDFBF9] text-[#111311] font-mono text-xs font-bold">
        Verifying Authorization...
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      <Header
        currentUser={currentUser}
        title="MPD Head Command Center"
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
        <MpdExecutiveWorkspace currentUser={currentUser} />
      </main>
    </div>
  );
}

export default function HeadOfMpdPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[#FDFBF9] text-[#111311] font-mono text-xs font-bold">
          Loading Overview...
        </div>
      }
    >
      <HeadOfMpdContent />
    </Suspense>
  );
}
