import React from 'react';

export default function GlobalLoading() {
  return (
    <div className="min-h-screen w-full bg-[#FDFBF9] flex flex-col items-center justify-center p-6 space-y-4">
      <div className="relative w-16 h-16 flex items-center justify-center">
        {/* Pulsing rings */}
        <div className="absolute inset-0 border-4 border-blue-100 rounded-full animate-ping opacity-75"></div>
        <div className="absolute inset-2 border-4 border-blue-500 rounded-full animate-spin border-t-transparent"></div>
      </div>
      <div className="text-sm font-bold text-slate-500 animate-pulse tracking-widest uppercase">
        Loading Workspace...
      </div>
    </div>
  );
}
