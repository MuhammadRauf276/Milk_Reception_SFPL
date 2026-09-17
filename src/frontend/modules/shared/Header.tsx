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
  title = 'Milk Reception System',
  sourceName,
  showBranding = false,
  onMenuClick,
  showMenuButton = false,
  menuButtonRef,
}) => {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore network errors on logout redirect
    }
    window.location.href = '/login';
  };

  const shouldShowMenu = Boolean(onMenuClick || showMenuButton);

  const resolvedSourceName =
    sourceName ||
    currentUser?.procurement_source?.name ||
    currentUser?.zone ||
    null;

  return (
    <header className="w-full max-w-full flex items-center justify-between px-3 sm:px-6 py-2 sm:py-2.5 border-b border-[#EAE4D5] bg-[#FFFFFF] text-[#111311] shadow-xs shrink-0 select-none">
      {/* Left Placement: Menu trigger, Branding & Title / Context */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
        {shouldShowMenu && (
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onMenuClick}
            className="min-h-[44px] min-w-[44px] p-2 rounded-xl border border-[#C4B9A3] bg-[#FDFBF9] text-[#111311] hover:bg-[#F4F0E6] transition flex items-center justify-center shrink-0 shadow-xs focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            aria-label="Open navigation drawer"
          >
            <Menu className="w-5 h-5 text-[#1E3A8A]" />
          </button>
        )}

        {showBranding && (
          <div className="flex items-center space-x-2 pr-2 sm:pr-3.5 border-r border-[#EAE4D5] shrink-0">
            <div className="p-1.5 bg-[#1E3A8A] rounded-xl text-white shadow-xs shrink-0">
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

        <div className="min-w-0 flex items-center space-x-2">
          <h1 className="font-extrabold text-xs sm:text-sm tracking-tight text-[#111311] truncate">
            {title}
          </h1>
          {resolvedSourceName && resolvedSourceName !== title && (
            <span className="hidden md:inline-flex items-center text-[11px] font-bold text-slate-600 bg-[#F4F0E6] px-2 py-0.5 rounded-md border border-[#EAE4D5] truncate max-w-[200px]">
              {resolvedSourceName}
            </span>
          )}
        </div>
      </div>

      {/* Right Placement: User Profile Widget & Sign Out */}
      <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
        {/* User Badge */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl bg-[#FDFBF9] border border-[#EAE4D5] shadow-xs max-w-[130px] sm:max-w-none">
          <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1E3A8A] shrink-0" />
          <div className="text-left min-w-0">
            <p className="text-[11px] sm:text-xs font-bold leading-tight text-[#111311] truncate">
              {currentUser?.name || 'Operator'}
            </p>
            {currentUser?.username && (
              <p className="hidden sm:block text-[9.5px] leading-tight truncate font-mono text-slate-500">
                @{currentUser.username}
              </p>
            )}
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          onClick={handleLogout}
          type="button"
          className="min-h-[44px] min-w-[44px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] hover:bg-rose-100 transition flex items-center justify-center gap-1.5 font-bold text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
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
