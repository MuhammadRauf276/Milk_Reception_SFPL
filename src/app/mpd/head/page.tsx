'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { MilkTestPolicyWorkspace } from '@/frontend/modules/mpd/policy/MilkTestPolicyWorkspace';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';

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
          if (role === 'HEAD_OF_MPD' || role === 'SUPER_ADMIN') {
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
        Verifying Head of MPD Authorization...
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
        title="Head of MPD"
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

      {/* Compact Breadcrumb Header */}
      <div className="bg-white border-b border-[#EAE4D5] px-4 sm:px-6 py-2 shrink-0 shadow-xs flex items-center justify-between">
        <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-xs font-bold text-slate-500">
          <span>Head of MPD</span>
          <span className="text-slate-300">/</span>
          <span className="text-[#1E3A8A] font-black">Head of MPD Station</span>
        </nav>
        <span className="text-[11px] font-mono text-slate-400">
          Policy Management
        </span>
      </div>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full">
        <MilkTestPolicyWorkspace currentUser={currentUser} />
      </main>
    </div>
  );
}

export default function HeadOfMpdPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[#FDFBF9] text-[#111311] font-mono text-xs font-bold">
          Loading Head of MPD...
        </div>
      }
    >
      <HeadOfMpdContent />
    </Suspense>
  );
}
