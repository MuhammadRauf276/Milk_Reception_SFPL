'use client';

import React from 'react';
import { UserCog, WifiOff } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { getRoleLabel } from '@/backend/core/roles/labels';
import type { CoverJourneyOption } from './types';

interface Props {
  role: string;
  isOnline: boolean;
  coverJourneyId: string | null;
  coverJourneys: CoverJourneyOption[];
  coverListError: string | null;
  onSelectJourney: (journeyId: string) => void;
}

/** Shown to a superior covering MOT work (online only). */
export function CoveringBanner({ role, isOnline, coverJourneyId, coverJourneys, coverListError, onSelectJourney }: Props) {
  return (
            <div className="bg-card border-border p-3 sm:p-4 rounded-xl border-2 text-violet-900 space-y-3">
              <div className="flex items-start gap-2">
                <UserCog className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold">Covering Mobile Tester work</p>
                  <p className="text-xs">
                    You are doing Mobile Tester work as {getRoleLabel(role)}. This needs the internet.
                  </p>
                </div>
              </div>
              {!isOnline ? (
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <WifiOff className="w-4 h-4" aria-hidden="true" />
                  Offline.
                </p>
              ) : (
                <div>
                  <label htmlFor="cover-journey" className="block text-xs font-semibold mb-1">
                    Choose a journey
                  </label>
                  <Combobox
                    id="cover-journey"
                    className="min-h-[56px]"
                    value={coverJourneyId ?? ''}
                    onValueChange={onSelectJourney}
                    placeholder="Choose…"
                    searchPlaceholder="Search journey"
                    options={coverJourneys.map((j) => {
                      const label = `#${j.journey_number} · ${j.mot_profile?.name || j.mot_profile?.mot_code || 'MC'} · ${
                        j.route?.name || j.route?.route_code || 'Route'
                      }${j.mot_vehicle?.vehicle_number ? ` · ${j.mot_vehicle.vehicle_number}` : ''}`;
                      return { value: j.id, label, keywords: label };
                    })}
                  />
                  {coverListError && <p className="mt-1 text-xs font-semibold text-rose-700">{coverListError}</p>}
                  {!coverListError && coverJourneys.length === 0 && (
                    <p className="mt-1 text-xs">No active journey.</p>
                  )}
                </div>
              )}
            </div>
  );
}
