'use client';

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { Tv, Truck, LogIn } from 'lucide-react';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { SuperAdminSidebar } from '@/frontend/modules/super-admin/SuperAdminSidebar';
import { User } from '@core/types';
import Link from 'next/link';
import { PageTransition } from '@/components/motion/page-transition';
import { ShakarganjLogo, ShakarganjIcon } from '@/components/brand/ShakarganjLogo';

function subscribeToClock(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}

/** Minutes since the epoch, updated on the minute; null while server rendering/hydrating. */
function useCurrentMinute(): number | null {
  return useSyncExternalStore(
    subscribeToClock,
    () => Math.floor(Date.now() / 60000),
    () => null
  );
}

export default function PublicYardTVBoardPage() {
  const [activeVehicles, setActiveVehicles] = useState<
    Array<{ visitId: string; vehicleNumber: string; stage: string }>
  >([]);
  const currentMinute = useCurrentMinute();
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

  const fetchLogs = useCallback(
    () =>
      fetch('/api/tv-board')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setActiveVehicles(data.vehicles || []);
          }
        })
        .catch(() => {
          // Handled
        }),
    []
  );

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => {
      fetchLogs();
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
    <div className="min-h-screen bg-background text-foreground flex flex-col w-full max-w-full overflow-x-hidden">
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
        <header className="w-full max-w-full flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border bg-card text-foreground shadow-2xs shrink-0">
          <div className="flex items-center space-x-3">
            <ShakarganjIcon className="h-10 w-10 sm:h-11 sm:w-11" />
            <div className="flex flex-col items-start justify-center">
              <ShakarganjLogo className="h-8 sm:h-9 w-auto text-primary" />
              <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block mt-0.5">
                Physical Plant Queue Display
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Link
              href="/login"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-border-strong bg-subtle hover:bg-muted text-xs font-semibold text-primary transition shadow-2xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Operator Login</span>
            </Link>
          </div>
        </header>
      )}

      <main className="flex-1 p-4 sm:p-6 flex flex-col justify-between max-w-7xl w-full mx-auto">
        <PageTransition>
        <div>
          <div className="bg-white border border-border rounded-xl p-4 sm:p-5 shadow-2xs mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="p-2.5 bg-primary text-white rounded-xl shadow-2xs shrink-0">
                <Tv className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                  Yard status board
                </h1>
              </div>
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              <div className="px-3.5 py-1.5 rounded-xl bg-muted border border-border tabular-nums text-xs sm:text-sm font-semibold text-foreground">
                {currentMinute === null
                  ? '—'
                  : new Date(currentMinute * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeVehicles.length === 0 ? (
              <div className="col-span-full p-16 text-center border-2 border-dashed border-border rounded-xl bg-white text-muted-foreground text-sm shadow-2xs">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-muted text-slate-400 flex items-center justify-center">
                  <Truck className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-foreground">No Active Milk Tankers</p>
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
                    className={`p-5 rounded-xl border transition-all flex flex-col justify-between space-y-4 shadow-2xs ${
                      isNext
                        ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/30 shadow-md'
                        : isRejected
                        ? 'bg-rose-50/70 border-rose-300'
                        : 'bg-white border-border hover:border-border-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold tabular-nums tracking-wider shadow-2xs ${
                          isNext
                            ? 'bg-primary text-white animate-bounce'
                            : isRejected
                            ? 'bg-rose-600 text-white'
                            : 'bg-muted text-slate-700 border border-border'
                        }`}
                      >
                        {isNext ? 'NEXT IN LINE' : isRejected ? 'STOPPED' : `POSITION #${idx + 1}`}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 tabular-nums uppercase bg-subtle px-2 py-0.5 rounded border border-border">
                        IN PLANT
                      </span>
                    </div>

                    <div>
                      <h2 className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                        {vehicle.vehicleNumber}
                      </h2>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border text-xs font-semibold">
                      <span className="text-slate-500 tabular-nums">Station:</span>
                      <span
                        className={`px-2.5 py-1 rounded-lg uppercase tracking-wider text-[11px] font-semibold border ${
                          vehicle.stage === 'AWAITING_PLANT_ENTRY'
                            ? 'bg-blue-100/70 text-primary border-blue-200'
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

        <div className="mt-8 pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between text-xs font-semibold text-slate-500 gap-2">
          <span>Automatic Sync Interval: 60s</span>
        </div>
        </PageTransition>
      </main>
    </div>
  );
}
