'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { Sidebar } from '@modules/shared/Sidebar';
import { ZmccMasterDataWorkspace } from '@/frontend/modules/zmcc/ZmccMasterDataWorkspace';
import { MotOperationsWorkspace } from '@/frontend/modules/mot/MotOperationsWorkspace';
import { Store, Truck } from 'lucide-react';

export default function PhePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pheTab, setPheTab] = useState<'SHOPS' | 'MOT'>('SHOPS');
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
          if (
            user.role !== 'PHE_OPERATOR' ||
            user.is_active === false ||
            !user.procurement_source_id ||
            !user.procurement_source ||
            user.procurement_source.is_active === false ||
            user.procurement_source.source_type !== 'ZMCC'
          ) {
            router.push('/workspace-unavailable');
            return;
          }
          setCurrentUser(user);
        } else {
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to load PHE user', err);
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
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading PHE Station...
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Header with Hamburger Trigger */}
      <Header
        currentUser={currentUser}
        title="PHE Station"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      {/* Main Responsive Body with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar (hidden on mobile, visible lg+) */}
        <aside className="hidden lg:block w-72 bg-white border-r border-[#EAE4D5] shrink-0 overflow-y-auto p-4">
          <Sidebar currentUser={currentUser} activeCount={0} />
        </aside>

        {/* Mobile Navigation Drawer */}
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

        {/* Center Content Pane */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full space-y-4">
          <div className="flex items-center space-x-2 bg-white p-2 rounded-2xl border border-[#EAE4D5] shadow-xs w-fit">
            <button
              type="button"
              onClick={() => setPheTab('SHOPS')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
                pheTab === 'SHOPS'
                  ? 'bg-[#1E3A8A] text-white shadow-xs'
                  : 'bg-transparent text-slate-700 hover:bg-[#F4F0E6]'
              }`}
            >
              <Store className="w-4 h-4" />
              <span>Shop Details Management</span>
            </button>
            <button
              type="button"
              onClick={() => setPheTab('MOT')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
                pheTab === 'MOT'
                  ? 'bg-[#1E3A8A] text-white shadow-xs'
                  : 'bg-transparent text-slate-700 hover:bg-[#F4F0E6]'
              }`}
            >
              <Truck className="w-4 h-4" />
              <span>MOT Dispatch & Journeys</span>
            </button>
          </div>

          {pheTab === 'SHOPS' ? (
            <ZmccMasterDataWorkspace currentUser={currentUser} initialTab="SHOPS" />
          ) : (
            <MotOperationsWorkspace currentUser={currentUser} />
          )}
        </main>
      </div>
    </div>
  );
}
