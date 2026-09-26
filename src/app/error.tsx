'use client';

import { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In production, this would log to Sentry/Winston
    console.error('Global Application Error Caught by Boundary:', error);
  }, [error]);

  return (
    <div className="min-h-screen w-full bg-[#FDFBF9] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-rose-100 p-8 text-center space-y-6">
        <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-10 h-10 text-rose-500" />
        </div>
        
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">System Error</h2>
          <p className="text-sm text-slate-500 mt-2 font-medium leading-relaxed">
            A critical UI component or data fetch has failed. We have blocked the crash to protect your session.
          </p>
        </div>

        <div className="p-4 bg-slate-50 rounded-2xl text-left border border-slate-100 overflow-x-auto">
          <code className="text-xs font-mono text-rose-600 break-words">
            {error.message || 'Unknown runtime exception'}
          </code>
        </div>

        <button
          onClick={() => reset()}
          className="w-full py-3.5 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
        >
          Recover & Try Again
        </button>
      </div>
    </div>
  );
}
