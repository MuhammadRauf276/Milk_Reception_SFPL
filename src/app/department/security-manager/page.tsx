import React, { Suspense } from 'react';
import { SecurityManager } from '@modules/dashboard/SecurityManager';

export default function SecurityManagerPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading Security Manager...</div>}>
      <SecurityManager />
    </Suspense>
  );
}
