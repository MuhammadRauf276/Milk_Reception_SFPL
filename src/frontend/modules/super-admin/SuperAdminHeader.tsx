'use client';

import React from 'react';
import { User } from '@core/types';
import { useRouter } from 'next/navigation';
import { LogOut, Shield, Menu } from 'lucide-react';

interface SuperAdminHeaderProps {
  currentUser: User | null;
  onMenuClick?: () => void;
  isOpen?: boolean;
  menuButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export const SuperAdminHeader: React.FC<SuperAdminHeaderProps> = ({
  currentUser,
  onMenuClick,
  isOpen = false,
  menuButtonRef,
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
    <header className="bg-white border-b border-[#C4B9A3] px-3 sm:px-6 py-3 flex items-center justify-between shrink-0 w-full max-w-full shadow-xs">
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1 mr-2">
        {onMenuClick && (
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onMenuClick}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#C4B9A3] bg-[#FDFBF9] text-[#111311] hover:bg-[#EFE9D9]/60 transition shrink-0 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]"
            aria-label="Open navigation drawer"
            aria-expanded={isOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div className="p-2 bg-[#EFE9D9]/60 rounded-xl border border-[#C4B9A3] shrink-0">
          <Shield className="w-4 h-4 text-[#1E3A8A]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xs sm:text-sm md:text-base font-black tracking-tight text-[#111311] truncate">
            Shakarganj Food Products Limited
          </h1>
        </div>
      </div>

      <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
        <div className="text-right text-xs font-semibold max-w-[120px] sm:max-w-none">
          <div className="text-[#111311] font-bold text-[11px] sm:text-xs truncate">
            {currentUser?.name || currentUser?.username || 'User'}
          </div>
          {currentUser?.username && (
            <div className="text-[9px] sm:text-[10px] text-slate-500 font-mono hidden sm:block truncate">
              {currentUser.username}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center justify-center space-x-1.5 px-3 py-2 min-h-[44px] min-w-[44px] rounded-xl border border-[#C4B9A3] bg-[#FDFBF9] hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-xs font-bold text-slate-700 transition"
          title="Sign Out"
          aria-label="Sign Out"
        >
          <LogOut className="w-4 h-4 text-[#1E3A8A]" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
};
