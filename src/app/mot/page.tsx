'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@core/types';
import { Header } from '@modules/shared/Header';
import { Sidebar } from '@modules/shared/Sidebar';
import {
  Truck,
  MapPin,
  Clock,
  Store,
  RotateCw,
  AlertCircle,
  CheckCircle2,
  Navigation,
} from 'lucide-react';

interface StopDetail {
  id: string;
  planned_sequence: number;
  status: string;
  shop: {
    id: string;
    shop_code: string;
    shop_name: string;
    owner_name: string;
    contact_number: string;
  } | null;
}

interface CurrentJourney {
  id: string;
  journey_number: string;
  operational_date: string;
  route: { id: string; route_code: string; name: string } | null;
  mot_vehicle: { id: string; vehicle_number: string } | null;
  status: string;
  assigned_by_name: string | null;
  assigned_at: string;
  stops: StopDetail[];
}

export default function MotDriverPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const hamburgerButtonRef = useRef<HTMLButtonElement | null>(null);

  const [journey, setJourney] = useState<CurrentJourney | null>(null);
  const [loadingJourney, setLoadingJourney] = useState(true);
  const [journeyError, setJourneyError] = useState<string | null>(null);

  // Authenticate and guard
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
            user.role !== 'MOT' ||
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
        console.error('Failed to load MOT user', err);
        router.push('/login');
      } finally {
        setLoadingUser(false);
      }
    }
    loadUser();
  }, [router]);

  // Fetch current journey
  const fetchCurrentJourney = useCallback(async () => {
    setLoadingJourney(true);
    setJourneyError(null);
    try {
      const res = await fetch('/api/zmcc/mot/journeys/current');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch current journey.');
      }
      setJourney(data.journey || null);
    } catch (err: any) {
      setJourneyError(err.message);
    } finally {
      setLoadingJourney(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchCurrentJourney();
    }
  }, [currentUser, fetchCurrentJourney]);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      hamburgerButtonRef.current?.focus();
    }, 0);
  }, []);

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center p-8 text-center text-xs font-bold text-slate-500">
        Loading MOT Driver Station...
      </div>
    );
  }

  if (!currentUser) return null;

  return (
    <div className="w-full max-w-full flex flex-col h-screen bg-[#FDFBF9] text-[#111311] overflow-hidden font-sans">
      {/* Header */}
      <Header
        currentUser={currentUser}
        title="MOT Driver Station"
        showBranding={true}
        showMenuButton={true}
        onMenuClick={openDrawer}
        menuButtonRef={hamburgerButtonRef}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
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

        {/* Center Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full max-w-full space-y-5">
          {/* Status Banner */}
          <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-[#1E3A8A] text-white rounded-xl shadow-xs">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-black text-[#111311]">
                  My Collection Journey
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  Assigned Center: {currentUser.procurement_source?.name || 'ZMCC'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={fetchCurrentJourney}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-[#EAE4D5] text-xs font-bold text-slate-700 hover:bg-[#F4F0E6]"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loadingJourney ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {loadingJourney ? (
            <div className="p-12 text-center text-xs font-bold text-slate-500">
              Checking for assigned journey...
            </div>
          ) : journeyError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{journeyError}</span>
            </div>
          ) : !journey ? (
            <div className="p-12 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1E3A8A] flex items-center justify-center mx-auto">
                <Truck className="w-6 h-6" />
              </div>
              <h2 className="text-base font-black text-[#111311]">No Active Journey Assigned</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                You do not have an active milk collection journey. Your ZMCC Manager or PHE Operator will assign and dispatch your route when ready.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Active Journey Card */}
              <div className="p-5 bg-white rounded-2xl border border-[#EAE4D5] shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#EAE4D5] pb-3">
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                      Journey Identifier
                    </span>
                    <h2 className="text-lg font-mono font-black text-[#1E3A8A]">
                      #{journey.journey_number}
                    </h2>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black uppercase flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1" />
                      {journey.status}
                    </span>
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-3 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      Route
                    </span>
                    <span className="text-xs font-black text-[#111311]">
                      {journey.route?.route_code} — {journey.route?.name}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      Vehicle
                    </span>
                    <span className="text-xs font-mono font-bold text-[#111311]">
                      {journey.mot_vehicle?.vehicle_number}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5]">
                    <span className="text-[10px] font-black uppercase text-slate-500 block">
                      Dispatched At
                    </span>
                    <span className="text-xs font-medium text-slate-700">
                      {new Date(journey.assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by {journey.assigned_by_name}
                    </span>
                  </div>
                </div>
              </div>

              {/* Planned Stops / Shops */}
              <div className="bg-white rounded-2xl border border-[#EAE4D5] shadow-xs overflow-hidden">
                <div className="p-4 border-b border-[#EAE4D5] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Store className="w-4 h-4 text-[#1E3A8A]" />
                    <h3 className="text-sm font-black text-[#111311]">
                      Planned Collection Stops ({journey.stops.length})
                    </h3>
                  </div>
                  <span className="text-[11px] font-bold text-slate-500">
                    Sequential Collection Order
                  </span>
                </div>

                <div className="divide-y divide-[#EAE4D5]">
                  {journey.stops.map((stop) => (
                    <div
                      key={stop.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-[#FDFBF9]"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="w-7 h-7 rounded-full bg-[#1E3A8A] text-white text-xs font-black flex items-center justify-center shrink-0">
                          {stop.planned_sequence}
                        </span>
                        <div>
                          <p className="text-xs font-black text-[#111311]">
                            {stop.shop?.shop_name} ({stop.shop?.shop_code})
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Owner: {stop.shop?.owner_name || '—'} | Contact: {stop.shop?.contact_number || '—'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            stop.status === 'VISITED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : stop.status === 'SKIPPED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {stop.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
