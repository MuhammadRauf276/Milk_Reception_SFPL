'use client';

import React from 'react';
import { Milk, ShieldCheck, PlusCircle, KeyRound, Radio, Tv, Grid, LayoutDashboard, History, ArrowRightLeft, FlaskConical } from 'lucide-react';
import { Role, User } from '@core/types';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  currentUser: User | null;
  onOpenDispatchModal?: () => void;
  onOpenTokenModal?: () => void;
  activeCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  onOpenDispatchModal,
  onOpenTokenModal,
  activeCount
}) => {
  const pathname = usePathname();
  const role = currentUser?.role || 'MPD_Operator';

  const isSecurityManager = role === 'Security_Manager';

  const isStationOperator =
    !isSecurityManager &&
    (role === 'MPD_Operator' ||
    role === 'MPD' ||
    role === 'Security_Operator' ||
    role === 'Security_Weight' ||
    role === 'QA_Operator' ||
    role === 'QA' ||
    role === 'Production_Operator' ||
    role === 'Production');

  const isZoneManager = !isSecurityManager && role === 'MPD_Zone_Manager';
  const isZmccManager = !isSecurityManager && role === 'ZMCC_MANAGER';

  const isMainAdmin =
    !isSecurityManager &&
    (role === 'Admin' ||
    role === 'Correction_Officer' ||
    role === 'General_Plant_Manager' ||
    role === 'QA_Manager' ||
    role === 'Production_Manager' ||
    role === 'Management');

  const getLinkStyle = (href: string) => {
    const isActive = pathname === href;
    return isActive
      ? 'bg-[#1E3A8A] text-white font-extrabold border-[#1E3A8A] shadow-md'
      : 'bg-[#FDFBF9] text-[#111311] border-[#EAE4D5]/80 hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out';
  };

  const getBadgeStyle = (href: string) => {
    const isActive = pathname === href;
    return isActive
      ? 'bg-white text-[#1E3A8A] font-black'
      : 'bg-blue-100 text-[#1E3A8A] font-black';
  };

  return (
    <aside className="w-64 shrink-0 bg-[#FFFFFF] dark:bg-[#0F172A] border-r border-[#EAE4D5]/80 dark:border-slate-800 flex flex-col justify-between p-4 min-h-screen text-[#111311] dark:text-slate-100 transition-colors duration-200 shadow-sm">
      <div className="space-y-5">
        {/* OFFICIAL CORPORATE BRANDING HEADER */}
        <div className="flex items-center space-x-3 pb-3 border-b border-[#EAE4D5]/80 dark:border-slate-800">
          <div className="p-2.5 bg-[#1E3A8A] rounded-xl shadow-sm text-white">
            <Milk className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-[#111311] text-base leading-none dark:text-white">
              Shakarganj
            </h1>
            <p className="text-xs uppercase font-medium text-slate-600 dark:text-slate-400 tracking-wider mt-1">
              Food Products Ltd
            </p>
          </div>
        </div>

        {/* Live System Status */}
        <div className="p-3 rounded-xl bg-[#FDFBF9] dark:bg-slate-900 border border-[#EAE4D5]/80 dark:border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-extrabold">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Auto-Sync (10s)
            </span>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-black">
              LIVE
            </span>
          </div>
          <p className="text-[11px] font-semibold text-[#334155] dark:text-slate-300">
            Active Pipeline: <strong className="font-mono text-[#111311] dark:text-white font-extrabold text-xs">{activeCount} Trucks</strong>
          </p>
        </div>

        {/* DYNAMIC NAVIGATION TIER WITH DYNAMIC PATHNAME HIGHLIGHTING */}
        <div className="space-y-1.5 pt-1">
          <label className="text-[10px] font-black uppercase tracking-wider text-[#334155] dark:text-slate-400 block px-1">
            Authorized Departments
          </label>

          {/* 0. SECURITY MANAGER EXCLUSIVE ISOLATED SINGLE LINK */}
          {isSecurityManager && (
            <Link
              href="/"
              className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/')}`}
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
                <span>📋 Gate Milestone Ledger</span>
              </span>
              <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/')}`}>
                LEDGER
              </span>
            </Link>
          )}

          {/* 1. STATION OPERATORS VIEW */}
          {isStationOperator && (
            <>
              <Link
                href="/"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/')}`}
              >
                <span className="flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4" />
                  <span>
                    {role.startsWith('MPD')
                      ? 'MPD Field Station'
                      : role.startsWith('Security')
                      ? 'Security Gate Station'
                      : role.startsWith('QA')
                      ? 'QA Testing Laboratory'
                      : 'Silo Offloading Station'}
                  </span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/')}`}>
                  ACTIVE
                </span>
              </Link>

              <Link
                href="/tv-board"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/tv-board')}`}
              >
                <span className="flex items-center gap-2">
                  <Tv className="w-4 h-4" />
                  <span>Public Yard TV Board</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/tv-board')}`}>
                  /tv-board
                </span>
              </Link>
            </>
          )}

          {/* 2. ZMCC MINOR MANAGER / CONTRACTOR VIEW */}
          {isZoneManager && (
            <>
              <Link
                href="/"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/')}`}
              >
                <span className="flex items-center gap-2">
                  <History className="w-4 h-4" />
                  <span>Zonal Historical Archive</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/')}`}>
                  ARCHIVE
                </span>
              </Link>

              <Link
                href="/cross-verification"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/cross-verification')}`}
              >
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Cross-Verification</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/cross-verification')}`}>
                  SUMMARY
                </span>
              </Link>
            </>
          )}

          {/* 2B. ZMCC SOURCE MANAGER VIEW */}
          {isZmccManager && (
            <>
              <Link
                href="/department/zmcc-manager"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/department/zmcc-manager')}`}
              >
                <span className="flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4" />
                  <span>ZMCC Manager Station</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/department/zmcc-manager')}`}>
                  MANAGER
                </span>
              </Link>

              <Link
                href="/cross-verification"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/cross-verification')}`}
              >
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Cross-Verification</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/cross-verification')}`}>
                  SUMMARY
                </span>
              </Link>
            </>
          )}

          {/* 3. MAIN ADMIN & DEPARTMENT MANAGERS VIEW */}
          {isMainAdmin && (
            <>
              <Link
                href="/"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/')}`}
              >
                <span className="flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4" />
                  <span>5-Stage Reception Kanban</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/')}`}>
                  KANBAN
                </span>
              </Link>

              <Link
                href="/fleet-tracking"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/fleet-tracking')}`}
              >
                <span className="flex items-center gap-2">
                  <Grid className="w-4 h-4" />
                  <span>Compact Fleet Matrix</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/fleet-tracking')}`}>
                  /fleet
                </span>
              </Link>

              <Link
                href="/cross-verification"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/cross-verification')}`}
              >
                <span className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Cross-Verification</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/cross-verification')}`}>
                  AUDIT
                </span>
              </Link>

              <Link
                href="/management/dashboard"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/management/dashboard')}`}
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Management Dashboard</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/management/dashboard')}`}>
                  /admin
                </span>
              </Link>

              <Link
                href="/admin/lab-tests"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/admin/lab-tests')}`}
              >
                <span className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
                  <span>Lab Tests</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/admin/lab-tests')}`}>
                  LABS
                </span>
              </Link>

              <Link
                href="/tv-board"
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/tv-board')}`}
              >
                <span className="flex items-center gap-2">
                  <Tv className="w-4 h-4" />
                  <span>Public Yard TV Board</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/tv-board')}`}>
                  /tv-board
                </span>
              </Link>
            </>
          )}
        </div>

        {/* Primary Action Buttons */}
        <div className="space-y-1.5 pt-2 border-t border-[#EAE4D5]/80 dark:border-slate-800">
          <label className="text-[10px] font-black uppercase tracking-wider text-[#334155] dark:text-slate-400 block px-1">
            Station Actions
          </label>

          {(role === 'Security_Operator' || role === 'Correction_Officer' || role === 'Admin') && onOpenTokenModal && (
            <button
              onClick={onOpenTokenModal}
              className="w-full flex items-center justify-center space-x-2 py-2 px-3 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-xl font-bold text-xs shadow-sm transition-all duration-200 ease-in-out active:scale-95 border border-indigo-950"
            >
              <KeyRound className="w-4 h-4 text-white" />
              <span>Issue Entry Token</span>
            </button>
          )}

          {(role === 'Correction_Officer' || role === 'Admin') && onOpenDispatchModal && (
            <button
              onClick={onOpenDispatchModal}
              className="w-full flex items-center justify-center space-x-2 py-2 px-3 bg-[#111311] hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all duration-200 ease-in-out active:scale-95 border border-slate-950"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Record Dispatch</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
