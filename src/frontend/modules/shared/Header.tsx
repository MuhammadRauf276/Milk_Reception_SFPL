'use client';

import React from 'react';
import { ShieldCheck, LogOut, Milk, Menu } from 'lucide-react';
import { User } from '@core/types';

interface HeaderProps {
  currentUser: User | null;
  title?: string;
  sourceName?: string;
  showBranding?: boolean;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
  isZmccVariant?: boolean;
  menuButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  title = 'Supply Chain Console',
  sourceName,
  showBranding = false,
  onMenuClick,
  showMenuButton = false,
  isZmccVariant = false,
  menuButtonRef,
}) => {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore
    }
    window.location.href = '/login';
  };

  const shouldShowMenu = Boolean(onMenuClick || showMenuButton);

  if (!isZmccVariant) {
    return (
      <header className="w-full max-w-full flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-[#EAE4D5] bg-[#FFFFFF] text-[#111311] shadow-sm shrink-0">
        {/* Left Placement: Hamburger, Branding & Title */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
          {shouldShowMenu && (
            <button
              type="button"
              onClick={onMenuClick}
              className="p-1.5 rounded-lg border border-[#EAE4D5] bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] transition shrink-0"
              aria-label="Open navigation drawer"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {showBranding && (
            <div className="flex items-center space-x-2 sm:space-x-2.5 pr-2 sm:pr-4 border-r border-[#EAE4D5] shrink-0">
              <div className="p-1 sm:p-1.5 bg-[#1E3A8A] rounded-lg text-white">
                <Milk className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <span className="font-extrabold text-xs sm:text-sm leading-none block text-[#111311]">
                  Shakarganj
                </span>
                <span className="text-[8px] sm:text-[9px] uppercase font-bold text-slate-500 tracking-wider hidden sm:block">
                  Food Products Ltd
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center space-x-2 min-w-0">
            <h1 className="font-extrabold text-xs sm:text-base tracking-tight text-[#111311] truncate">
              {title}
            </h1>
            <span className="hidden sm:inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
              <span>Live</span>
            </span>
          </div>
        </div>

        {/* Right Placement: Cluster User Configuration Widgets */}
        <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
          {/* 1. User Profile Widget */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 px-2 py-1 sm:px-3.5 sm:py-1.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] shadow-sm max-w-[130px] sm:max-w-none">
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1E3A8A] shrink-0" />
            <div className="text-left min-w-0">
              <p className="text-[11px] sm:text-xs font-black leading-tight text-[#111311] truncate">
                {currentUser?.name || 'Operator'}
              </p>
              <p className="hidden sm:block text-[9.5px] text-[#1E3A8A] font-mono tracking-wider font-extrabold uppercase leading-tight truncate">
                {currentUser?.role || 'GUEST'}
              </p>
            </div>
          </div>

          {/* 2. Log Out Button */}
          <button
            onClick={handleLogout}
            className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] hover:bg-rose-100 transition-all duration-200 ease-in-out flex items-center gap-1.5 font-extrabold text-xs shadow-sm"
            title="Log Out of Console"
          >
            <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#991B1B]" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </header>
    );
  }

  // ZMCC Opt-In Variant
  const resolvedSourceName =
    sourceName ||
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    null;

  return (
    <header className="w-full max-w-full flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-[#EAE4D5] bg-[#FFFFFF] text-[#111311] shadow-xs shrink-0">
      {/* Left Placement: Hamburger, Branding & Title */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
        {shouldShowMenu && (
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onMenuClick}
            className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-[#C4B9A3] bg-[#FDFBF9] text-[#111311] hover:bg-[#F4F0E6] transition flex items-center justify-center shrink-0 shadow-xs focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            aria-label="Open navigation drawer"
          >
            <Menu className="w-5 h-5 text-[#1E3A8A]" />
          </button>
        )}

        {showBranding && (
          <div className="flex items-center space-x-2 sm:space-x-2.5 pr-2 sm:pr-4 border-r border-[#EAE4D5] shrink-0">
            <div className="p-1.5 bg-[#1E3A8A] rounded-xl text-white shadow-xs shrink-0">
              <Milk className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <span className="font-extrabold text-xs sm:text-sm leading-none block text-[#111311]">
                Shakarganj
              </span>
              <span className="text-[8px] sm:text-[9px] uppercase font-extrabold text-slate-500 tracking-wider hidden sm:block">
                Food Products Limited
              </span>
            </div>
          </div>
        )}

        {resolvedSourceName && (
          <div className="min-w-0">
            <span className="text-xs sm:text-sm font-extrabold text-[#111311] truncate block">
              {resolvedSourceName}
            </span>
          </div>
        )}
      </div>

      {/* Right Placement: Cluster User Configuration Widgets */}
      <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
        {/* 1. User Profile Widget */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] shadow-xs max-w-[140px] sm:max-w-none">
          <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1E3A8A] shrink-0" />
          <div className="text-left min-w-0">
            <p className="text-[11px] sm:text-xs font-black leading-tight text-[#111311] truncate">
              {currentUser?.name || 'Operator'}
            </p>
            {currentUser?.username && (
              <p className="hidden sm:block text-[9px] sm:text-[9.5px] leading-tight truncate font-bold text-slate-500 font-mono">
                @{currentUser.username}
              </p>
            )}
          </div>
        </div>

        {/* 2. Sign Out Button */}
        <button
          onClick={handleLogout}
          type="button"
          className="min-h-[44px] min-w-[44px] px-2.5 sm:px-3.5 py-2 rounded-xl bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] hover:bg-rose-100 transition-all duration-200 ease-in-out flex items-center justify-center gap-1.5 font-extrabold text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
          title="Sign Out of Console"
          aria-label="Sign Out"
        >
          <LogOut className="w-4 h-4 text-[#991B1B]" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
};
