'use client';

import React from 'react';
import { WeighingPolicyPanel } from '@/frontend/modules/super-admin/weighing/WeighingPolicyPanel';
import { useCurrentUser } from '@/frontend/hooks/useCurrentUser';

export default function SuperAdminWeighingPolicyPage() {
  const { currentUser } = useCurrentUser();
  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden">
      <h1 className="text-xl font-semibold text-foreground">Weighing policy</h1>
      <WeighingPolicyPanel canEdit={currentUser?.role === 'SUPER_ADMIN'} />
    </div>
  );
}
