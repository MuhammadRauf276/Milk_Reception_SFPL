'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { User } from '@/backend/core/types';
import { ArrowLeft } from 'lucide-react';
import { resolveDelegationContext } from './stations';

interface DelegationBannerProps {
  currentUser: User | null;
  /** Explicitly overridden source name if resolved externally. */
  sourceName?: string | null;
  /** Callback to trigger the source selector modal/dropdown if applicable. */
  onSwitchSource?: () => void;
}

/**
 * Compact Delegation Banner (§5.1, §5.3, §5.6).
 *
 * Appears ONLY when the user is operating in delegated mode (covering subordinate staff).
 * Displays a clean, high-contrast dark slate bar (40-48px height) with static indicator,
 * covering role + source attribution, and a clean [Return to My Work] action.
 */
export const DelegationBanner: React.FC<DelegationBannerProps> = ({
  currentUser,
  sourceName: propSourceName,
  onSwitchSource,
}) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const delegation = resolveDelegationContext(currentUser, pathname, searchParams);

  if (!delegation.isDelegated) {
    return null;
  }

  // Derive source name:
  // 1. Explicit prop
  // 2. Bound procurement source on user (e.g. ZMCC Manager's assigned ZMCC)
  // 3. Fallback for plant stations (e.g. "Plant Reception Lab", "Production & Weighbridge")
  // 4. Default fallback
  const resolvedSourceName =
    propSourceName ||
    currentUser?.procurement_source?.name ||
    delegation.defaultFacilityName ||
    (delegation.isRegional ? 'Select Location' : 'Plant Central');

  return (
    <aside
      role="region"
      aria-label="Delegation Status Banner"
      className="w-full bg-slate-900 text-slate-100 border-b border-slate-800 shrink-0 z-20"
    >
      <div className="mx-auto flex min-h-[40px] sm:min-h-[48px] w-full max-w-full flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 py-1.5 sm:px-6">
        {/* Left Side: Static Indicator + Attribution Text */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full bg-slate-400 shrink-0"
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs sm:text-sm text-slate-200">
            <span className="text-slate-400">Covering:</span>
            <span className="font-semibold text-white">
              {delegation.subordinateRoleLabel}
            </span>
            <span className="text-slate-400" aria-hidden="true">
              ·
            </span>
            {delegation.isRegional && onSwitchSource ? (
              <button
                type="button"
                onClick={onSwitchSource}
                className="group inline-flex items-center gap-1 font-medium text-slate-200 hover:text-white underline decoration-slate-600 underline-offset-2 transition-colors cursor-pointer"
                title="Change source location"
              >
                <span>{resolvedSourceName}</span>
                <span className="text-[10px] text-slate-400 group-hover:text-slate-200">
                  (change)
                </span>
              </button>
            ) : (
              <span className="font-medium text-slate-200">{resolvedSourceName}</span>
            )}
          </div>
        </div>

        {/* Right Side: Return to My Work Button */}
        <div className="flex shrink-0 items-center">
          <Link
            href={delegation.homeRoute}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 px-3 py-1.5 text-xs font-medium border border-slate-700 hover:border-slate-600 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary min-h-[36px] sm:min-h-[32px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Return to My Work</span>
          </Link>
        </div>
      </div>
    </aside>
  );
};
