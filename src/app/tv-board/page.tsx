'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tv, Radio, Truck, LogIn } from 'lucide-react';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { SuperAdminSidebar } from '@/frontend/modules/super-admin/SuperAdminSidebar';
import { User } from '@core/types';
import Link from 'next/link';

export default function PublicYardTVBoardPage() {
  const [activeVehicles, setActiveVehicles] = useState<
    Array<{ visitId: string; vehicleNumber: string; stage: string }>
  >([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [user, setUser] = useState<User | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  // Fetch logged in user to provide full navbar/drawer navigation if authenticated
  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user || null);
        }
      } catch (_err) {
        // User not logged in (e.g. public yard monitor)
      }
    }
    loadUser();
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/tv-board');
      if (res.ok) {
        const data = await res.json();
        setActiveVehicles(data.vehicles || []);
      }
    } catch (_err) {
      // Handled
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => {
      fetchLogs();
      setCurrentTime(new Date());
    }, 60000); // 60s polling to prevent Database load
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  return (
    <div className="min-h-screen bg-[#FDFBF9] text-[#111311] flex flex-col font-sans w-full max-w-full overflow-x-hidden">
      {/* Top Navbar: Full Application Header when logged in, or Clean Broadcast Header when public */}
      {user ? (
        <>
          <Header
            currentUser={user}
            title="Yard Status Board"
            showBranding={true}
            showMenuButton={true}
            onMenuClick={openDrawer}
            menuButtonRef={hamburgerButtonRef}
          />
          {isSuperAdmin ? (
            <SuperAdminSidebar
              currentUser={user}
              isOpen={isDrawerOpen}
              onClose={closeDrawer}
              triggerRef={hamburgerButtonRef}
            />
          ) : (
            <HierarchicalNavDrawer
              currentUser={user}
              isOpen={isDrawerOpen}
              onClose={closeDrawer}
              triggerButtonRef={hamburgerButtonRef}
            />
          )}
        </>
      ) : (
        <header className="w-full max-w-full flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#EAE4D5] bg-[#FFFFFF] text-[#111311] shadow-xs shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-[#1E3A8A] rounded-xl text-white shadow-xs">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold text-sm sm:text-base leading-none block text-[#111311]">
                Shakarganj Food Products Ltd
              </span>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mt-0.5">
                Physical Plant Queue Display
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Link
              href="/login"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-[#C4B9A3] bg-[#FDFBF9] hover:bg-[#F4F0E6] text-xs font-bold text-[#1E3A8A] transition shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Operator Login</span>
            </Link>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 flex flex-col justify-between max-w-7xl w-full mx-auto">
        <div>
          {/* TV Sub-Header Banner */}
          <div className="bg-white border border-[#EAE4D5] rounded-2xl p-4 sm:p-5 shadow-xs mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-xs shrink-0">
                <Tv className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-black tracking-tight text-[#111311]">
                  PARKING YARD VEHICLE STATUS BOARD
                </h1>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                  Live Queue Positioning for Tanker Drivers & Plant Security
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-extrabold shadow-xs">
                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                <span>LIVE YARD FEED</span>
              </div>
              <div className="px-3.5 py-1.5 rounded-xl bg-[#F4F0E6] border border-[#EAE4D5] font-mono text-xs sm:text-sm font-black text-[#111311]">
                {currentTime.toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Vehicle Queue Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeVehicles.length === 0 ? (
              <div className="col-span-full p-16 text-center border-2 border-dashed border-[#C4B9A3] rounded-2xl bg-white text-slate-500 font-bold text-sm shadow-xs">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[#F4F0E6] text-slate-400 flex items-center justify-center">
                  <Truck className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-[#111311]">No Active Milk Tankers</p>
                <p className="text-xs text-slate-500 mt-1">
                  There are currently no vehicles waiting in the plant parking yard.
                </p>
              </div>
            ) : (
              activeVehicles.map((vehicle, idx) => {
                const isNext = idx === 0;
                const isRejected = vehicle.stage === 'REJECTED_OR_EXITING';

                return (
                  <div
                    key={`tv-vehicle-${vehicle.visitId}`}
                    className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 shadow-xs ${
                      isNext
                        ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/30 shadow-md'
                        : isRejected
                        ? 'bg-rose-50/70 border-rose-300'
                        : 'bg-white border-[#EAE4D5] hover:border-[#C4B9A3]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-black font-mono tracking-wider shadow-xs ${
                          isNext
                            ? 'bg-[#1E3A8A] text-white animate-bounce'
                            : isRejected
                            ? 'bg-rose-600 text-white'
                            : 'bg-[#F4F0E6] text-slate-700 border border-[#EAE4D5]'
                        }`}
                      >
                        {isNext ? 'NEXT IN LINE' : isRejected ? 'STOPPED' : `POSITION #${idx + 1}`}
                      </span>
                      <span className="text-[11px] font-extrabold text-slate-500 font-mono uppercase bg-[#FDFBF9] px-2 py-0.5 rounded border border-[#EAE4D5]">
                        IN PLANT
                      </span>
                    </div>

                    <div>
                      <h2 className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-[#111311]">
                        {vehicle.vehicleNumber}
                      </h2>
                      <p className="text-xs font-bold text-slate-500 truncate mt-1">
                        Current operational stage
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-[#EAE4D5] text-xs font-extrabold">
                      <span className="text-slate-500 font-mono">Station:</span>
                      <span
                        className={`px-2.5 py-1 rounded-lg uppercase tracking-wider text-[11px] font-black border ${
                          vehicle.stage === 'AWAITING_PLANT_ENTRY'
                            ? 'bg-blue-100/70 text-[#1E3A8A] border-blue-200'
                            : 'bg-amber-100/70 text-amber-900 border-amber-200'
                        }`}
                      >
                        {vehicle.stage.replaceAll('_', ' ')}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* TV Footer Notice */}
        <div className="mt-8 pt-4 border-t border-[#EAE4D5] flex flex-col sm:flex-row items-center justify-between text-xs font-bold text-slate-500 gap-2">
          <span>Public Yard Display Board • Protected Privacy Layout</span>
          <span>Automatic Sync Interval: 60s</span>
        </div>
      </main>
    </div>
  );
}
