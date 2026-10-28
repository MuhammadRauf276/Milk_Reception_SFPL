'use client';

import React, { useRef, useCallback, useSyncExternalStore, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { Tv, LogIn, CheckCircle2, Scale, Building2, FlaskConical } from 'lucide-react';
import { Header } from '@/frontend/modules/shared/Header';
import { HierarchicalNavDrawer } from '@/frontend/modules/shared/navigation/HierarchicalNavDrawer';
import { SuperAdminSidebar } from '@/frontend/modules/super-admin/SuperAdminSidebar';
import { InfoTip } from '@/components/ui/info-tip';
import Link from 'next/link';
import { PageTransition } from '@/components/motion/page-transition';
import { ShakarganjLogo, ShakarganjIcon } from '@/components/brand/ShakarganjLogo';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

function subscribeToClock(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}

function useCurrentMinute(): number | null {
  return useSyncExternalStore(
    subscribeToClock,
    () => Math.floor(Date.now() / 60000),
    () => null
  );
}

const NO_VEHICLES: Array<{ visitId: string; vehicleNumber: string; stage: string }> = [];

export default function PublicYardTVBoardPage() {
  const boardQuery = useQuery({
    queryKey: ['tv-board'],
    queryFn: ({ signal }) =>
      fetchJson<{ vehicles?: Array<{ visitId: string; vehicleNumber: string; stage: string }> }>('/api/tv-board', { signal }),
    refetchInterval: 60_000,
  });
  const activeVehicles = boardQuery.data?.vehicles ?? NO_VEHICLES;
  const currentMinute = useCurrentMinute();
  const { currentUser: user } = useCurrentUser();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

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
                Plant Yard Display
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Link
              href="/login"
              className="flex items-center space-x-1.5 min-h-11 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-primary transition shadow-2xs"
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
            <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-2xs mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-primary text-white rounded-xl shadow-2xs shrink-0">
                  <Tv className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                    Yard Status Board
                  </h1>
                  <InfoTip text="Live industrial plant yard and tanker queue display." />
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
                <div className="col-span-full space-y-4">
                  <div className="p-10 text-center border border-border rounded-xl bg-card text-muted-foreground shadow-2xs">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <h2 className="text-base font-bold text-foreground">Yard All Clear</h2>
                    <p className="text-xs text-muted-foreground mt-1">No tankers waiting</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Scale className="w-5 h-5 text-primary" />
                        <div>
                          <span className="block text-[10px] text-muted-foreground uppercase font-semibold">Station 1</span>
                          <span className="text-xs font-bold text-foreground">Weighbridge Scale</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        Ready
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Building2 className="w-5 h-5 text-primary" />
                        <div>
                          <span className="block text-[10px] text-muted-foreground uppercase font-semibold">Station 2</span>
                          <span className="text-xs font-bold text-foreground">Unloading Bays</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        Ready
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-border bg-card flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FlaskConical className="w-5 h-5 text-primary" />
                        <div>
                          <span className="block text-[10px] text-muted-foreground uppercase font-semibold">Station 3</span>
                          <span className="text-xs font-bold text-foreground">QA Laboratory</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        Active
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                activeVehicles.map((vehicle, idx) => {
                  const isNext = idx === 0;
                  const isRejected = vehicle.stage === 'REJECTED_OR_EXITING';

                  return (
                    <div
                      key={`tv-vehicle-${vehicle.visitId}`}
                      className={`p-5 rounded-xl border transition-all flex flex-col justify-between space-y-4 shadow-2xs bg-card ${
                        isNext
                          ? 'border-primary ring-1 ring-primary/40'
                          : isRejected
                          ? 'border-rose-300'
                          : 'border-border hover:border-border-strong'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`px-2.5 py-0.5 rounded-md text-xs font-semibold tabular-nums ${
                            isNext
                              ? 'bg-primary text-white'
                              : isRejected
                              ? 'bg-rose-600 text-white'
                              : 'bg-muted text-foreground border border-border'
                          }`}
                        >
                          {isNext ? 'Next In Line' : isRejected ? 'Rejected' : `Position #${idx + 1}`}
                        </span>
                        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums uppercase bg-muted px-2 py-0.5 rounded border border-border">
                          In Plant
                        </span>
                      </div>

                      <div>
                        <h2 className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
                          {vehicle.vehicleNumber}
                        </h2>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-border text-xs font-semibold">
                        <span className="text-muted-foreground">Station:</span>
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-muted text-foreground border border-border">
                          {vehicle.stage.replaceAll('_', ' ').toLowerCase()}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-border flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Sync: 60s</span>
            <span>Plant Intake Active</span>
          </div>
        </PageTransition>
      </main>
    </div>
  );
}
