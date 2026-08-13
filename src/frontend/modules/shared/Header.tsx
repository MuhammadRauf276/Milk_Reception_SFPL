'use client';

import React from 'react';
import { Sun, Moon, ShieldCheck, LogOut, Milk } from 'lucide-react';
import { User } from '@core/types';

interface HeaderProps {
  currentUser: User | null;
  currentTheme?: 'creamy' | 'night';
  onToggleTheme?: () => void;
  title?: string;
  showBranding?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  currentTheme,
  onToggleTheme,
  title = 'Supply Chain Console',
  showBranding = false,
}) => {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore
    }
    window.location.href = '/login';
  };

  return (
    <header className="w-full flex items-center justify-between px-6 py-3 border-b border-[#EAE4D5]/80 bg-[#FFFFFF] dark:bg-[#0F172A] text-[#111311] dark:text-slate-100 shadow-sm transition-colors duration-200">
      {/* Left Placement: Branding & Title */}
      <div className="flex items-center space-x-3">
        {showBranding && (
          <div className="flex items-center space-x-2.5 pr-4 border-r border-[#EAE4D5]/80 dark:border-slate-800">
            <div className="p-1.5 bg-[#1E3A8A] rounded-lg text-white">
              <Milk className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold text-sm leading-none block text-[#111311] dark:text-white">
                Shakarganj
              </span>
              <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider block">
                Food Products Ltd
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center space-x-2.5">
          <h1 className="font-extrabold text-base tracking-tight text-[#111311] dark:text-white">
            {title}
          </h1>
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
            <span>Live</span>
          </span>
        </div>
      </div>

      {/* Right Placement: Cluster User Configuration Widgets */}
      <div className="flex items-center space-x-3">
        {/* 1. Theme Switcher */}
        <button
          onClick={onToggleTheme}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-[#EAE4D5]/80 dark:border-slate-800 bg-[#FDFBF9] dark:bg-slate-900 text-xs font-bold hover:bg-[#F4F0E6]/60 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out shadow-sm text-[#334155] dark:text-slate-200"
          title="Toggle Light/Dark Mode"
        >
          {currentTheme === 'creamy' ? (
            <Sun className="w-4 h-4 text-amber-600" />
          ) : (
            <Moon className="w-4 h-4 text-blue-400" />
          )}
          <span className="hidden sm:inline font-extrabold text-[11px]">
            {currentTheme === 'creamy' ? 'Creamy Light' : 'Dark Mode'}
          </span>
        </button>

        {/* 2. User Profile Widget */}
        <div className="flex items-center space-x-2.5 px-3.5 py-1.5 rounded-xl bg-[#FDFBF9] dark:bg-slate-900 border border-[#EAE4D5]/80 dark:border-slate-800 shadow-sm">
          <ShieldCheck className="w-4 h-4 text-[#1E3A8A] shrink-0" />
          <div className="text-left">
            <p className="text-xs font-black leading-tight text-[#111311] dark:text-white">
              {currentUser?.name || 'Operator'}
            </p>
            <p className="text-[9.5px] text-[#1E3A8A] dark:text-blue-400 font-mono tracking-wider font-extrabold uppercase leading-tight">
              {currentUser?.role || 'GUEST'}
            </p>
          </div>
        </div>

        {/* 3. Log Out Button */}
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 rounded-xl bg-[#FEF2F2] dark:bg-rose-950 text-[#991B1B] dark:text-rose-300 border border-[#FECACA] dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900 transition-all duration-200 ease-in-out flex items-center gap-1.5 font-extrabold text-xs shadow-sm"
          title="Log Out of Console"
        >
          <LogOut className="w-4 h-4 text-[#991B1B] dark:text-rose-400" />
          <span className="hidden md:inline">Log Out</span>
        </button>
      </div>
    </header>
  );
};
