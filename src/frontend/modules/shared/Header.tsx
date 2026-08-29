'use client';

import React from 'react';
import { Sun, Moon, ShieldCheck, LogOut, Milk, Menu } from 'lucide-react';
import { User } from '@core/types';

interface HeaderProps {
  currentUser: User | null;
  currentTheme?: 'creamy' | 'night';
  onToggleTheme?: () => void;
  title?: string;
  showBranding?: boolean;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  currentTheme,
  onToggleTheme,
  title = 'Supply Chain Console',
  showBranding = false,
  onMenuClick,
  showMenuButton = false,
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

  return (
    <header className="w-full max-w-full flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-[#EAE4D5]/80 bg-[#FFFFFF] dark:bg-[#0F172A] text-[#111311] dark:text-slate-100 shadow-sm transition-colors duration-200 shrink-0">
      {/* Left Placement: Hamburger, Branding & Title */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
        {shouldShowMenu && (
          <button
            type="button"
            onClick={onMenuClick}
            className="p-1.5 rounded-lg border border-[#EAE4D5]/80 dark:border-slate-800 bg-[#FDFBF9] dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-[#F4F0E6] dark:hover:bg-slate-800 transition shrink-0"
            aria-label="Open navigation drawer"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {showBranding && (
          <div className="flex items-center space-x-2 sm:space-x-2.5 pr-2 sm:pr-4 border-r border-[#EAE4D5]/80 dark:border-slate-800 shrink-0">
            <div className="p-1 sm:p-1.5 bg-[#1E3A8A] rounded-lg text-white">
              <Milk className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <span className="font-extrabold text-xs sm:text-sm leading-none block text-[#111311] dark:text-white">
                Shakarganj
              </span>
              <span className="text-[8px] sm:text-[9px] uppercase font-bold text-slate-500 tracking-wider hidden sm:block">
                Food Products Ltd
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center space-x-2 min-w-0">
          <h1 className="font-extrabold text-xs sm:text-base tracking-tight text-[#111311] dark:text-white truncate">
            {title}
          </h1>
          <span className="hidden sm:inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
            <span>Live</span>
          </span>
        </div>
      </div>

      {/* Right Placement: Cluster User Configuration Widgets */}
      <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
        {/* 1. Theme Switcher */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="flex items-center space-x-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-xl border border-[#EAE4D5]/80 dark:border-slate-800 bg-[#FDFBF9] dark:bg-slate-900 text-xs font-bold hover:bg-[#F4F0E6]/60 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out shadow-sm text-[#334155] dark:text-slate-200"
            title="Toggle Light/Dark Mode"
          >
            {currentTheme === 'creamy' ? (
              <Sun className="w-4 h-4 text-amber-600" />
            ) : (
              <Moon className="w-4 h-4 text-blue-400" />
            )}
            <span className="hidden md:inline font-extrabold text-[11px]">
              {currentTheme === 'creamy' ? 'Creamy Light' : 'Dark Mode'}
            </span>
          </button>
        )}

        {/* 2. User Profile Widget */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 px-2 py-1 sm:px-3.5 sm:py-1.5 rounded-xl bg-[#FDFBF9] dark:bg-slate-900 border border-[#EAE4D5]/80 dark:border-slate-800 shadow-sm max-w-[130px] sm:max-w-none">
          <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#1E3A8A] shrink-0" />
          <div className="text-left min-w-0">
            <p className="text-[11px] sm:text-xs font-black leading-tight text-[#111311] dark:text-white truncate">
              {currentUser?.name || 'Operator'}
            </p>
            <p className="hidden sm:block text-[9.5px] text-[#1E3A8A] dark:text-blue-400 font-mono tracking-wider font-extrabold uppercase leading-tight truncate">
              {currentUser?.role || 'GUEST'}
            </p>
          </div>
        </div>

        {/* 3. Log Out Button */}
        <button
          onClick={handleLogout}
          className="p-1.5 sm:px-3 sm:py-1.5 rounded-xl bg-[#FEF2F2] dark:bg-rose-950 text-[#991B1B] dark:text-rose-300 border border-[#FECACA] dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900 transition-all duration-200 ease-in-out flex items-center gap-1.5 font-extrabold text-xs shadow-sm"
          title="Log Out of Console"
        >
          <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#991B1B] dark:text-rose-400" />
          <span className="hidden sm:inline">Log Out</span>
        </button>
      </div>
    </header>
  );
};
