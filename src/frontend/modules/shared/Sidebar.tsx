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
  Store,
  Truck,
  X,
  ClipboardList,
  History,
  Clock,
} from 'lucide-react';
import { User } from '@core/types';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

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
  const [currentTab, setCurrentTab] = React.useState<string>('');

  const searchParams = useSearchParams();

  useEffect(() => {
    const tabParam = searchParams?.get('tab');
    if (tabParam) {
      setCurrentTab(tabParam.toLowerCase());
    } else {
      setCurrentTab('');
    }
  }, [searchParams]);

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

  const isSecurityManager = role === 'ADMIN_HEAD';

  const isStationOperator =
    role === 'SECURITY_OPERATOR' ||
    role === 'QA_LAB_ATTENDANT' ||
    role === 'WEIGHBRIDGE_OPERATOR' ||
    role === 'PRODUCTION_RECEPTION_OPERATOR';

  const isHeadOfMpd = role === 'HEAD_OF_MPD';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isZmccLabAttendant = role === 'ZMCC_LAB_ATTENDANT';
  const isPheOperator = role === 'PHE_OPERATOR';
  const isMot = role === 'MOT';
  const isContractorManager = role === 'CONTRACTOR_MANAGER';
  const isMainAdmin = role === 'SUPER_ADMIN';

  const getLinkStyle = (href: string) => {
    const isActive = pathname === href;
    return isActive
      ? 'bg-[#1E3A8A] text-white font-bold shadow-xs border-[#1E3A8A]'
      : 'bg-[#FDFBF9] text-[#111311] border border-[#EAE4D5] hover:bg-[#F4F0E6] transition';
  };

  const isLabActive = (tab: string) => {
    if (pathname !== '/zmcc/lab') return false;
    if (!currentTab && tab === 'queue') return true;
    return currentTab === tab;
  };

  const isDispatchActive = (tab: string) => {
    if (pathname !== '/zmcc/dispatch') return false;
    if (tab === 'recent') return currentTab === 'recent';
    return currentTab !== 'recent';
  };

  const getSubLinkStyle = (isActive: boolean) => {
    return isActive
      ? 'bg-[#1E3A8A] text-white font-bold shadow-xs border-[#1E3A8A]'
      : 'bg-[#FDFBF9] text-[#111311] border border-[#EAE4D5] hover:bg-[#F4F0E6] transition';
  };

  const handleLinkClick = () => {
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const renderSidebarBody = (isDrawer: boolean = false) => (
    <div className="flex flex-col justify-between h-full space-y-4">
      <div className="space-y-4">
        {/* Header inside drawer */}
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE4D5]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-[#1E3A8A] rounded-xl shadow-xs text-white shrink-0">
              <Milk className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-[#111311] text-sm block leading-tight">
                Shakarganj
              </span>
              <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider block">
                Food Products Ltd
              </span>
            </div>
          </div>

          {isDrawer && onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="min-h-[44px] min-w-[44px] p-2 rounded-xl border border-[#EAE4D5] text-slate-500 hover:text-slate-800 hover:bg-[#F4F0E6] transition flex items-center justify-center"
              aria-label="Close navigation drawer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation items */}
        <nav className="space-y-1.5" aria-label="Main Navigation">
          {/* Station Operators */}
          {isStationOperator && (
            <>
              <Link
                href={
                  role === 'SECURITY_OPERATOR'
                    ? '/department/security'
                    : role === 'QA_LAB_ATTENDANT'
                    ? '/department/qa'
                    : role === 'WEIGHBRIDGE_OPERATOR'
                    ? '/department/weighbridge'
                    : '/department/production'
                }
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle(
                  role === 'SECURITY_OPERATOR'
                    ? '/department/security'
                    : role === 'QA_LAB_ATTENDANT'
                    ? '/department/qa'
                    : role === 'WEIGHBRIDGE_OPERATOR'
                    ? '/department/weighbridge'
                    : '/department/production'
                )}`}
              >
                <LayoutDashboard className="w-4 h-4 shrink-0" />
                <span className="font-bold">
                  {role === 'SECURITY_OPERATOR'
                    ? 'Security Gate Station'
                    : role === 'QA_LAB_ATTENDANT'
                    ? 'QA Testing Laboratory'
                    : role === 'WEIGHBRIDGE_OPERATOR'
                    ? 'Weighbridge Station'
                    : 'Silo Offloading Station'}
                </span>
              </Link>

              <Link
                href="/tv-board"
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/tv-board')}`}
              >
                <Tv className="w-4 h-4 shrink-0" />
                <span className="font-bold">Yard Status Board</span>
              </Link>
            </>
          )}

          {/* Head of MPD */}
          {isHeadOfMpd && (
            <Link
              href="/mpd/head"
              onClick={handleLinkClick}
              className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/mpd/head')}`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span className="font-bold">Head of MPD Station</span>
            </Link>
          )}

          {/* ZMCC Manager */}
          {isZmccManager && (
            <Link
              href="/mpd/zmcc-manager"
              onClick={handleLinkClick}
              className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/mpd/zmcc-manager')}`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span className="font-bold">ZMCC Manager Station</span>
            </Link>
          )}

          {/* Plant Contractor Manager */}
          {isContractorManager && (
            <Link
              href="/contractor/manager"
              onClick={handleLinkClick}
              className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/contractor/manager')}`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span className="font-bold">Plant Contractor Station</span>
            </Link>
          )}

          {/* PHE Operator */}
          {isPheOperator && (
            <Link
              href="/phe"
              onClick={handleLinkClick}
              className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/phe')}`}
            >
              <Store className="w-4 h-4 shrink-0" />
              <span className="font-bold">PHE Station</span>
            </Link>
          )}

          {/* ZMCC Lab Attendant */}
          {isZmccLabAttendant && (
            <div className="space-y-3 pt-1">
              {/* SECTION 1: LABORATORY OPERATIONS */}
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block px-1">
                  Laboratory
                </span>

                <Link
                  href="/zmcc/lab?tab=queue"
                  onClick={() => {
                    setCurrentTab('queue');
                    handleLinkClick();
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getSubLinkStyle(isLabActive('queue'))}`}
                >
                  <ClipboardList className="w-4 h-4 shrink-0" />
                  <span className="font-bold">Arrivals Queue</span>
                </Link>

                <Link
                  href="/zmcc/lab?tab=testing"
                  onClick={() => {
                    setCurrentTab('testing');
                    handleLinkClick();
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getSubLinkStyle(isLabActive('testing'))}`}
                >
                  <FlaskConical className="w-4 h-4 shrink-0" />
                  <span className="font-bold">Testing Station</span>
                </Link>

                <Link
                  href="/zmcc/lab?tab=history"
                  onClick={() => {
                    setCurrentTab('history');
                    handleLinkClick();
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getSubLinkStyle(isLabActive('history'))}`}
                >
                  <History className="w-4 h-4 shrink-0" />
                  <span className="font-bold">Test History</span>
                </Link>
              </div>

              {/* SECTION 2: DISPATCH TO PLANT */}
              <div className="space-y-1 pt-2 border-t border-[#EAE4D5]">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block px-1">
                  Dispatch
                </span>

                <Link
                  href="/zmcc/dispatch?tab=new"
                  onClick={() => {
                    setCurrentTab('new');
                    handleLinkClick();
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getSubLinkStyle(isDispatchActive('new'))}`}
                >
                  <Truck className="w-4 h-4 shrink-0" />
                  <span className="font-bold">Dispatch Vehicle</span>
                </Link>

                <Link
                  href="/zmcc/dispatch?tab=recent"
                  onClick={() => {
                    setCurrentTab('recent');
                    handleLinkClick();
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getSubLinkStyle(isDispatchActive('recent'))}`}
                >
                  <Clock className="w-4 h-4 shrink-0" />
                  <span className="font-bold">Recent Dispatches</span>
                </Link>
              </div>
            </div>
          )}

          {/* MOT Driver */}
          {isMot && (
            <Link
              href="/mot"
              onClick={handleLinkClick}
              className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/mot')}`}
            >
              <Truck className="w-4 h-4 shrink-0" />
              <span className="font-bold">MOT Driver Station</span>
            </Link>
          )}

          {/* Super Admin */}
          {isMainAdmin && (
            <>
              <Link
                href="/super-admin"
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/super-admin')}`}
              >
                <LayoutDashboard className="w-4 h-4 shrink-0" />
                <span className="font-bold">Admin Control Center</span>
              </Link>

              <Link
                href="/super-admin/lab-tests"
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/super-admin/lab-tests')}`}
              >
                <FlaskConical className="w-4 h-4 shrink-0 text-[#1E3A8A]" />
                <span className="font-bold">Lab Tests</span>
              </Link>

              <Link
                href="/tv-board"
                onClick={handleLinkClick}
                className={`flex items-center space-x-2.5 p-2.5 rounded-xl border text-xs transition ${getLinkStyle('/tv-board')}`}
              >
                <Tv className="w-4 h-4 shrink-0" />
                <span className="font-bold">Yard Status Board</span>
              </Link>
            </>
          )}
        </nav>

        {/* Station Actions (Modal triggers) */}
        {(((role === 'SECURITY_OPERATOR' || role === 'SUPER_ADMIN') && onOpenTokenModal) ||
          (role === 'SUPER_ADMIN' && onOpenDispatchModal)) && (
          <div className="space-y-1.5 pt-2 border-t border-[#EAE4D5]">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block px-1">
              Station Actions
            </span>

            {(role === 'SECURITY_OPERATOR' || role === 'SUPER_ADMIN') && onOpenTokenModal && (
              <button
                type="button"
                onClick={() => {
                  handleLinkClick();
                  onOpenTokenModal();
                }}
                className="w-full min-h-[44px] flex items-center justify-center space-x-2 py-2 px-3 bg-[#1E3A8A] hover:bg-blue-900 text-white rounded-xl font-bold text-xs shadow-xs transition active:scale-98"
              >
                <KeyRound className="w-4 h-4 text-white shrink-0" />
                <span>Issue Entry Token</span>
              </button>
            )}

            {role === 'SUPER_ADMIN' && onOpenDispatchModal && (
              <button
                type="button"
                onClick={() => {
                  handleLinkClick();
                  onOpenDispatchModal();
                }}
                className="w-full min-h-[44px] flex items-center justify-center space-x-2 py-2 px-3 bg-[#111311] hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow-xs transition active:scale-98"
              >
                <PlusCircle className="w-4 h-4 shrink-0" />
                <span>Record Dispatch</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop In-Flow Sidebar Content */}
      <div className="h-full">
        {renderSidebarBody(false)}
      </div>

      {/* Off-Canvas Drawer (Full-Width Workspace for Mobile Viewports) */}
      {isMobileOpen && (
        <div>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 transition-opacity"
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
