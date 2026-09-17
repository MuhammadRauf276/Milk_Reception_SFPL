'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { Sidebar } from '@modules/shared/Sidebar';
import { MPDFieldWorkspace } from '@modules/dashboard/MPDFieldWorkspace';
import { RefreshCw } from 'lucide-react';

export default function ZmccDispatchPage() {
  const router = useRouter();
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
          const isSuperAdmin = user.role === 'SUPER_ADMIN';
          const isLabAttendant = user.role === 'ZMCC_LAB_ATTENDANT';

          if (!isSuperAdmin && !isLabAttendant) {
            router.push('/workspace-unavailable');
            return;
          }

          if (!isSuperAdmin) {
            if (
              user.is_active === false ||
              !user.procurement_source_id ||
              !user.procurement_source ||
              user.procurement_source.is_active === false ||
              user.procurement_source.source_type !== 'ZMCC'
            ) {
              router.push('/workspace-unavailable');
              return;
            }
          }

          setCurrentUser(user);
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

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-700" />
        Loading ZMCC Dispatch Station...
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  const assignedSourceName =
    currentUser.procurement_source?.name ||
    'Assigned ZMCC Source';

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      <Header
        currentUser={currentUser}
        sourceName={assignedSourceName}
        title="ZMCC Dispatch to Plant"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        isZmccVariant={true}
        menuButtonRef={hamburgerButtonRef}
      />

      <div className="flex-1 flex overflow-hidden">
        <aside className="hidden lg:block w-72 bg-white border-r border-[#EAE4D5] shrink-0 overflow-y-auto p-4">
          <Sidebar currentUser={currentUser} activeCount={0} />
        </aside>

        {isDrawerOpen && (
          <div
            className="fixed inset-0 z-50 flex lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
          >
            <div
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
              onClick={closeDrawer}
              aria-hidden="true"
            />
            <div className="relative z-50 w-72 max-w-[80vw] bg-white h-full p-4 overflow-y-auto shadow-2xl border-r border-[#EAE4D5]">
              <Sidebar
                currentUser={currentUser}
                activeCount={0}
                isMobileOpen={isDrawerOpen}
                onCloseMobile={closeDrawer}
              />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading dispatch workspace...</div>}>
            <MPDFieldWorkspace currentUser={currentUser} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
