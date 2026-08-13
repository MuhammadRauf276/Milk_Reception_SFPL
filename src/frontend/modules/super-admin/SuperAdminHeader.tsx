'use client';

import React from 'react';
import { User } from '@core/types';
import { useRouter } from 'next/navigation';
import { LogOut, Shield } from 'lucide-react';

interface SuperAdminHeaderProps {
  currentUser: User | null;
  title?: string;
}

export const SuperAdminHeader: React.FC<SuperAdminHeaderProps> = ({ currentUser, title = 'Super Admin' }) => {
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
    <header className="bg-[#FFFFFF] border-b border-[#EAE4D5]/80 px-6 py-3.5 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-[#F4EFE3] rounded-lg border border-[#C4B9A3]">
          <Shield className="w-4 h-4 text-[#1E3A8A]" />
        </div>
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-[#111311]">{title}</h2>
          <p className="text-[11px] text-slate-500 font-medium">System Administration & Master Control</p>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="text-right text-xs font-semibold">
          <div className="text-[#111311] font-bold">{currentUser?.name || 'Super Admin'}</div>
          <div className="text-[10px] text-slate-500 font-mono">{currentUser?.username || 'super.admin'}</div>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-[#C4B9A3] bg-[#FDFBF9] hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-xs font-bold text-slate-700 transition"
          title="Sign Out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
};
