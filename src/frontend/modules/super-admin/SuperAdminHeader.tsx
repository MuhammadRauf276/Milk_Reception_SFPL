'use client';

import React from 'react';
import { User } from '@core/types';
import { useRouter } from 'next/navigation';
import { LogOut, Shield, Menu } from 'lucide-react';

interface SuperAdminHeaderProps {
  currentUser: User | null;
  title?: string;
  onMenuClick?: () => void;
}

export const SuperAdminHeader: React.FC<SuperAdminHeaderProps> = ({
  currentUser,
  title = 'Super Admin',
  onMenuClick,
}) => {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore network error on logout
    } finally {
      router.push('/login');
    }
  };

  return (
    <header className="bg-[#FFFFFF] border-b border-[#EAE4D5]/80 px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between shrink-0 w-full max-w-full">
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="xl:hidden p-1.5 rounded-lg border border-[#EAE4D5]/80 bg-[#FDFBF9] text-slate-700 hover:bg-[#F4F0E6] transition shrink-0"
            aria-label="Open navigation drawer"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div className="p-1.5 sm:p-2 bg-[#F4EFE3] rounded-lg border border-[#C4B9A3] shrink-0">
          <Shield className="w-4 h-4 text-[#1E3A8A]" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xs sm:text-base font-extrabold tracking-tight text-[#111311] truncate">
            {title}
          </h2>
          <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium hidden sm:block truncate">
            System Administration & Master Control
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
        <div className="text-right text-xs font-semibold max-w-[120px] sm:max-w-none">
          <div className="text-[#111311] font-bold text-[11px] sm:text-xs truncate">
            {currentUser?.name || 'Super Admin'}
          </div>
          <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono hidden sm:block truncate">
            {currentUser?.username || 'super.admin'}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center space-x-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-lg border border-[#C4B9A3] bg-[#FDFBF9] hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-xs font-bold text-slate-700 transition"
          title="Sign Out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
};
