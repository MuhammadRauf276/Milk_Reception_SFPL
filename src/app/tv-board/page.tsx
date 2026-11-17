'use client';

import React, { useEffect, useRef, useCallback, useSyncExternalStore, useState } from 'react';
import { isZmccFieldOfficer } from '@core/roles/hierarchy';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query/fetchJson';
import { Tv, LogIn, CheckCircle2, Scale, Building2, FlaskConical, Clock, Truck } from 'lucide-react';
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
import { ZmccBoardSection } from '@/frontend/modules/tv-board/ZmccBoardSections';
import type { TvZmccBoard } from '@/backend/services/tvBoardZmccService';

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
const REFRESH_MS = 30_000;

const pakistanTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });

const STATIONS = [
  { icon: Scale, station: 'Station 1', name: 'Weighbridge', state: 'Ready' },
  { icon: Building2, station: 'Station 2', name: 'Unloading bays', state: 'Ready' },
  { icon: FlaskConical, station: 'Station 3', name: 'QA lab', state: 'Active' },
];

export default function PublicYardTVBoardPage() {
  const boardQuery = useQuery({
    queryKey: ['tv-board'],
    queryFn: ({ signal }) =>
      fetchJson<{ vehicles?: TvBoardVehicle[] }>('/api/tv-board', { signal }),
    refetchInterval: REFRESH_MS,
  });
  const activeVehicles = boardQuery.data?.vehicles ?? NO_VEHICLES;
  const currentMinute = useCurrentMinute();
  const { currentUser: user } = useCurrentUser();
  const zmccQuery = useQuery({
    queryKey: ['tv-board', 'zmcc'],
    queryFn: ({ signal }) => fetchJson<TvZmccBoard>('/api/tv-board/zmcc', { signal }),
    refetchInterval: REFRESH_MS,
    enabled: !!user,
    retry: false,
  });
  const zmccSections = zmccQuery.data?.zmccs ?? [];
  const updatedAt = Math.max(boardQuery.dataUpdatedAt, zmccQuery.dataUpdatedAt);
  // The wall display stays open without a login; these field roles have no use for it.
  const barredHome = user?.role === 'MOT' ? '/mot' : user && isZmccFieldOfficer(user.role) ? '/phe' : null;
  useEffect(() => {
    if (barredHome) window.location.replace(barredHome);
  }, [barredHome]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => hamburgerButtonRef.current?.focus(), 0);
  }, []);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  if (barredHome) return null;

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col w-full max-w-full overflow-x-clip">
      {user ? (
        <>
          <Header
            currentUser={user}
            title="Yard status"
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
              <span className="text-xs font-semibold text-muted-foreground block mt-0.5">
                Plant Yard Display
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Link
              href="/login"
              className="flex items-center space-x-1.5 min-h-11 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold text-primary transition shadow-2xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Operator login</span>
            </Link>
          </div>
        </header>
      )}

      <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
        <PageTransition>
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-2xs flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-primary text-white rounded-xl shadow-2xs shrink-0">
                  <Tv className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-xl font-semibold text-foreground">Yard board</h1>
                  <InfoTip text="Live yard and ZMCC display. It refreshes every 30 seconds." />
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {updatedAt > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">Updated {pakistanTime(updatedAt)}</span>
                )}
                <div className="px-3.5 py-1.5 rounded-xl bg-muted border border-border tabular-nums text-sm font-semibold text-foreground">
                  {currentMinute === null ? '—' : pakistanTime(currentMinute * 60000)}
                </div>
              </div>
            </div>

            <section className="space-y-3" aria-label="Dispatch to plant">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-foreground">Dispatch to plant</h2>
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">
                  {activeVehicles.length}
                </span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
                {activeVehicles.length === 0 ? (
                  <div className="col-span-full space-y-4">
                    <div className="p-8 text-center border border-border rounded-2xl bg-card shadow-2xs">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">Yard clear</h3>
                      <p className="text-xs text-muted-foreground mt-1">No tankers on the way</p>
                    </div>

                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
                      {STATIONS.map(({ icon: Icon, station, name, state }) => (
                        <div key={station} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-4 shadow-2xs">
                          <div className="flex items-center gap-3">
                            <Icon className="w-5 h-5 text-muted-foreground" />
                            <div>
                              <span className="block text-xs text-muted-foreground">{station}</span>
                              <span className="text-sm font-semibold text-foreground">{name}</span>
                            </div>
                          </div>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {state}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  activeVehicles.map((vehicle, idx) => {
                    const isNext = idx === 0;
                    const lc = vehicle.lifecycle;

                    return (
                      <div
                        key={`tv-vehicle-${vehicle.visitId}`}
                        className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-3.5 shadow-2xs ${
                          isNext
                            ? 'bg-primary/5 border-primary ring-1 ring-primary'
                            : 'bg-card border-border hover:border-border-strong'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold tabular-nums ${
                              isNext ? 'bg-primary text-white' : 'bg-muted text-secondary-foreground border border-border'
                            }`}
                          >
                            {isNext ? 'Next in line' : `Position ${idx + 1}`}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 tabular-nums text-xs font-semibold text-emerald-800">
                            {vehicle.portionCount} {vehicle.portionCount > 1 ? 'portions' : 'portion'}
                          </span>
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="min-w-0 break-all text-2xl font-semibold font-mono tabular-nums text-foreground">
                              {vehicle.vehicleNumber}
                            </h3>
                            {lc.elapsedInPlant && (
                              <div className="flex items-center space-x-1 text-xs tabular-nums font-semibold text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                <span>{lc.elapsedInPlant}</span>
                              </div>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span>Token <strong className="font-semibold text-foreground">{vehicle.tokenNumber || 'Pending'}</strong></span>
                            <span>·</span>
                            <span className="min-w-0 break-words">From <strong className="font-semibold text-foreground">{vehicle.sourceName}</strong></span>
                          </div>
                        </div>

                        <div className="py-1">
                          <ManagerLifecycleTracker lifecycle={lc} compact={true} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {user ? (
              zmccSections.map((z) => <ZmccBoardSection key={z.id} zmcc={z} />)
            ) : (
              <p className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                <span>Sign in to see ZMCC sections</span>
                <Link href="/login" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-primary shadow-2xs transition hover:bg-muted">
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Operator login</span>
                </Link>
              </p>
            )}
          </div>
        </PageTransition>
      </main>
    </div>
  );
}
