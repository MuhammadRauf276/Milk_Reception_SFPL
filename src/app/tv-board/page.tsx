'use client';

import React, { useRef, useCallback, useSyncExternalStore, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { Tv, LogIn, CheckCircle2, Scale, Building2, FlaskConical, Clock } from 'lucide-react';
import { ManagerLifecycleTracker } from '@/frontend/modules/dashboard/zmcc/ManagerLifecycleTracker';
import type { ManagerLifecycleSummary } from '@/frontend/modules/dashboard/zmcc/zmccManagerTypes';
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

interface TvBoardVehicle {
  visitId: string;
  vehicleNumber: string;
  tokenNumber: string | null;
  sourceName: string;
  portionCount: number;
  dispatch13TsLiters: number | null;
  dispatchGrossLiters: number | null;
  dispatchQuantityValue: number | null;
  dispatchQuantityUnit: string | null;
  firstWeightKg: number | null;
  secondWeightKg: number | null;
  lifecycle: ManagerLifecycleSummary;
}

const NO_VEHICLES: TvBoardVehicle[] = [];

export default function PublicYardTVBoardPage() {
  const boardQuery = useQuery({
    queryKey: ['tv-board'],
    queryFn: ({ signal }) =>
      fetchJson<{ vehicles?: TvBoardVehicle[] }>('/api/tv-board', { signal }),
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
                    <p className="text-xs text-muted-foreground mt-1">No tankers dispatched to the plant</p>
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
                  const lc = vehicle.lifecycle;

                  return (
                    <div
                      key={`tv-vehicle-${vehicle.visitId}`}
                      className={`p-5 rounded-xl border transition-all flex flex-col justify-between space-y-3.5 shadow-2xs ${
                        isNext
                          ? 'bg-primary/5 border-primary ring-1 ring-primary'
                          : 'bg-card border-border/80 hover:border-primary/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums tracking-wide shadow-2xs ${
                              isNext ? 'bg-primary text-white' : 'bg-muted text-slate-700 border border-border'
                            }`}
                          >
                            {isNext ? 'NEXT IN LINE' : `POSITION #${idx + 1}`}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-600 tabular-nums uppercase bg-subtle px-2 py-0.5 rounded border border-border">
                            Visit #{vehicle.visitId}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 tabular-nums text-[10px] font-semibold text-emerald-800">
                          {vehicle.portionCount} Portion{vehicle.portionCount > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <h2 className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-foreground">
                            {vehicle.vehicleNumber}
                          </h2>
                          {lc.elapsedInPlant && (
                            <div className="flex items-center space-x-1 text-[11px] tabular-nums font-semibold text-slate-500">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{lc.elapsedInPlant}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-slate-500 font-semibold mt-0.5">
                          <span>Token: <strong className="text-foreground">{vehicle.tokenNumber || 'PENDING'}</strong></span>
                          <span>·</span>
                          <span className="truncate">Source: <strong className="text-foreground">{vehicle.sourceName}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-subtle/80 border border-border/60 text-xs">
                        <span className="text-slate-500 font-semibold text-[11px]">Station / Stage:</span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                          {lc.currentStageLabel}
                        </span>
                      </div>

                      <div className="py-1">
                        <ManagerLifecycleTracker lifecycle={lc} compact={true} />
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
