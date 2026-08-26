'use client';

import React from 'react';
import { Milk, ShieldAlert, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function WorkspaceUnavailablePage() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_err) {
      // Ignore network errors on logout
    }
    router.push('/login');
  };

  return (
    <div className="min-h-screen w-screen bg-[#F4EFE3] text-[#111311] flex flex-col justify-between p-6 font-sans">
      {/* Top Brand Bar */}
      <div className="flex items-center justify-between max-w-4xl mx-auto w-full pb-4 border-b border-[#C4B9A3]">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-[#1E3A8A] rounded-xl shadow-md text-white">
            <Milk className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight leading-none text-[#111311]">
              MilkReception
            </h1>
            <p className="text-[10px] font-bold text-[#1E40AF] uppercase tracking-widest mt-0.5">
              Shakarganj Milk Reception Management System
            </p>
          </div>
        </div>
      </div>

      {/* Main Notice Box */}
      <div className="max-w-md mx-auto w-full my-auto py-8">
        <div className="p-8 rounded-2xl bg-[#EFE9D9] border border-[#C4B9A3] shadow-lg text-center space-y-5">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-black text-[#111311]">
              Workspace Not Available
            </h2>
            <p className="text-xs text-[#334155] font-semibold leading-relaxed">
              Your assigned user role does not currently have an active workspace available in this environment.
            </p>
            <p className="text-[11px] text-slate-500 font-medium">
              If you believe this is an error, please contact your system administrator to verify your account permissions.
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={handleLogout}
              className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-[#1E3A8A] hover:bg-[#1E40AF] text-white text-xs font-extrabold shadow transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out & Return to Login</span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-4xl mx-auto w-full pt-4 border-t border-[#C4B9A3] text-center text-xs font-bold text-slate-500">
        Shakarganj Milk Reception Management System &copy; {new Date().getFullYear()} — Operational System Access
      </div>
    </div>
  );
}
