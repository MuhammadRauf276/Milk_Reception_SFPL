'use client';

import React, { useEffect } from 'react';
import {
  Milk,
  ShieldCheck,
  PlusCircle,
  KeyRound,
  Radio,
  Tv,
  LayoutDashboard,
  FlaskConical,
  X,
} from 'lucide-react';
import { User } from '@core/types';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  currentUser: User | null;
  onOpenDispatchModal?: () => void;
  onOpenTokenModal?: () => void;
  activeCount: number;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  onOpenDispatchModal,
  onOpenTokenModal,
  activeCount,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const pathname = usePathname();
  const role = currentUser?.role || '';

  // Close drawer on Escape key press
  useEffect(() => {
    if (!isMobileOpen || !onCloseMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isMobileOpen]);

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

  const isZmccManager = !isSecurityManager && role === 'ZMCC_MANAGER';
  const isContractorManager = !isSecurityManager && role === 'CONTRACTOR_MANAGER';

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
      : 'bg-[#FDFBF9] text-[#111311] border-[#EAE4D5] hover:bg-[#F4F0E6]/60 transition-all duration-200 ease-in-out';
  };

  const getBadgeStyle = (href: string) => {
    const isActive = pathname === href;
    return isActive
      ? 'bg-white text-[#1E3A8A] font-black'
      : 'bg-blue-100 text-[#1E3A8A] font-black';
  };

  const handleLinkClick = () => {
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const renderSidebarBody = (isDrawer: boolean = false) => (
    <div className="flex flex-col justify-between h-full space-y-5">
      <div className="space-y-5">
        {/* OFFICIAL CORPORATE BRANDING HEADER */}
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[#1E3A8A] rounded-xl shadow-sm text-white shrink-0">
              <Milk className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h1 className="font-bold tracking-tight text-[#111311] text-base leading-none">
                Shakarganj
              </h1>
              <p className="text-xs uppercase font-medium text-slate-600 tracking-wider mt-1">
                Food Products Ltd
              </p>
            </div>
          </div>

          {/* Close button for drawer */}
          {isDrawer && onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg border border-[#EAE4D5] text-slate-500 hover:text-slate-800 hover:bg-[#F4F0E6] transition"
              aria-label="Close navigation drawer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Live System Status */}
        <div className="p-3 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] space-y-1">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="flex items-center gap-1.5 text-emerald-700 font-extrabold">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Auto-Sync (10s)
            </span>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-black">
              LIVE
            </span>
          </div>
          <p className="text-[11px] font-semibold text-[#334155]">
            Active Pipeline:{' '}
            <strong className="font-mono text-[#111311] font-extrabold text-xs">
              {activeCount} Trucks
            </strong>
          </p>
        </div>

        {/* DYNAMIC NAVIGATION TIER WITH DYNAMIC PATHNAME HIGHLIGHTING */}
        <div className="space-y-1.5 pt-1">
          <label className="text-[10px] font-black uppercase tracking-wider text-[#334155] block px-1">
            Authorized Departments
          </label>

          {/* 0. SECURITY MANAGER EXCLUSIVE ISOLATED SINGLE LINK */}
          {isSecurityManager && (
            <Link
              href="/"
              onClick={handleLinkClick}
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
                onClick={handleLinkClick}
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
                onClick={handleLinkClick}
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

          {/* 2B. ZMCC SOURCE MANAGER VIEW */}
          {isZmccManager && (
            <Link
              href="/mpd/zmcc-manager"
              onClick={handleLinkClick}
              className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/mpd/zmcc-manager')}`}
            >
              <span className="flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" />
                <span>ZMCC Manager Station</span>
              </span>
              <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/mpd/zmcc-manager')}`}>
                MANAGER
              </span>
            </Link>
          )}

          {/* 2C. PLANT CONTRACTOR MANAGER VIEW */}
          {isContractorManager && (
            <Link
              href="/contractor/manager"
              onClick={handleLinkClick}
              className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/contractor/manager')}`}
            >
              <span className="flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4" />
                <span>Plant Contractor Station</span>
              </span>
              <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/contractor/manager')}`}>
                MANAGER
              </span>
            </Link>
          )}

          {/* 3. MAIN ADMIN & DEPARTMENT MANAGERS VIEW */}
          {isMainAdmin && (
            <>
              <Link
                href="/super-admin/lab-tests"
                onClick={handleLinkClick}
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/super-admin/lab-tests')}`}
              >
                <span className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[#1E3A8A]" />
                  <span>Lab Tests</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${getBadgeStyle('/super-admin/lab-tests')}`}>
                  LABS
                </span>
              </Link>

              <Link
                href="/tv-board"
                onClick={handleLinkClick}
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
        <div className="space-y-1.5 pt-2 border-t border-[#EAE4D5]">
          <label className="text-[10px] font-black uppercase tracking-wider text-[#334155] block px-1">
            Station Actions
          </label>

          {(role === 'Security_Operator' || role === 'Correction_Officer' || role === 'Admin') && onOpenTokenModal && (
            <button
              onClick={() => {
                handleLinkClick();
                onOpenTokenModal();
              }}
              className="w-full flex items-center justify-center space-x-2 py-2 px-3 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-xl font-bold text-xs shadow-sm transition-all duration-200 ease-in-out active:scale-95 border border-indigo-950"
            >
              <KeyRound className="w-4 h-4 text-white" />
              <span>Issue Entry Token</span>
            </button>
          )}

          {(role === 'Correction_Officer' || role === 'Admin') && onOpenDispatchModal && (
            <button
              onClick={() => {
                handleLinkClick();
                onOpenDispatchModal();
              }}
              className="w-full flex items-center justify-center space-x-2 py-2 px-3 bg-[#111311] hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all duration-200 ease-in-out active:scale-95 border border-slate-950"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Record Dispatch</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Off-Canvas Drawer (Full-Width Workspace for Managers at All Viewports) */}
      {isMobileOpen && (
        <div>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <aside
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] sm:max-w-[280px] bg-[#FFFFFF] border-r border-[#EAE4D5] shadow-2xl flex flex-col justify-between p-4 text-[#111311] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation Drawer"
          >
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}
    </>
  );
};
