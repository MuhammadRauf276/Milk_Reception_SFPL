import React, { Suspense } from 'react';
import { SecurityManager } from '@modules/dashboard/SecurityManager';

export default function SecurityManagerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[#FDFBF9] text-[#111311] font-mono text-xs font-bold">
          Loading Security Manager...
        </div>
      }
    >
      <SecurityManager />
    </Suspense>
  );
}
